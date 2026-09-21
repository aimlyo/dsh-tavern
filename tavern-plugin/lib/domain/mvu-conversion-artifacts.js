import { readFile } from 'node:fs/promises'

export const MVU_CONVERSION_KEY = 'dsh_mvu_conversion'
export const MVU_MARKER = '<mvu-status/>'
export const MVU_RULE_IDS = ['dsh-mvu-status-view', 'dsh-mvu-hide-marker']
const template = await readFile(new URL('./assets/mvu-status.html', import.meta.url), 'utf8')
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export function pointerKeys(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || /~(?![01])/u.test(path)) throw Error('需要有效的 JSON Pointer: ' + path)
  const keys = path.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw Error('不支持的路径: ' + path)
  return keys
}
export function buildMvuArtifacts({ initialState, updateRules, displayFields = [] }) {
  if (!isObject(initialState) || !Object.keys(initialState).length) throw Error('initialState 必须是非空变量对象，不包裹 stat_data')
  if (Object.hasOwn(initialState, 'stat_data')) throw Error('initialState 不应包裹 stat_data')
  if (typeof updateRules !== 'string' || !updateRules.trim()) throw Error('updateRules 必须说明状态变化依据')
  if (!Array.isArray(displayFields)) throw Error('displayFields 必须是数组')
  const fields = displayFields.map(field => {
    if (!isObject(field) || field.label !== undefined && typeof field.label !== 'string') throw Error('展示字段需要 path 和文本 label')
    const keys = pointerKeys(field.path)
    let value = initialState
    for (const key of keys) {
      if (!isObject(value) && !Array.isArray(value) || !Object.hasOwn(value, key)) throw Error('展示路径不存在于初值: ' + field.path)
      value = value[key]
    }
    return { keys, label: field.label || keys.join(' · ') }
  })
  // Values are JS string data, not regex replacement captures or identity macros.
  const statusHtml = template.replace('__DSH_MVU_FIELDS__', () => JSON.stringify(fields).replace(/</g, '\\u003c').replace(/\$/g, () => '\\u0024').replace(/\{\{/g, () => '\\u007b\\u007b').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')).replace(/\$/g, () => '\\u0024')
  const entries = [
    { keys: [], comment: '[initvar]状态初值', enabled: false, constant: false, insertion_order: 100, content: JSON.stringify(initialState, null, 2), extensions: {} },
    { keys: [], comment: '[mvu_update]状态更新规则', enabled: true, constant: true, insertion_order: 100,
      content: updateRules.trim() + '\n\n依据本轮已经发生的正文事实和当前变量快照，用 mvu_submit_update 提交。路径相对于 stat_data；无变化提交空 operations。', extensions: {} }
  ]
  const regexScripts = [
    { id: MVU_RULE_IDS[0], scriptName: 'MVU 状态视图', findRegex: '/<mvu-status\\s*\\/>/g', replaceString: '```html\n' + statusHtml + '\n```', placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true },
    { id: MVU_RULE_IDS[1], scriptName: '隐藏模型历史中的状态入口', findRegex: '/\\n*<mvu-status\\s*\\/>/g', replaceString: '', placement: [2], disabled: false, markdownOnly: false, promptOnly: true, runOnEdit: true }
  ]
  return { entries, regexScripts, statusHtml }
}
