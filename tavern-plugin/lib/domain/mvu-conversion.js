import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { normalizeResourcePath, safeResourceName } from './file-resources.js'
import { createWorldBookLibrary } from './worldbook-library.js'
import { exportCharacterBook } from './worldbook-resource.js'
import { validateCardText } from './card-validation.js'
import { buildMvuArtifacts, isObject, pointerKeys, MVU_CONVERSION_KEY, MVU_MARKER } from './mvu-conversion-artifacts.js'
import { validateMvuConversion } from './mvu-conversion-validation.js'

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

// All paths refer to the inspected card object. Compare every precondition before
// applying any edit; delete array elements backwards so adjacent removals are safe.
export function applyMvuCleanup(data, cleanup = []) {
  if (!Array.isArray(cleanup)) throw Error('cleanup 必须是数组')
  const permitted = new Set(['description', 'personality', 'scenario', 'first_mes', 'alternate_greetings', 'mes_example', 'system_prompt', 'post_history_instructions', 'character_book', 'extensions'])
  const edits = cleanup.map(edit => {
    const keys = pointerKeys(edit.path)
    if (!permitted.has(keys[0]) || (keys[0] === 'extensions' && !['regex_scripts', 'tavern_helper'].includes(keys[1])) || (keys[0] === 'character_book' && keys[1] !== 'entries')) throw Error('清理路径不在允许的内容范围: ' + edit.path)
    if (!['replace', 'remove', 'replaceText'].includes(edit.op) || !Object.hasOwn(edit, 'expected')) throw Error('清理操作需要 op 和 expected: ' + edit.path)
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
    if (edit.op === 'replaceText') {
      if (typeof before !== 'string' || typeof edit.expected !== 'string' || !edit.expected || typeof edit.value !== 'string' || before.split(edit.expected).length !== 2) throw Error('清理原文必须恰好匹配一次: ' + edit.path)
    } else if (!isDeepStrictEqual(before, edit.expected)) throw Error('清理原值不匹配: ' + edit.path)
    return { ...edit, parent, key, keys }
  })
  for (let i = 0; i < edits.length; i++) for (let j = 0; j < i; j++) {
    const a = edits[i].keys, b = edits[j].keys
    if (a.slice(0, Math.min(a.length, b.length)).every((key, k) => key === b[k])) throw Error('清理路径重复或互相覆盖，请合并操作')
  }
  edits.sort((a, b) => a.parent === b.parent && Array.isArray(a.parent) ? Number(b.key) - Number(a.key) : 0)
  for (const edit of edits) {
    if (edit.op === 'remove') {
      if (Array.isArray(edit.parent)) edit.parent.splice(Number(edit.key), 1)
      else delete edit.parent[edit.key]
    } else edit.parent[edit.key] = edit.op === 'replaceText' ? edit.parent[edit.key].replace(edit.expected, () => edit.value) : clone(edit.value)
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
    return { sourcePath: source.sourcePath, sourceRevision: source.revision, targetPath: target.path,
      targetRevision: existing === undefined ? null : digest(existing), card: source.data,
      existingTarget: existing === undefined ? null : cardData(JSON.parse(existing)),
      preservedInactiveWorldbook: source.preservedBook ?? null,
      instruction: 'cleanup 的路径相对于 card；只删除已确认被替代的内容。apply 带回 sourceRevision；覆盖已有转换副本还需 targetRevision。' }
  }
  async function apply(args) {
    const source = await snapshot(args.sourcePath), target = targetFor(source, args.name)
    if (!args.sourceRevision || source.revision !== args.sourceRevision) throw Error('来源或世界书已变化，请重新 inspect')
    if (source.data.extensions?.[MVU_CONVERSION_KEY]) throw Error('请以原卡为来源更新现有 MVU 副本，不对转换结果重复转换')
    const requestHash = digest({ sourceRevision: source.revision, name: target.name, initialState: args.initialState, updateRules: args.updateRules, displayFields: args.displayFields || [], cleanup: args.cleanup || [] })
    const existingText = await resources.readText(target.path)
    if (existingText !== undefined) {
      const existing = JSON.parse(existingText), metadata = cardData(existing).extensions?.[MVU_CONVERSION_KEY]
      if (metadata?.sourcePath !== source.sourcePath || metadata.version !== 1) throw Error('目标名称已被其他资源占用，请换名')
      if (metadata.requestHash === requestHash && metadata.outputDigest === outputDigest(existing)) {
        const saved = await resources.saveMvuCard({ sourcePath: source.sourcePath, targetPath: target.path, document: existing, expectedSourceText: source.text, expectedTargetText: existingText })
        return { path: target.path, changed: saved.changed, imageCopied: saved.imageCopied, validation: await verify({ path: target.path }) }
      }
      if (!args.targetRevision || args.targetRevision !== digest(existingText)) throw Error('目标副本已有变更，请重新 inspect 并提供 targetRevision')
    } else if (args.targetRevision) throw Error('目标副本已不存在，请重新 inspect')
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
      initialState: clone(args.initialState), updateRules: args.updateRules, displayFields: clone(args.displayFields || []),
      ...(source.preservedBook ? { preservedWorldbook: source.preservedBook } : {}) }
    const staticCheck = validateCardText(JSON.stringify(document))
    if (!staticCheck.valid) throw Error('成品校验失败: ' + JSON.stringify(staticCheck.errors))
    const check = await validateMvuConversion(data)
    if (!check.valid) throw Error('转换预检失败: ' + JSON.stringify(check.checks.filter(item => item.status === 'failed')))
    if ((await snapshot(source.sourcePath)).revision !== source.revision) throw Error('转换期间来源发生变化，请重新 inspect')
    const saved = await resources.saveMvuCard({ sourcePath: source.sourcePath, targetPath: target.path, document, expectedSourceText: source.text, expectedTargetText: existingText, finalize: output => { cardData(output).extensions[MVU_CONVERSION_KEY].outputDigest = outputDigest(output) } })
    return { path: target.path, changed: saved.changed, imageCopied: saved.imageCopied, validation: await verify({ path: target.path }) }
  }
  async function verify({ path }) {
    const text = await resources.readText(normalizeResourcePath(path, 'card'))
    if (text === undefined) throw Error('人物卡不存在')
    const format = validateCardText(text)
    if (!format.valid) return { valid: false, checks: [{ name: 'format', status: 'failed', detail: JSON.stringify(format.errors) }] }
    const result = await validateMvuConversion(cardData(JSON.parse(text)))
    const binding = await resources.worldBookBindingForCard(path)
    const bound = binding.kind === 'embedded' && binding.cardPath === path
    result.checks.unshift({ name: 'binding', status: bound ? 'passed' : 'failed', detail: bound ? '副本绑定自己的世界书' : '副本未绑定自己的世界书' })
    result.valid &&= bound
    return result
  }
  function convert(args) {
    if (args.action === 'inspect') return inspect(args)
    if (args.action !== 'apply') throw Error('action 必须为 inspect 或 apply')
    const job = tail.then(() => apply(args)); tail = job.catch(() => {}); return job
  }
  return { convert, verify }
}
