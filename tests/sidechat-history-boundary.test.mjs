import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { parse } from 'acorn'

// Exercise the installed package: frozen-lockfile installation applies our patch.
const source = await readFile(new URL('../node_modules/dsh-better-sidebar/lib/index.js', import.meta.url), 'utf8')
const functions = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .filter(node => node.type === 'FunctionDeclaration')
  .map(node => source.slice(node.start, node.end)).filter(text => !text.includes('import.meta'))
const context = vm.createContext({ structuredClone })
vm.runInContext(functions.join('\n'), context)
const message = (seq, text) => ({ seq, type: 'user/message', surfaceOp: 'append', data: { content: [{ type: 'text', text }] } })
const marker = seq => ({ seq, type: 'session/end-seed', data: {} })

for (const live of [true, false]) {
  for (const legacy of [true, false]) {
    test(`sidechat boundary survives parent and child resumes (${live ? 'live' : 'cold'}, ${legacy ? 'legacy' : 'current'})`, async () => {
      const events = [marker(0), message(1, 'parent conversation'),
        { seq: 2, type: 'subagent/descriptor', data: {} }, marker(3),
        message(4, 'child first question'), marker(5), message(6, 'child followup'), marker(7)]
      const metadata = legacy ? { header: { seedLength: 3 }, meta: { seedLength: 3 } } : { inheritedEventCount: 3 }
      const session = { ...metadata, snapshotEvents: () => events }
      const ctx = { get: name => name === 'agents' ? { get: () => live ? { session } : undefined }
        : name === 'sessionPersistence' ? { inspect: async () => ({ ...metadata, events }) } : undefined }
      const history = context.buildSidechatApi(ctx)['sidechat.history']
      const page = await history({ childId: 'child', maxMessages: 50 })
      const markers = Array.from(page.events).filter(row => row.event.type === 'session/end-seed')
      assert.deepEqual(markers.map(row => row.event.seq), [3])
      const visible = Array.from(page.events).filter(row => row.event.seq > markers[0].event.seq && row.event.type === 'user/message')
      assert.deepEqual(visible.map(row => row.event.data.content[0].text), ['child first question', 'child followup'])
      const tail = await history({ childId: 'child', maxMessages: 1 })
      const older = await history({ childId: 'child', beforeSeq: tail.events[0].event.seq, maxMessages: 50 })
      assert.deepEqual(Array.from(older.events).filter(row => row.event.type === 'session/end-seed').map(row => row.event.seq), [3])
    })
  }
}
