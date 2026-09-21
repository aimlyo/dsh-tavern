import test from 'node:test'
import assert from 'node:assert/strict'
import { scriptChunkLayout, splitNovelText } from '../tavern-plugin/lib/domain/script-chunks.js'
import { scriptForState } from '../tavern-plugin/lib/domain/script-layout.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'

const scripts = createScriptContinuity()
const source = Array.from({ length: 100 }, (_, i) => `第${i}段：${'汉'.repeat(97)}。\n`).join('').trim()
const script = { title: '原文定位', ...scriptChunkLayout(source) }
const change = (state, event) => scripts.transition({ script, state, event })

test('changing size rechunks the entire source and preserves the exact unread position across reloads', () => {
  let state = scripts.start(script, 3)
  const offset = state.sourceOffset
  for (const chunkSize of [1000, 100, 10000, 500, 750]) {
    state = JSON.parse(JSON.stringify(change(state, { kind: 'set-chunk-size', chunkSize }).state))
    const layout = scriptForState(script, state)
    assert.deepEqual(layout.chunks, splitNovelText(source, chunkSize))
    assert.equal(state.sourceOffset, offset)
    const choice = scripts.inspect({ script, state, request: { kind: 'choice' } })
    const prepared = change(state, { kind: 'prepare', userText: '继续', nativeTurn: 1 })
    assert.equal(prepared.reference.text, choice.chunks[0].text)
    assert.equal(prepared.reference.text, source.slice(offset, prepared.reference.sourceOffsetAfter))
    assert.equal(choice.sourceOffset, offset)
  }
})

test('successive turns with repeated size changes cover the original text exactly once', () => {
  let state = scripts.start(script), read = '', turn = 0
  while (state.sourceOffset < source.length) {
    state = change(state, { kind: 'set-chunk-size', chunkSize: [1000, 300, 700][turn % 3] }).state
    const prepared = change(state, { kind: 'prepare', userText: '继续', nativeTurn: ++turn })
    assert.ok(prepared.reference.text.length > 0)
    read += prepared.reference.text
    state = change(prepared.state, { kind: 'commit', userText: '继续', nativeTurn: turn }).state
    assert.equal(state.sourceOffset, read.length)
  }
  assert.equal(read, source)
  state = change(state, { kind: 'set-chunk-size', chunkSize: 10000 }).state
  assert.equal(change(state, { kind: 'prepare', userText: '结束', nativeTurn: ++turn }).reference.ended, true)
})

test('rollback and regeneration restore exact partial-block position and the saved budget', () => {
  let state = change(scripts.start(script, 3), { kind: 'set-chunk-size', chunkSize: 1000 }).state
  const prepared = change(state, { kind: 'prepare', userText: '继续', nativeTurn: 1 })
  assert.throws(() => change(prepared.state, { kind: 'set-chunk-size', chunkSize: 600 }), /等待/)
  const committed = change(prepared.state, { kind: 'commit', userText: '继续', nativeTurn: 1 })
  state = change(committed.state, { kind: 'set-chunk-size', chunkSize: 300 }).state
  for (const restoration of [{ revision: committed.revision }, { reference: committed.reference }]) {
    const restored = change(state, { kind: 'restore', ...restoration }).state
    assert.equal(restored.sourceOffset, prepared.reference.sourceOffsetBefore)
    if (restoration.revision) {
      assert.equal(restored.chunkSize, 1000)
      assert.equal(change(restored, { kind: 'prepare', userText: '继续', nativeTurn: 1 }).reference.text, prepared.reference.text)
    }
  }
})

test('legacy cursor is converted before resizing; focus and validation preserve canonical progress', () => {
  const old = { ...scripts.start(script, 4) }
  delete old.sourceOffset
  let state = change(old, { kind: 'set-chunk-size', chunkSize: 1000 }).state
  assert.equal(state.sourceOffset, script.chunks.slice(0, 4).map(c => c.text).join('').length)
  assert.equal(change(state, { kind: 'focus', cursor: state.cursor + 1 }).state.sourceOffset, state.sourceOffset)
  state = change(state, { kind: 'manual-focus', cursor: 2 }).state
  assert.equal(state.sourceOffset, scriptForState(script, state).chunks[0].text.length)
  for (const chunkSize of [0, 99, 10001, 500.5, '500', NaN]) assert.throws(() => change(state, { kind: 'set-chunk-size', chunkSize }), /整数/)
})


test('old reference-only rollback uses its original layout even after changing the budget', () => {
  const oldReference = { chunkId: script.chunks[3].id, cursorBefore: 3, chunkingVersion: script.chunkingVersion }
  const resized = change(scripts.start(script, 5), { kind: 'set-chunk-size', chunkSize: 1000 }).state
  const restored = change(resized, { kind: 'restore', reference: oldReference }).state
  assert.equal(restored.sourceOffset, script.chunks.slice(0, 3).map(c => c.text).join('').length)
})
