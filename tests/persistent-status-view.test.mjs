import assert from 'node:assert/strict'
import test from 'node:test'

import { projectPersistentStatusView } from '../tavern-plugin/lib/domain/persistent-status-view.js'

function projection(turn, parts) {
  return { version: 2, turn, mode: 'html', text: '', parts, warnings: [] }
}

test('MVU 读写不是面板用途声明，多开档前端全部保留在原消息', () => {
  const parts = [{ kind: 'html', content: '<script>createCharacter()</script>' },
    { kind: 'html', content: '<script>editInventory()</script>' }]
  const messages = [{ role: 'assistant', turn: 1, displayRuntime: { frames: [
    { partIndex: 0, mvuViewUsed: true }, { partIndex: 1, mvuViewUsed: true }] } }, { role: 'assistant', turn: 5 }]
  const projections = [projection(1, parts)]
  const result = projectPersistentStatusView(messages, projections)
  assert.equal(result.statusView, null)
  assert.deepEqual(result.statusViews, [])
  assert.deepEqual(result.projections, projections)
})

test('多个声明模板有稳定独立身份，重复模板只挂载一次，换轮不改变身份', () => {
  const rules = ['hp', 'inventory', 'hp'].map(name => ({ name, enabled: true, placement: [2], markdownOnly: true,
    findRegex: '/<StatusPlaceHolderImpl\\/>/g', replaceString: '<script>' + name + '()</script>' }))
  const result = projectPersistentStatusView([{ role: 'assistant', turn: 3 }], [], { regexScripts: rules })
  const next = projectPersistentStatusView([{ role: 'assistant', turn: 4 }], [], { regexScripts: rules })
  assert.equal(result.statusViews.length, 2)
  assert.notEqual(result.statusViews[0].viewId, result.statusViews[1].viewId)
  assert.deepEqual(result.statusViews.map(v => v.viewId), next.statusViews.map(v => v.viewId))
  assert.ok(next.statusViews.every(v => v.targetTurn === 4))
})

test('声明状态栏的卡保留开局页，正文推进后使用声明模板而非 MVU 开局页', () => {
  const opening = '<script>loadCustomStart()</script>'
  const status = '<script>loadRealStatus()</script>'
  const regexScripts = [{ enabled: true, placement: [2], markdownOnly: true,
    findRegex: '<StatusPlaceHolderImpl/>', replaceString: '```html\n' + status + '\n```', maxDepth: 2 }]
  const messages = [{ role: 'assistant', turn: 1, displayRuntime: { frames: [{ partIndex: 0, mvuViewUsed: true }] } }]
  const projections = [projection(1, [{ kind: 'html', content: opening }])]
  const initial = projectPersistentStatusView(messages, projections, { regexScripts })
  assert.equal(initial.statusView, null)
  assert.deepEqual(initial.projections, projections)
  const advanced = projectPersistentStatusView([...messages, { role: 'assistant', turn: 6, text: '抵达庄园' }], projections, { regexScripts })
  assert.match(advanced.statusView.content, /loadRealStatus/)
  assert.equal(advanced.statusView.targetTurn, 6)
  assert.deepEqual(advanced.projections, projections)
  assert.equal(projectPersistentStatusView([...messages, { role: 'assistant', turn: 6 }], [], { regexScripts }).statusView.targetTurn, 6)
})

test('声明模板在开场已出现时立即提升，禁用声明不加载远程页面', () => {
  const content = '<script>loadRealStatus()</script>'
  const rule = { enabled: true, placement: [2], markdownOnly: true,
    findRegex: '<StatusPlaceHolderImpl/>', replaceString: content }
  const messages = [{ role: 'assistant', turn: 1 }]
  const projections = [projection(1, [{ kind: 'html', content }])]
  const result = projectPersistentStatusView(messages, projections, { regexScripts: [rule] })
  assert.equal(result.statusView.content, content)
  assert.deepEqual(result.projections[0].parts, [])
  for (const disabled of [{ enabled: false }, { disabled: true }]) {
    assert.equal(projectPersistentStatusView([...messages, { role: 'assistant', turn: 2 }], [],
      { regexScripts: [{ ...rule, ...disabled }] }).statusView, null)
  }
})

test('persistent templates resolve identity macros like inline replies and remove the duplicate', () => {
  const raw = '<script>const title = "{{user}}档案 / {{char}}"; const untouched = "{{random::a::b}}";</script>'
  const content = raw.replace('{{user}}', '旅人').replace('{{char}}', '鸣潮')
  const options = { macroState: { userName: '旅人' }, charName: '鸣潮', regexScripts: [{ placement: [2], markdownOnly: true, findRegex: '<StatusPlaceHolderImpl/>', replaceString: raw }] }
  const result = projectPersistentStatusView([{ role: 'assistant', turn: 1 }], [projection(1, [{ kind: 'html', content }])], options)
  assert.equal(result.statusView?.content, content)
  assert.deepEqual(result.projections[0].parts, [])
  assert.equal(result.statusView.sourceTurn, 1)
  const next = projectPersistentStatusView([{ role: 'assistant', turn: 2 }], [], options)
  assert.equal(next.statusView.viewId, result.statusView.viewId)
  assert.match(next.statusView.content, /\{\{random::a::b\}\}/)
})

test('开场状态入口被模板同步移除后，已显示过的同一声明状态栏仍保留', () => {
  const content = '<script>loadRealStatus()</script>'
  const rule = { enabled: true, placement: [2], markdownOnly: true, findRegex: '<StatusPlaceHolderImpl/>', replaceString: content }
  const initial = projectPersistentStatusView([{ role: 'assistant', turn: 1 }], [projection(1, [{ kind: 'html', content }])], { regexScripts: [rule] })
  const messages = [{ role: 'assistant', turn: 1, text: '开场正文', displayRuntime: { frames: [{ placement: 'sidebar', panelId: initial.statusView.viewId, partIndex: 1 }] } }]
  const next = projectPersistentStatusView(messages, [], { regexScripts: [rule] })
  assert.equal(next.statusView.viewId, initial.statusView.viewId)
  assert.equal(projectPersistentStatusView(messages, [], { regexScripts: [{ ...rule, enabled: false }] }).statusView, null)
  const edited = projectPersistentStatusView(messages, [], { regexScripts: [{ ...rule, replaceString: '<script>other()</script>' }] }).statusView
  assert.equal(edited.viewId, initial.statusView.viewId)
  assert.match(edited.content, /other/)
})

test('状态模板复用编译，但旧消息来源、最新轮次、规则和身份变化仍生效', async () => {
  const {createPersistentStatusProjector} = await import('../tavern-plugin/lib/domain/persistent-status-view.js')
  const project = createPersistentStatusProjector()
  const rule = { findRegex: '<StatusPlaceHolderImpl/>', replaceString: '<html><script>show("{{user}}")</script></html>', placement: [2], markdownOnly: true }
  const options = {regexScripts:[rule], macroState:{userName:'甲'}}
  const messages = [{role:'assistant',turn:3}]
  const first = project(messages, [], options)
  assert.match(first.statusView.content, /甲/)
  first.statusView.content='污染'
  const second = project([{role:'assistant',turn:4}], [], options)
  assert.equal(project.cacheStats().misses, 1)
  assert.equal(project.cacheStats().hits, 1)
  assert.equal(second.statusView.targetTurn, 4)
  assert.doesNotMatch(second.statusView.content, /污染/)
  const origin = project(messages, [projection(2,[{kind:'html',content:second.statusView.content}])], options)
  assert.equal(origin.statusView.sourceTurn, 2)
  options.macroState.userName='乙'
  assert.match(project(messages, [], options).statusView.content, /乙/)
  rule.replaceString='<html><script>changed()</script></html>'
  assert.match(project(messages, [], options).statusView.content, /changed/)
  assert.equal(project.cacheStats().misses, 3)
  rule.disabled=true
  assert.equal(project(messages, [], options).statusView,null)
  const uncached=createPersistentStatusProjector({maxCacheBytes:1})
  rule.disabled=false
  assert.deepEqual(uncached(messages, [], options), project(messages, [], options))
  assert.equal(uncached.cacheStats().entries,0)
})


test('旧数值来源只在原文唯一声明时迁移，未知 HTML 不被误删', () => {
  const rule = { id: 'mvu-status-view', placement: [2], markdownOnly: true, findRegex: '<mvu-status/>', replaceString: '<script>newStatus()</script>' }
  const old = { kind: 'html', content: '<script>oldStatus()</script>', statusRule: 7 }
  const unrelated = { kind: 'html', content: '<script>opening()</script>' }
  const messages = [{ role: 'assistant', turn: 1, text: '开场<mvu-status/>' }]
  const result = projectPersistentStatusView(messages, [projection(1, [old, unrelated])], { regexScripts: [rule] })
  assert.match(result.statusView.content, /newStatus/)
  assert.deepEqual(result.projections[0].parts, [unrelated])
  const ambiguous = projectPersistentStatusView(messages, [projection(1, [old, unrelated])], { regexScripts: [rule, { ...rule, id: 'another', replaceString: '<script>another()</script>' }] })
  assert.equal(ambiguous.statusViews.length, 0)
  assert.deepEqual(ambiguous.projections[0].parts, [old, unrelated])
})


test('带原文捕获替换的面板保留求值结果', () => {
  const rule = { id: 'captured-status', placement: [2], markdownOnly: true, findRegex: '/<mvu-status\\s*\\/>/g', replaceString: '<script>show("$0")</script>' }
  const content = '<script>show("captured")</script>'
  const result = projectPersistentStatusView([{role:'assistant',turn:1}], [projection(1,[{kind:'html',content,statusKey:'id:captured-status'}])], {regexScripts:[rule]})
  assert.equal(result.statusView.content,content)
  assert.deepEqual(result.projections[0].parts,[])
})

test('开场模板缓存先于浏览器回执到达时，原文声明仍保留状态栏', () => {
  const content = '<script>renderStatus()</script>'
  const rule = { id:'opening-panel',enabled:true,placement:[2],markdownOnly:true,findRegex:'/<mvu-status\\s*\\/>/g',replaceString:content }
  const message = {role:'assistant',turn:1,greeting:true,text:'开场正文',sourceText:'开场正文\n<mvu-status/>'}
  const initial = projectPersistentStatusView([message],[projection(1,[{kind:'text',text:'开场正文'},{kind:'html',content}])],{regexScripts:[rule]})
  const synchronized = projectPersistentStatusView([message],[projection(1,[{kind:'text',text:'模板处理后的正文'}])],{regexScripts:[rule]})
  assert.equal(synchronized.statusViews.length,1)
  assert.equal(synchronized.statusView.viewId,initial.statusView.viewId)
  assert.equal(synchronized.statusView.content,content)
  assert.equal(projectPersistentStatusView([{...message,sourceText:'没有入口的独立开局页'}],[],{regexScripts:[rule]}).statusView,null)
})
