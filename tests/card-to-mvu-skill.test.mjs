import {buildMvuArtifacts} from '../tavern-plugin/lib/domain/mvu-conversion-artifacts.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse } from 'yaml'
import { createTavernSkillModule } from '../tavern-plugin/lib/domain/tavern-skills.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { inspectCardExtensions } from '../tavern-plugin/lib/domain/card-extension-reading.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { constantWorldBookContext, mvuUpdateRulesFromWorldBook } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { projectPersistentStatusView } from '../tavern-plugin/lib/domain/persistent-status-view.js'

const root = new URL('../presets/tavern/skills/', import.meta.url)
const backgroundRoot = new URL('../presets/tavern-background/skills/', import.meta.url)
const definition = { initialState: {场景:{地点:'入口'},玩家:{位置:'门口'},人物:{$meta:{extensible:true,template:{姓名:'',位置:'未明确',在场:true}}}}, updateRules: '按正文事实更新玩家位置与人物档案' }
const {entries: recipeEntries, regexScripts: recipeRegex, statusHtml} = buildMvuArtifacts(definition)

test('转换 Skill 可由 Tavern 内置目录读取，引用资源齐全且默认可调用', async () => {
  const skills = createTavernSkillModule({ directory: new URL('../data/skills/', import.meta.url).pathname, builtInDirectory: root.pathname })
  const skill = await skills.read('card-to-mvu')
  assert.equal(skill.source, 'builtin')
  const metadata = parse(skill.content.match(/^---\n([\s\S]*?)\n---/)[1])
  assert.equal(metadata.name, 'card-to-mvu')
  assert.ok(metadata.description.length > 0 && metadata.description.length <= 500)
  assert.notEqual(metadata['disable-model-invocation'], true)
  assert.notEqual(metadata['user-invocable'], false)
  for (const [, relative] of skill.content.matchAll(/\]\(((?:references|assets)\/[^)]+)\)/g)) {
    assert.ok((await readFile(new URL(relative, skillRoot), 'utf8')).length > 0)
  }
})

test('转换 Skill 保留候选项清理和迁移后直接删除要求', async () => {
  const skills = createTavernSkillModule({ directory: new URL('../data/skills/', import.meta.url).pathname, builtInDirectory: root.pathname })
  const skill = await skills.read('card-to-mvu')
  assert.match(skill.content, /删除副本中重复的生成要求/)
  assert.match(skill.content, /保留剧情中的选择、分支条件与实际游戏交互/)
  assert.match(skill.content, /从原位置直接删除已迁移内容及其空标题、空容器/)
  assert.match(skill.content, /不留下.*替代说明、注释或占位文字/)
})

test('人物设计是现有后台 Agent 按需加载的内置 Skill', async () => {
  const cardSkillNames = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  const backgroundSkillNames = (await readdir(backgroundRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  assert.equal(cardSkillNames.includes('character-design'), false)
  assert.deepEqual(backgroundSkillNames, ['character-design'])
  const skills = createTavernSkillModule({ directory: new URL('../data/skills/', import.meta.url).pathname, builtInDirectory: backgroundRoot.pathname })
  const skill = await skills.read('character-design')
  assert.equal(skill.source, 'builtin')
  const metadata = parse(skill.content.match(/^---\n([\s\S]*?)\n---/)[1])
  assert.equal(metadata.name, 'character-design')
  assert.equal(metadata['user-invocable'], false)
  assert.match(skill.content, /提前储备/)
  assert.match(skill.content, /同一个 Agent 会话/)
  assert.match(skill.content, /不创建另一个 Agent/)
  assert.match(skill.content, /普通卡与 MVU 卡/)
  assert.match(skill.content, /不接收变量路径或变量对象/)
  assert.match(skill.content, /character_design_read/)
  assert.match(skill.content, /character_design_save/)
  assert.match(skill.content, /character_design_finish/)
  assert.doesNotMatch(skill.content, /character_design_complete/)
  assert.match(skill.content, /不使用“未明确”“未知”“待定”/)
  assert.match(skill.content, /不设固定数量上限/)
  assert.doesNotMatch(skill.content, /仅在卡片已有人物库/)
  assert.match(skill.content, /本次任务不提交姿势、变量或候选项/)
  assert.match(skill.content, /不[^\n]*前台正文 Agent/)
})

test('Skill 配方可构造可导入卡，规则分流、状态显示及模型历史隔离均有效', () => {
  const entries = recipeEntries
  const regex = JSON.stringify(recipeRegex)
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: '转换配方测试', description: '{{char}} 与 {{user}} 的旅途。',
    first_mes: '你站在门口。\n\n<mvu-status/>',
    character_book: { name: '状态', entries },
    extensions: { tavern_helper: { scripts: [], variables: {} }, regex_scripts: JSON.parse(regex) }
  } }
  const prep = createCardPreparation({ id: () => 'skill-recipe-test', now: () => 1 })
  const workspace = prep.create({ kind: 'import', payload: { kind: 'text', text: JSON.stringify(card) } })
  const exported = prep.present({ card: workspace, as: 'sillytavern-v3' })
  assert.deepEqual(exported.data.character_book, card.data.character_book)
  const extensions = inspectCardExtensions(exported)
  assert.ok(extensions.mvuResources.some(resource => resource.enabled))
  const worldBook = { view: inspectWorldBookDocument(exported) }
  assert.equal(constantWorldBookContext({ worldBook }).context, '')
  assert.deepEqual(mvuUpdateRulesFromWorldBook(worldBook), [entries[1].content])
  const initial = JSON.parse(entries[0].content)
  assert.equal(initial.人物.$meta.extensible, true)
  assert.equal(initial.人物.$meta.template.在场, true)
  assert.equal(initial.人物.$meta.template.位置, '未明确')
  assert.equal(initial.玩家.位置, '门口')
  const layers = projectReplyLayers(card.data.first_mes, { regexScripts: extensions.regexScripts, placement: 2, depth: 0 })
  assert.equal(layers.sessionText.trim(), '你站在门口。')
  const index = layers.displayParts.findIndex(part => part.content?.includes('Mvu.getMvuData'))
  assert.ok(index >= 0)
  const result = projectPersistentStatusView([
    { role: 'assistant', turn: 1, displayRuntime: { frames: [{ partIndex: index, mvuViewUsed: true }] } }
  ], [{ turn: 1, parts: layers.displayParts }], { regexScripts: extensions.regexScripts })
  assert.ok(result.statusView?.content.includes('Mvu.getMvuData'))
  assert.equal(result.statusViews.length, 1)
  assert.ok(result.projections[0].parts.every(part => part.kind !== 'html'))
})

test('通用状态模板重新读取变量并刷新 DOM，支持新增与恢复且跳过内部字段', async () => {
  function node() {
    return { textContent: '', children: [], replaceChildren() { this.children = [] }, append(...children) { this.children.push(...children) } }
  }
  const nodes = { notice: node(), values: node() }
  const handlers = new Map()
  let data = { 玩家: { 位置: '门口' }, 人物: { $meta: { extensible: true } }, __internal: '隐藏' }
  const sandbox = {
    document: { getElementById(id) { return nodes[id] }, createElement: node },
    waitGlobalInitialized: async () => {},
    Mvu: { events: { VARIABLE_INITIALIZED: 'init', VARIABLE_UPDATE_ENDED: 'update' }, getMvuData(options) {
      assert.equal(options.type, 'message'); assert.equal(options.message_id, 'latest')
      return { stat_data: data }
    } },
    tavern_events: { MESSAGE_UPDATED: 'message', SAME_EVENT: 'update' },
    eventOn(event, callback) { assert.equal(handlers.has(event), false); handlers.set(event, callback) }
  }
  vm.runInNewContext(statusHtml.match(/<script>\n([\s\S]*?)<\/script>/)[1], sandbox)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(nodes.values.children.map(item => item.textContent), ['玩家 · 位置', '门口'])
  data = { 玩家: { 位置: '大厅' }, 人物: { 新人物: { 姓名: '<img src=x onerror=alert(1)>' } }, 人物库: {
    预备人物: { 姓名: '暂不展示', 状态: { 在场: false } },
    登场人物: { 姓名: '林晴', 状态: { 在场: true } }
  } }
  handlers.get('update')()
  assert.deepEqual(nodes.values.children.map(item => item.textContent), [
    '玩家 · 位置', '大厅', '人物 · 新人物 · 姓名', '<img src=x onerror=alert(1)>',
    '人物库 · 预备人物 · 姓名', '暂不展示', '人物库 · 预备人物 · 状态 · 在场', 'false',
    '人物库 · 登场人物 · 姓名', '林晴', '人物库 · 登场人物 · 状态 · 在场', 'true'
  ])
  data = { 玩家: { 位置: '门口' } }
  handlers.get('message')()
  assert.deepEqual(nodes.values.children.map(item => item.textContent), ['玩家 · 位置', '门口'])
  data = undefined
  handlers.get('init')()
  assert.equal(nodes.values.children.length, 0)
  assert.ok(nodes.notice.textContent)
})
