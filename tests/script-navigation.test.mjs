import test from 'node:test'
import assert from 'node:assert/strict'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createScriptNavigation } from '../tavern-plugin/lib/domain/script-navigation.js'

function fixture() {
  const scripts = createScriptContinuity()
  const script = { title: '长剧本', importedAt: 1, chunks: Array.from({ length: 1000 }, (_, order) => ({ id: 'c' + order, order, text: '正文' + order })) }
  let chat = { id: 'chat', mode: 'script', cardPath: 'card', _storageRevision: 1, scriptState: scripts.start(script, 49), messages: ['保留正文'], variables: { hp: 2 }, candidates: { choices: ['保留候选'] } }
  let busy = false, beforeUpdate = () => {}
  const service = createScriptNavigation({ scripts, readScript: async () => script,
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { beforeUpdate(); const draft = fn(structuredClone(chat)); draft._storageRevision++; chat = draft; return structuredClone(chat) } },
    isBusy: () => busy, exclusive: async (_id, work) => work() })
  return { scripts, script, service, get chat() { return chat }, set busy(v) { busy = v }, set beforeUpdate(fn) { beforeUpdate = fn } }
}
test('10-block windows center on cursor or requested block without changing progress', async () => {
  const h = fixture()
  for (const [position, from, to] of [[undefined,46,55],[5,1,10],[1,1,10],[998,991,1000]]) {
    const page = await h.service.browse('session', position)
    assert.equal(page.from, from); assert.equal(page.to, to); assert.equal(page.chunks.length, 10)
  }
  assert.equal(h.chat.scriptState.cursor, 49)
  await assert.rejects(h.service.browse('session', 1001), /有效/)
  await assert.rejects(h.service.browse('session', 1.2), /有效/)
})
test('manual cursor can move backward; next preparation uses it while history and Agent restrictions remain', async () => {
  const h = fixture(), before = structuredClone(h.chat)
  await h.service.point('session', { ...await h.service.browse('session'), position: 5 })
  assert.equal(h.chat.scriptState.cursor, 4)
  for (const field of ['messages', 'variables', 'candidates']) assert.deepEqual(h.chat[field], before[field])
  const prepared = h.scripts.transition({ script: h.script, state: h.chat.scriptState, event: { kind: 'prepare', userText: '继续', nativeTurn: 1 } })
  assert.equal(prepared.reference.chunkId, 'c4')
  const backward = h.scripts.transition({ script: h.script, state: h.chat.scriptState, event: { kind: 'focus', cursor: 2 } })
  assert.equal(backward.state.cursor, 4)
})
test('save rechecks busy and revision inside atomic mutation; stale pages cannot overwrite newer state', async () => {
  const h = fixture(), page = await h.service.browse('session')
  h.beforeUpdate = () => { h.busy = true }
  await assert.rejects(h.service.point('session', { ...page, position: 3 }), /等待/)
  h.beforeUpdate = () => {}; h.busy = false
  await h.service.point('session', { ...page, position: 3 })
  await assert.rejects(h.service.point('session', { ...page, position: 2 }), /已变化/)
  assert.equal(h.chat.scriptState.cursor, 2)
})
test('prepared turn, changed script and invalid positions reject without editing stored state', async () => {
  const h = fixture(), page = await h.service.browse('session')
  for (const position of [0, 1001, 1.5, '2']) await assert.rejects(h.service.point('session', { ...page, position }), /有效/)
  h.script.chunks[0].text = '替换内容，但导入时间未改变'
  await assert.rejects(h.service.point('session', { ...page, position: 2 }), /剧本已更新/)
  h.script.chunks[0].text = '正文0'
  h.script.importedAt = 2
  await assert.rejects(h.service.point('session', { ...page, position: 2 }), /剧本已更新/)
  h.script.importedAt = 1
  h.chat.scriptState.prepared = { nativeTurn: 1 }
  await assert.rejects(h.service.point('session', { ...page, position: 2 }), /等待/)
  assert.equal(h.chat.scriptState.cursor, 49)
})
test('empty and short scripts have bounded windows; a finished script can be manually resumed', () => {
  const h = fixture()
  h.script.chunks = h.script.chunks.slice(0, 3)
  const ended = h.scripts.transition({ script: h.script, state: h.scripts.start(h.script), event: { kind: 'end' } }).state
  assert.equal(h.scripts.inspect({ script: h.script, state: ended, request: { kind: 'browse' } }).chunks.length, 3)
  assert.equal(h.scripts.transition({ script: h.script, state: ended, event: { kind: 'manual-focus', cursor: 1 } }).state.cursor, 0)
  h.script.chunks = []
  const page = h.scripts.inspect({ script: h.script, request: { kind: 'browse' } })
  assert.deepEqual([page.from, page.to, page.chunks.length], [0,0,0])
})

test('chunk budget uses the same exclusive, stale-page and busy guards as cursor changes', async () => {
  const h = fixture(), page = await h.service.browse('session'), before = structuredClone(h.chat)
  h.busy = true
  await assert.rejects(h.service.setChunkSize('session', { ...page, chunkSize: 1000 }), /等待/)
  h.busy = false
  await assert.rejects(h.service.setChunkSize('session', { ...page, chunkSize: 10001 }), /整数/)
  await h.service.setChunkSize('session', { ...page, chunkSize: 1000 })
  assert.equal(h.chat.scriptState.chunkSize, 1000)
  assert.equal(h.chat.scriptState.sourceOffset, before.scriptState.sourceOffset)
  for (const field of ['messages', 'variables', 'candidates']) assert.deepEqual(h.chat[field], before[field])
  assert.equal((await h.service.browse('session')).chunkSize, 1000)
  await assert.rejects(h.service.setChunkSize('session', { ...page, chunkSize: 300 }), /已变化/)
})
