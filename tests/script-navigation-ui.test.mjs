import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../tavern-plugin/src/client/script-navigation.js', import.meta.url), 'utf8')

test('browse, paging and explicit idle-only cursor action remain separate', async () => {
  const states = [], refs = [], calls = []
  let cursor = 0, refCursor = 0, effect, busy = false, current = 49, savedSize = 500
  const component = vm.runInNewContext(source + '; ScriptNavigation', { React: {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] },
    useRef(initial) { return refs[refCursor++] ||= { current: initial } }, useEffect(fn) { effect = fn },
    createElement: (type, props, ...children) => ({ type, props, children })
  }, liveTavernView: { invalidate() {} }, rpc: async (method, args) => {
    calls.push([method, args])
    if (method === 'setScriptChunkSize') { savedSize = args.chunkSize; return { chunkSize: savedSize } }
    if (method === 'pointScript') { current = args.position - 1; return { cursor: current, message: '下一轮生效' } }
    const from = Math.max(1, Math.min((args.position || current + 1) - 4, 991))
    return { chunkSize: savedSize, from, to: from + 9, totalChunks: 1000, cursor: current, revision: 1, scriptVersion: 1, cardPath: 'card',
      chunks: Array.from({ length: 10 }, (_, i) => ({ number: from + i, text: '正文' })) }
  } })
  function render() {
    cursor = 0; refCursor = 0
    const nodes = []
    function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; nodes.push(node); node.children?.forEach(visit) }
    visit(component({ sessionId: 's', cursor: current, total: 1000, busy })); return nodes
  }
  const flush = () => new Promise(resolve => setImmediate(resolve))
  render(); const dispose = effect(); await flush()
  assert.equal(render().find(n => n.type === 'input').props.value, '50')
  assert.equal(render().find(n => n.type === 'input').props.placeholder, '剧本块号')
  render().find(n => n.type === 'input').props.onChange({ target: { value: '' } })
  render().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await flush()
  assert.equal(render().find(n => n.type === 'input').props.value, '50')
  assert.equal(calls.at(-1)[1].position, 50)
  assert.equal(render().filter(n => n.type === 'details').length, 10)
  assert.match(JSON.stringify(render().find(n => n.props?.['aria-current'] === 'step')), /第 50 块/)
  render().find(n => n.type === 'input').props.onChange({ target: { value: '500' } })
  render().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await flush()
  assert.equal(calls.filter(c => c[0] === 'pointScript').length, 0)
  assert.match(JSON.stringify(render()), /496–505/)
  assert.equal(render().find(n => n.type === 'input').props.value, '500')
  busy = true
  let button = render().find(n => n.props?.['aria-label'] === '切换游标到第 500 块')
  assert.equal(button.props.disabled, true)
  await button.props.onClick()
  assert.equal(calls.filter(c => c[0] === 'pointScript').length, 0)
  busy = false
  await render().find(n => n.props?.['aria-label'] === '切换游标到第 500 块').props.onClick()
  assert.equal(calls.filter(c => c[0] === 'pointScript').length, 1)
  assert.equal(current, 499)
  assert.match(JSON.stringify(render()), /游标已设为第 500 块/)
  assert.match(JSON.stringify(render().find(n => n.props?.['aria-current'] === 'step')), /✓ 当前游标/)
  effect(); await flush()
  assert.match(JSON.stringify(render()), /游标已设为第 500 块/)
  assert.match(JSON.stringify(render()), /当前游标：第 500 块/)
  await render().find(n => n.children?.includes('剧本块 →')).props.onClick()
  assert.match(JSON.stringify(render()), /506–515/)
  const sizeInput = () => render().find(n => n.props?.['aria-label'] === '每轮推进字数')
  const sizeForm = () => render().filter(n => n.type === 'form')[1]
  assert.equal(sizeInput().props.value, '500')
  sizeInput().props.onChange({ target: { value: '1000' } })
  busy = true
  assert.equal(sizeInput().props.disabled, true)
  await sizeForm().props.onSubmit({ preventDefault() {} })
  assert.equal(savedSize, 500)
  busy = false
  await sizeForm().props.onSubmit({ preventDefault() {} })
  assert.equal(savedSize, 1000)
  assert.equal(sizeInput().props.value, '1000')
  assert.match(JSON.stringify(render()), /原文阅读位置保持不变/)
  sizeInput().props.onChange({ target: { value: '1.5' } })
  await sizeForm().props.onSubmit({ preventDefault() {} })
  assert.equal(savedSize, 1000)
  assert.match(JSON.stringify(render()), /100–10000 的整数/)
  dispose()
})
