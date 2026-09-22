import { isDeepStrictEqual } from 'node:util'
import { pointerKeys } from './mvu-conversion-artifacts.js'

const escape = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1')
export function valueAt(value, path) {
  if (path === '' || path === undefined) return value
  for (const key of pointerKeys(path)) {
    if (!value || !Object.hasOwn(value, key)) throw Error('读取路径不存在: ' + path)
    value = value[key]
  }
  return value
}
function describe(value, path) {
  return { path, type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
    size: typeof value === 'string' || Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0,
    ...(value && typeof value === 'object' && !Array.isArray(value) ? {
      label: String(value.comment || value.scriptName || value.name || '').slice(0, 160),
      ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {})
    } : {}) }
}
export function catalog(value, path = '') {
  const selected = valueAt(value, path)
  if (!selected || typeof selected !== 'object') return [describe(selected, path)]
  return Object.entries(selected).map(([key, child]) => describe(child, path + '/' + escape(key)))
}
function bounded(value, fallback, maximum) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0) throw Error('offset/limit 必须为非负整数')
  return Math.min(value, maximum)
}
export function readConversionValue(value, { path = '', offset, limit }) {
  const selected = valueAt(value, path), start = bounded(offset, 0, Number.MAX_SAFE_INTEGER)
  const text = typeof selected === 'string'
  const count = Math.max(1, bounded(limit, text ? 4000 : 50, text ? 8000 : 100))
  if (selected !== null && typeof selected === 'object') {
    const rows = catalog(value, path), end = Math.min(rows.length, start + count)
    return { path, catalog: rows.slice(start, end), total: rows.length, nextOffset: end < rows.length ? end : null }
  }
  if (!text) return { path, value: selected }
  const end = Math.min(selected.length, start + count)
  return { path, text: selected.slice(start, end), offset: start, total: selected.length, nextOffset: end < selected.length ? end : null }
}
export function searchConversionValue(value, { query, path = '', offset, limit }) {
  if (typeof query !== 'string' || !query || query.length > 1000) throw Error('query 必须为 1–1000 字符的原文片段')
  const skip = bounded(offset, 0, Number.MAX_SAFE_INTEGER), count = Math.max(1, bounded(limit, 20, 40))
  let total = 0; const matches = []
  function visit(selected, at) {
    if (typeof selected === 'string') {
      let position = selected.indexOf(query)
      while (position >= 0) {
        if (total >= skip && matches.length < count) matches.push({path:at,offset:position,context:selected.slice(Math.max(0,position-50),position+Math.min(query.length,160)+50)})
        total++; position = selected.indexOf(query, position + query.length)
      }
    } else if (selected && typeof selected === 'object') {
      for (const [key, child] of Object.entries(selected)) visit(child, at + '/' + escape(key))
    }
  }
  visit(valueAt(value, path), path)
  return { matches, total, nextOffset: skip + matches.length < total ? skip + matches.length : null }
}

// Use literal source-renderer tags as evidence, never execute imported regex or JS.
// Unknown protocols remain a manual review item; no content is deleted heuristically.
export function cleanupAudit(source, cleanup, output) {
  const changes = cleanup.map((edit, operation) => {
    const before = valueAt(source, edit.path)
    return { operation, op:edit.op, path:edit.path,
      ...(before && typeof before === 'object' ? {label:String(before.comment || before.scriptName || before.name || '').slice(0,160),...(typeof before.enabled === 'boolean' ? {enabled:before.enabled} : {})} : {}),
      ...(edit.reason ? {reason:edit.reason} : {}) }
  })
  const tags = new Set()
  for (const [index, rule] of (source.extensions?.regex_scripts || []).entries()) {
    const path = '/extensions/regex_scripts/' + index
    if (!cleanup.some(edit => edit.path === path || edit.path.startsWith(path + '/'))) continue
    // A renderer must both recognize an explicit tag and emit HTML.
    if (!/<[a-z][^>]*>/i.test(rule.replaceString || '')) continue
    for (const match of String(rule.findRegex || '').matchAll(/<([\p{L}_][\p{L}\p{N}_-]*)>/gu)) tags.add(match[0])
  }
  const residuals = []
  for (const [index, text] of [output.first_mes, ...(output.alternate_greetings || [])].entries()) {
    for (const tag of tags) if (typeof text === 'string' && text.includes(tag)) residuals.push({path:index ? '/alternate_greetings/' + (index-1) : '/first_mes',tag})
  }
  const remainingEntries = output.character_book?.entries || []
  const removedEntries = [], preservedEntries = []
  for (const [index, entry] of (source.character_book?.entries || []).entries()) {
    const row = {path:'/character_book/entries/'+index,label:String(entry.comment || entry.name || '').slice(0,160),enabled:entry.enabled}
    if (remainingEntries.some(current => isDeepStrictEqual(current,entry))) preservedEntries.push(row)
    else if (!remainingEntries.some(current => current.id === entry.id && !/^\s*\[(?:initvar|mvu_update)\]/i.test(current.comment || current.name || ''))) removedEntries.push(row)
  }
  return { changes, removedEntries, preservedEntries, residuals, check: {name:'legacyResidue',status:residuals.length ? 'failed' : 'passed',
    detail:residuals.length ? '旧渲染协议残留: '+JSON.stringify(residuals) : '未发现来源正则中可识别的标签协议残留；其他格式需人工确认'} }
}
