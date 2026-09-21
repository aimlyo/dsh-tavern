import { Script } from 'node:vm'
import { JSDOM } from 'jsdom'
import { isDeepStrictEqual } from 'node:util'
import { buildMvuArtifacts, MVU_CONVERSION_KEY, MVU_MARKER, MVU_RULE_IDS } from './mvu-conversion-artifacts.js'
import { projectReplyLayers } from './reply-presentation.js'
import { projectPersistentStatusView } from './persistent-status-view.js'
import { inspectCardExtensions } from './card-extension-reading.js'
import { inspectWorldBookDocument } from './worldbook-resource.js'
import { constantWorldBookContext, mvuUpdateRulesFromWorldBook } from './worldbook-recall.js'

// Only the exact host-owned template is executed. Imported card JS/EJS never runs
// in this process. These are DOM/data simulations, not a model or MVU settlement.
async function simulatePanel(html, initialState) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' })
  const handlers = new Map(), w = dom.window
  let state = structuredClone(initialState)
  Object.assign(w, {
    Mvu: { getMvuData: () => ({ stat_data: state }), events: { VARIABLE_INITIALIZED: 'initialized', VARIABLE_UPDATE_ENDED: 'updated' } },
    tavern_events: { CHAT_CHANGED: 'restored' }, waitGlobalInitialized: async () => {},
    eventOn: (name, callback) => handlers.set(name, callback)
  })
  const text = () => w.document.querySelector('#values').textContent
  try {
    for (const element of w.document.querySelectorAll('script')) new Script(element.textContent).runInContext(dom.getInternalVMContext(), { timeout: 1000 })
    await new Promise(resolve => setImmediate(resolve))
    if (!handlers.has('updated') || !handlers.has('initialized') || !handlers.has('restored')) throw Error('缺少初始化、更新或恢复订阅')
    const before = text()
    if (!w.document.querySelector('#values').children.length) throw Error('模板未显示初值')
    // Change all visible leaves, including selected fields and nested collections.
    const mutate = value => value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key.startsWith('$') || key.startsWith('__') ? child : mutate(child)]))
      : 'DSH_MVU_VALIDATION_UPDATED'
    state = mutate(initialState); handlers.get('updated')()
    if (!text().includes('DSH_MVU_VALIDATION_UPDATED') || text() === before) throw Error('更新事件后未重读最新变量')
    state = structuredClone(initialState); handlers.get('restored')()
    if (text() !== before) throw Error('恢复事件后显示未还原')
  } finally { w.close() }
}

export async function validateMvuConversion(data) {
  const checks = []
  const check = async (name, run) => {
    try { checks.push({ name, status: 'passed', detail: await run() }) }
    catch (error) { checks.push({ name, status: 'failed', detail: error.message }) }
  }
  const meta = data.extensions?.[MVU_CONVERSION_KEY]
  if (meta?.version !== 1) return { valid: false, checks: [{ name: 'managedConversion', status: 'failed', detail: '不是专用工具生成的 MVU 副本；未执行未知卡片代码' }] }
  let expected
  await check('definition', () => { expected = buildMvuArtifacts(meta); return '初值与展示路径有效' })
  if (!expected) return { valid: false, checks }
  const entries = data.character_book?.entries || [], regexScripts = data.extensions?.regex_scripts || []
  await check('initializationDefinition', () => {
    const init = entries.filter(entry => /^\s*\[initvar\]/i.test(entry.comment || ''))
    if (init.length !== 1 || init[0].enabled !== false || !isDeepStrictEqual(JSON.parse(init[0].content), meta.initialState)) throw Error('初值条目重复、被改动或进入普通正文注入')
    return '唯一初值条目可解析且与定义一致；尚未运行官方 MVU 初始化'
  })
  await check('backgroundRouting', () => {
    const worldBook = { view: inspectWorldBookDocument(data.character_book) }
    const rules = mvuUpdateRulesFromWorldBook(worldBook)
    if (rules.length !== 1 || rules[0] !== expected.entries[1].content) throw Error('后台规则缺失、重复或与定义不一致')
    const foreground = constantWorldBookContext({ worldBook }).context
    if (foreground.includes(expected.entries[1].content) || foreground.includes(expected.entries[0].content)) throw Error('MVU 专用条目进入前台注入')
    return '状态更新规则只进入后台'
  })
  let trusted = false
  await check('managedPanel', () => {
    for (const rule of expected.regexScripts) {
      const found = regexScripts.filter(candidate => candidate.id === rule.id)
      if (found.length !== 1 || !isDeepStrictEqual(found[0], rule)) throw Error('固定状态规则被改动或重复: ' + rule.id)
    }
    if (regexScripts.some(rule => !MVU_RULE_IDS.includes(rule.id) && /StatusPlaceHolderImpl|<[a-z0-9-]*-status\b/i.test(rule.findRegex || ''))) throw Error('仍有另一套状态面板规则')
    trusted = true; return '唯一的宿主维护模板与显示规则'
  })
  await check('greetingsAndHistory', () => {
    const displayRules = inspectCardExtensions(data).regexScripts
    for (const [index, greeting] of [data.first_mes, ...(data.alternate_greetings || [])].entries()) {
      if (typeof greeting !== 'string' || greeting.split(MVU_MARKER).length !== 2) throw Error('开场 ' + index + ' 的入口缺失或重复')
      const layers = projectReplyLayers(greeting, { regexScripts: displayRules, placement: 2, depth: 0 })
      if (layers.sessionText.includes(MVU_MARKER) || layers.sessionText.includes('Mvu.getMvuData')) throw Error('状态入口或 HTML 泄漏到模型历史')
      const view = projectPersistentStatusView([{ role: 'assistant', turn: 1, text: greeting }], [{turn:1,parts:layers.displayParts}], {regexScripts:displayRules})
      if (view.statusViews.length !== 1 || view.projections.some(p => p.parts.some(part => part.kind === 'html' && /Mvu\.getMvuData|<mvu-status/.test(part.content)))) throw Error('开场 ' + index + ' 状态面板缺失或重复')
      if (view.statusView.content.trim() !== expected.statusHtml.trim()) throw Error('显示替换改变了固定模板，请检查其他正则冲突')
    }
    return '所有开场入口唯一，显示提升到右侧，模型历史不含入口'
  })
  if (trusted) await check('templateSimulation', async () => {
    await simulatePanel(expected.statusHtml, meta.initialState)
    return '固定 HTML 在 DOM 中显示初值，模拟更新及恢复事件后重读最新变量'
  })
  const pending = ['真实模型后台提交与官方 MVU 结算', '浏览器布局、字号与实际会话切换', '原卡复杂脚本、活动预设/全局正则及剧情语义']
  return { valid: checks.every(item => item.status === 'passed'), checks, pending, scope: '自动结构/投影检查及固定模板 DOM 模拟；不代表真实游玩验收' }
}
