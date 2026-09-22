import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { normalizeResourcePath, safeResourceName } from './file-resources.js'
import { createWorldBookLibrary } from './worldbook-library.js'
import { exportCharacterBook } from './worldbook-resource.js'
import { validateCardText } from './card-validation.js'
import { buildMvuArtifacts, isObject, pointerKeys, MVU_CONVERSION_KEY, MVU_MARKER } from './mvu-conversion-artifacts.js'
import { validateMvuConversion } from './mvu-conversion-validation.js'
import { catalog, readConversionValue, readConversionBatch, conversionReading, searchConversionValue, cleanupAudit } from './mvu-conversion-inspection.js'

function cleanupError(code, message, details) {
  const error = new Error(message + ': ' + JSON.stringify(details))
  error.code = code; error.details = details; return error
}
const clone = value => structuredClone(value)
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
export function cardData(document) {
  const raw = document?.kind === 'dsh-tavern-character-workspace' ? document.raw : document
  const data = isObject(raw?.data) ? raw.data : raw
  if (!isObject(data)) throw Error('无法读取人物卡数据')
  return data
}
function outputDigest(document) {
  const copy = clone(document)
  const metadata = cardData(copy).extensions?.[MVU_CONVERSION_KEY]
  if (metadata) delete metadata.outputDigest
  return digest(copy)
}

// Paths and text ranges refer to the same revision-checked source snapshot.
// Resolve all edits before mutating; both array removals and text edits run backwards.
export function applyMvuCleanup(data, cleanup = []) {
  if (!Array.isArray(cleanup)) throw Error('cleanup 必须是数组')
  const permitted = new Set(['description', 'personality', 'scenario', 'first_mes', 'alternate_greetings', 'mes_example', 'system_prompt', 'post_history_instructions', 'character_book', 'extensions'])
  function locate(text, anchor, path, operation, boundary) {
    if (typeof text !== 'string' || typeof anchor !== 'string' || !anchor) throw Error('清理需要非空文字标记: ' + path)
    const start = text.indexOf(anchor)
    if (start < 0 || text.indexOf(anchor, start + 1) !== -1) {
      const candidates = []; let matches = 0, position = start
      while (position >= 0) {
        matches++
        if (candidates.length < 5) candidates.push({ offset:position, context:text.slice(Math.max(0,position-40),position+Math.min(anchor.length,120)+40) })
        position = text.indexOf(anchor, position + 1)
      }
      const details = { operation, path, anchor:boundary, matches, candidates,
        hint: start < 0 ? '按 sourceRevision 读取原卡字段；不要使用副本追加的换行或入口。' : '选择更长的唯一边界；相同结束标签可包含其前方的独特原文。' }
      const error = new Error('清理原文必须恰好匹配一次: ' + JSON.stringify(details))
      error.code = 'CLEANUP_ANCHOR_MISMATCH'; error.details = details; throw error
    }
    return start
  }
  const edits = cleanup.map((edit, operation) => {
    const keys = pointerKeys(edit.path)
    if (!permitted.has(keys[0]) || (keys[0] === 'extensions' && !['regex_scripts', 'tavern_helper'].includes(keys[1])) || (keys[0] === 'character_book' && keys[1] !== 'entries')) throw Error('清理路径不在允许的内容范围: ' + edit.path)
    if (!['replace', 'remove', 'replaceText', 'replaceBlock'].includes(edit.op)) throw Error('无效清理操作: ' + edit.path)
    if (edit.op !== 'remove' && !Object.hasOwn(edit, 'value')) throw Error('替换操作缺少 value: ' + edit.path)
    let parent = data
    for (const key of keys.slice(0, -1)) {
      if (!parent || !Object.hasOwn(parent, key)) throw Error('清理路径不存在: ' + edit.path)
      parent = parent[key]
    }
    const key = keys.at(-1)
    if (Array.isArray(parent) && !/^(0|[1-9]\d*)$/.test(key)) throw Error('数组清理必须使用有效下标: ' + edit.path)
    if (!parent || !Object.hasOwn(parent, key)) throw Error('清理路径不存在: ' + edit.path)
    const before = parent[key]
    if (['replaceText','replaceBlock'].includes(edit.op) && typeof before !== 'string') {
      const suggestedPath = typeof before?.content === 'string' ? edit.path + '/content' : null
      throw cleanupError('CLEANUP_TYPE_MISMATCH','文字清理路径必须指向字符串',{operation,path:edit.path,actualType:Array.isArray(before)?'array':typeof before,suggestedPath,hint:'整项删除使用 remove；修改条目正文使用 content 子路径。'})
    }
    let range
    if (edit.op === 'replaceText' || edit.op === 'replaceBlock') {
      if (typeof edit.value !== 'string') throw Error('文字替换 value 必须是字符串: ' + edit.path)
      const start = locate(before, edit.op === 'replaceText' ? edit.expected : edit.start, edit.path, operation, edit.op === 'replaceText' ? 'expected' : 'start')
      const end = edit.op === 'replaceText' ? start + edit.expected.length : locate(before, edit.end, edit.path, operation, 'end') + edit.end.length
      if (end <= start || (edit.op === 'replaceBlock' && end - edit.end.length < start + edit.start.length)) throw Error('首尾标记顺序错误或重叠: ' + edit.path)
      range = { start, end }
    } else if (Object.hasOwn(edit, 'expected') && !isDeepStrictEqual(before, edit.expected)) throw Error('清理原值不匹配: ' + edit.path)
    return { ...edit, operation, parent, key, keys, range }
  })
  for (let i = 0; i < edits.length; i++) for (let j = 0; j < i; j++) {
    const a = edits[i], b = edits[j]
    if (!a.keys.slice(0, Math.min(a.keys.length, b.keys.length)).every((key, k) => key === b.keys[k])) continue
    if (a.keys.length === b.keys.length && a.range && b.range && (a.range.end <= b.range.start || b.range.end <= a.range.start)) continue
    throw cleanupError('CLEANUP_OVERLAP','清理路径或文字范围重复或互相覆盖',{operations:[b.operation,a.operation],paths:[b.path,a.path],ranges:[b.range || null,a.range || null],hint:'合并重复删除；已被区块覆盖的短片段操作直接移除。'})
  }
  const parents = new Map()
  for (const edit of edits) if (!parents.has(edit.parent)) parents.set(edit.parent, parents.size)
  edits.sort((a, b) => {
    if (a.parent !== b.parent) return parents.get(a.parent) - parents.get(b.parent)
    if (a.key === b.key && a.range && b.range) return b.range.start - a.range.start
    return Array.isArray(a.parent) ? Number(b.key) - Number(a.key) : a.key.localeCompare(b.key)
  })
  for (const edit of edits) {
    if (edit.op === 'remove') {
      if (Array.isArray(edit.parent)) edit.parent.splice(Number(edit.key), 1)
      else delete edit.parent[edit.key]
    } else if (edit.range) {
      const text = edit.parent[edit.key]
      edit.parent[edit.key] = text.slice(0, edit.range.start) + edit.value + text.slice(edit.range.end)
    } else edit.parent[edit.key] = clone(edit.value)
  }
  return data
}

export function createMvuConversion({ resources }) {
  const books = createWorldBookLibrary({ normalizePath: normalizeResourcePath,
    resources: { readText: resources.readText, bindingForCard: resources.worldBookBindingForCard },
    cards: { read: async path => { const document = await resources.readCard(path); return document === undefined ? undefined : cardData(document) } },
    removeStandalone: () => { throw Error('转换读取不能删除世界书') }
  })
  const resolveWorldbook = (path, card) => books.bound(path, card)
  let tail = Promise.resolve()
  async function snapshot(path) {
    const sourcePath = normalizeResourcePath(path, 'card')
    const text = await resources.readText(sourcePath)
    if (text === undefined) throw Error('人物卡不存在: ' + sourcePath)
    const document = JSON.parse(text), original = cardData(document)
    const worldbook = await resolveWorldbook(sourcePath, original)
    const data = clone(original)
    const effectiveBook = worldbook ? exportCharacterBook(worldbook.document) : { name: original.name + '世界书', entries: [] }
    const activeSources = worldbook?.mergedSources?.map(item => item.source) || [worldbook?.source]
    const ownBookIsActive = activeSources.some(item => item?.kind === 'card' && item.cardPath === sourcePath)
    const preservedBook = original.character_book && !ownBookIsActive ? clone(original.character_book) : undefined
    data.character_book = effectiveBook
    return { sourcePath, text, document, data, preservedBook, revision: digest([text, worldbook?.document ?? null, worldbook?.source ?? null, worldbook?.mergedSources ?? null]) }
  }
  function targetFor(source, name) {
    const stem = safeResourceName(name || source.data.name + ' MVU版本').replace(/\.json$/i, '')
    const path = normalizeResourcePath('cards/' + stem + '.json', 'card')
    if (path === source.sourcePath) throw Error('转换必须保存为独立副本')
    return { path, name: stem }
  }
  async function inspect(args) {
    const source = await snapshot(args.sourcePath), target = targetFor(source, args.name)
    const existing = await resources.readText(target.path)
    let existingTarget = null, targetError = null
    try { existingTarget = existing === undefined ? null : cardData(JSON.parse(existing)) }
    catch { targetError = '目标 JSON 已损坏；请通过资源恢复功能恢复副本后重新 inspect，不直接删除资源文件。' }
    const metadata = existingTarget?.extensions?.[MVU_CONVERSION_KEY]
    return { sourcePath: source.sourcePath, sourceRevision: source.revision, targetPath: target.path,
      targetRevision: existing === undefined ? null : digest(existing),
      catalog: catalog(source.data),
      ...(args.detail === undefined || args.detail === 'reading' ? {reading:conversionReading(source.data)} : {}),
      destination: await resources.inspectMvuDestination(target.path),
      target: existing === undefined ? null : { catalog: existingTarget ? catalog(existingTarget) : [], error: targetError,
        hasSavedPlan: Array.isArray(metadata?.cleanup), externallyModified: existingTarget ? metadata?.outputDigest !== outputDigest(JSON.parse(existing)) : true },
      ...(args.detail === 'full' ? {card:source.data, existingTarget, preservedInactiveWorldbook:source.preservedBook ?? null} : {}),
      capabilities: { customAppearance:false, sharedInitialState:true, openingCount:1+(source.data.alternate_greetings?.length || 0), preservedInactiveWorldbook:!!source.preservedBook },
      instruction: 'reading 已含原文，只续读未完整展示的必要字段，可用 paths 批量读取。source/target 均是规范化生效字段，不检查磁盘包装镜像。用 read/search 按 sourceRevision 读取来源字段；scope=plan 可读已保存方案。apply 默认合并方案：省略的定义及已有清理保留，新清理追加并去重；cleanupResetPaths 先清除指定路径的旧操作。planMode=replace 才整份替换。preview 不落盘。' }
  }
  async function read(args) {
    const source = await snapshot(args.sourcePath)
    if (!args.sourceRevision || args.sourceRevision !== source.revision) throw Error('来源或世界书已变化，请重新 inspect')
    let value = source.data
    if (args.scope === 'preservedWorldbook') value = source.preservedBook ?? null
    else if (args.scope === 'target' || args.scope === 'plan') {
      const target = targetFor(source, args.name), text = await resources.readText(target.path)
      if (text === undefined || !args.targetRevision || digest(text) !== args.targetRevision) throw Error('目标副本已有变更，请重新 inspect 并提供 targetRevision')
      const data = cardData(JSON.parse(text))
      const meta = data.extensions?.[MVU_CONVERSION_KEY]
      value = args.scope === 'target' ? data : meta ? Object.fromEntries(['initialState','updateRules','displayFields','cleanup'].filter(key=>Object.hasOwn(meta,key)).map(key=>[key,meta[key]])) : null
    } else if (args.scope && args.scope !== 'source') throw Error('未知读取 scope')
    return { sourceRevision:source.revision, ...(args.scope === 'target' || args.scope === 'plan' ? {targetRevision:args.targetRevision} : {}),
      ...(args.action === 'search' ? searchConversionValue(value,args) : args.paths ? readConversionBatch(value,args) : readConversionValue(value,args)) }
  }
  async function apply(input) {
    const args = { ...input }
    const source = await snapshot(args.sourcePath), target = targetFor(source, args.name)
    if (!args.sourceRevision || source.revision !== args.sourceRevision) throw Error('来源或世界书已变化，请重新 inspect')
    if (source.data.extensions?.[MVU_CONVERSION_KEY]) throw Error('请以原卡为来源更新现有 MVU 副本，不对转换结果重复转换')
    const availability = await resources.inspectMvuDestination(target.path)
    if (!availability.available) throw Error(availability.reason)
    const existingText = await resources.readText(target.path)
    if (args.planMode && !['merge','replace'].includes(args.planMode)) throw Error('planMode 必须为 merge 或 replace')
    let existing, metadata
    if (existingText !== undefined) {
      try { existing = JSON.parse(existingText) } catch { throw Error('目标 JSON 已损坏，请恢复资源后重新 inspect') }
      metadata = cardData(existing).extensions?.[MVU_CONVERSION_KEY]
      if (metadata?.sourcePath !== source.sourcePath || metadata.version !== 1) throw Error('目标名称已被其他资源占用，请换名')
      if (args.planMode !== 'replace') {
        if (!Array.isArray(metadata.cleanup)) throw Error('旧副本没有保存完整方案；读取来源后以 planMode=replace 提交完整定义和清理')
        if (metadata.sourceRevision !== source.revision) throw Error('原卡已变化，旧清理路径不能合并；重新读取后以 planMode=replace 提交完整方案')
        if (metadata.outputDigest !== outputDigest(existing)) throw Error('目标副本已有变更，含方案外修改；读取 scope=target 后将保留修改纳入 planMode=replace 完整方案')
        const reset = args.cleanupResetPaths ?? []
        if (!Array.isArray(reset)) throw Error('cleanupResetPaths 必须是路径数组')
        for (const path of reset) pointerKeys(path)
        const cleanup = metadata.cleanup.filter(edit => !reset.includes(edit.path))
        if (args.cleanup !== undefined && !Array.isArray(args.cleanup)) throw Error('cleanup 必须是数组')
        for (const edit of args.cleanup || []) if (!cleanup.some(old => isDeepStrictEqual(old, edit))) cleanup.push(clone(edit))
        for (const key of ['initialState','updateRules','displayFields']) if (!Object.hasOwn(args,key)) args[key] = clone(metadata[key])
        args.cleanup = cleanup
      }
    } else if (args.targetRevision) throw Error('目标副本已不存在，请重新 inspect')
    const requestHash = digest({ sourceRevision:source.revision,name:target.name,initialState:args.initialState,updateRules:args.updateRules,displayFields:args.displayFields || [],cleanup:args.cleanup || [] })
    if (existingText !== undefined) {
      if (metadata.requestHash === requestHash && metadata.outputDigest === outputDigest(existing)) {
        if (input.action === 'preview') return {path:target.path,saved:false,changed:false,validation:await verify({path:target.path}),nextAction:'自动验收已返回；无具体失败或用户要求实测时，直接报告结果与待实测项。'}
        const saved = await resources.saveMvuCard({sourcePath:source.sourcePath,targetPath:target.path,document:existing,expectedSourceText:source.text,expectedTargetText:existingText})
        return {path:target.path,changed:saved.changed,imageCopied:saved.imageCopied,validation:await verify({path:target.path}),nextAction:'自动验收已返回；无具体失败或用户要求实测时，直接报告结果与待实测项。'}
      }
      if (!args.targetRevision || args.targetRevision !== digest(existingText)) throw Error('目标副本已有变更，请重新 inspect 并提供 targetRevision')
    }
    const artifacts = buildMvuArtifacts(args)
    const data = applyMvuCleanup(clone(source.data), args.cleanup)
    data.name = target.name
    data.extensions ??= {}
    const entries = data.character_book?.entries
    if (!Array.isArray(entries)) throw Error('清理后世界书 entries 必须为数组')
    if (entries.some(entry => /^\s*\[(?:initvar|mvu_update)\]/i.test(entry.comment || entry.name || ''))) throw Error('已有 MVU 初值或规则，请明确清理/合并后再转换')
    const regex = data.extensions.regex_scripts ?? []
    if (!Array.isArray(regex)) throw Error('regex_scripts 必须为数组')
    if (regex.some(rule => /StatusPlaceHolderImpl|<[a-z0-9-]*-status\b/i.test(rule.findRegex || '') || artifacts.regexScripts.some(owned => owned.id === rule.id))) throw Error('仍有旧状态正则，请先明确清理，避免重复面板')
    const used = new Set(entries.map((entry, index) => entry.id ?? index)); let next = 0
    for (const entry of artifacts.entries) { while (used.has(next)) next++; entries.push({ ...entry, id: next }); used.add(next++) }
    data.extensions.regex_scripts = regex.concat(artifacts.regexScripts)
    const greeting = text => {
      if (typeof text !== 'string' || !text.trim()) throw Error('每个开场必须有正文')
      if (text.includes(MVU_MARKER)) throw Error('开场仍有旧 MVU 入口，请明确清理')
      return text.trimEnd() + '\n\n' + MVU_MARKER
    }
    data.first_mes = greeting(data.first_mes)
    if (data.alternate_greetings !== undefined) data.alternate_greetings = data.alternate_greetings.map(greeting)
    const document = clone(source.document), destination = cardData(document)
    for (const key of Object.keys(destination)) delete destination[key]
    Object.assign(destination, data)
    delete document.id; delete document.path
    // The storage layer supplies a fresh workspace ID on first creation.
    if (document.meta) document.meta = { ...document.meta, id: existingText ? JSON.parse(existingText).meta?.id : undefined }
    destination.extensions[MVU_CONVERSION_KEY] = { version: 1, sourcePath: source.sourcePath, sourceRevision: source.revision, requestHash,
      initialState: clone(args.initialState), updateRules: args.updateRules, displayFields: clone(args.displayFields || []), cleanup: clone(args.cleanup || []),
      ...(source.preservedBook ? { preservedWorldbook: source.preservedBook } : {}) }
    const staticCheck = validateCardText(JSON.stringify(document))
    if (!staticCheck.valid) throw Error('成品校验失败: ' + JSON.stringify(staticCheck.errors))
    const check = await validateMvuConversion(data)
    const audit = cleanupAudit(source.data,args.cleanup || [],data)
    check.checks.push(audit.check); check.changes = audit.changes; check.removedEntries = audit.removedEntries; check.preservedEntries = audit.preservedEntries; check.valid &&= audit.check.status === 'passed'
    check.pending.push('原卡语义与未识别旧协议需按 changes 清单确认；多开场共享初值，自定义外观未迁移')
    if (input.action === 'preview') return {path:target.path,saved:false,validation:check}
    if (!check.valid) throw Error('转换预检失败: ' + JSON.stringify(check.checks.filter(item => item.status === 'failed')))
    if ((await snapshot(source.sourcePath)).revision !== source.revision) throw Error('转换期间来源发生变化，请重新 inspect')
    const saved = await resources.saveMvuCard({ sourcePath: source.sourcePath, targetPath: target.path, document, expectedSourceText: source.text, expectedTargetText: existingText, finalize: output => { cardData(output).extensions[MVU_CONVERSION_KEY].outputDigest = outputDigest(output) } })
    return { path: target.path, changed: saved.changed, imageCopied: saved.imageCopied, validation: await verify({ path: target.path }), nextAction: '已保存并从磁盘自动验收；无具体失败时直接报告差异与待实测项，无需再次 validate 或检查包装镜像、全局预设。' }
  }
  async function verify({ path }) {
    const text = await resources.readText(normalizeResourcePath(path, 'card'))
    if (text === undefined) throw Error('人物卡不存在')
    const format = validateCardText(text)
    if (!format.valid) return { valid: false, checks: [{ name: 'format', status: 'failed', detail: JSON.stringify(format.errors) }] }
    const document = JSON.parse(text), data = cardData(document)
    const result = await validateMvuConversion(data)
    const meta = data.extensions?.[MVU_CONVERSION_KEY]
    if (Array.isArray(meta?.cleanup)) {
      const intact = meta.outputDigest === outputDigest(document)
      result.checks.push({name:'planIntegrity',status:intact ? 'passed' : 'failed',detail:intact ? '成品与保存方案一致，未发现方案外修改' : '成品存在方案外修改，需重新纳入转换方案'})
      result.valid &&= intact
      try {
        const source = await snapshot(meta.sourcePath)
        if (source.revision !== meta.sourceRevision) throw Error('来源已变化，无法核对原转换底稿')
        const audit = cleanupAudit(source.data,meta.cleanup,data)
        result.changes = audit.changes; result.removedEntries = audit.removedEntries; result.preservedEntries = audit.preservedEntries; result.checks.push(audit.check); result.valid &&= audit.check.status === 'passed'
      } catch (error) {
        result.checks.push({name:'sourceAudit',status:'failed',detail:error.message}); result.valid = false
      }
    } else result.pending.push('旧副本未保存完整转换方案，无法核对清理清单与方案外修改')
    result.pending.push('核对 changes 的删除条目及剧情语义；多开场共用初值，自定义外观未迁移')
    const binding = await resources.worldBookBindingForCard(path)
    const bound = binding.kind === 'embedded' && binding.cardPath === path
    result.checks.unshift({ name: 'binding', status: bound ? 'passed' : 'failed', detail: bound ? '副本绑定自己的世界书' : '副本未绑定自己的世界书' })
    result.valid &&= bound
    return result
  }
  function convert(args) {
    if (args.action === 'inspect') return inspect(args)
    if (args.action === 'read' || args.action === 'search') return read(args)
    if (!['apply','preview'].includes(args.action)) throw Error('action 必须为 inspect/read/search/preview/apply')
    const job = tail.then(() => apply(args)); tail = job.catch(() => {}); return job
  }
  return { convert, verify }
}
