import assert from 'node:assert/strict'
import test from 'node:test'

import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { renderTavernMacros } from '../tavern-plugin/lib/domain/tavern-macro-engine.js'
import { projectReplyPresentation } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { createForegroundFrameBuilder, foregroundFrameText } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { createForegroundFrameSessionAdapter } from '../tavern-plugin/lib/domain/foreground-frame-session-adapter.js'

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function script() {
  return {
    title: '银铃', importedAt: 1,
    chunks: [
      { id: 'chunk-1', order: 0, text: '两人在雨夜抵达旅店。' },
      { id: 'chunk-2', order: 1, text: '钟楼传来第三声铃响。' }
    ]
  }
}

function harness(mode, options = {}) {
  const cards = createCardPreparation({ id: () => 'card-1', now: () => 1000 })
  const scripts = createScriptContinuity()
  let cardWorkspace = cards.create({ kind: 'import', payload: options.cardData || { name: '阿芙拉', description: '旧描述' } })
  let card = cards.project(cardWorkspace)
  let chat = {
    id: 'chat-1', cardPath: options.draft ? '' : 'cards/阿芙拉.json', cardName: options.draft ? '卡片工作台' : card.name, mode,
    messages: [], posture: '站在窗边', guides: [], nativeCommits: {},
    ledger: options.ledger || null,
    preparedWorldBookContext: options.preparedWorldBookContext || '',
    webSearchEnabled: options.webSearchEnabled === true,
    runtimePresetSnapshot: clone(options.runtimePresetSnapshot || null),
    macroState: { userName: 'User', local: {}, global: {} },
    scriptState: mode === 'script' ? scripts.start(script(), 0) : null,
    workspace: mode === 'card' ? { mountedResources: [], sourceIds: options.draft ? ['src-1'] : [], draft: { name: '' }, player: '', cursor: 0, prepared: null } : null,
    _storageRevision: 1
  }
  const history = new Map([[1, clone(chat)]])
  const settlements = []
  const createdCards = []
  const plannerCalls = []
  const timeline = createStoryTimeline({ id: (prefix) => prefix + '-' + Math.random().toString(36).slice(2), now: () => 2000 })
  const store = {
    async chatForSession() { return clone(chat) },
    async readCard() { if (options.brokenCard) throw new SyntaxError('invalid JSON'); return options.draft && !chat.cardPath ? undefined : clone(card) },
    async readCardExtensions() { return clone(options.extensions || { regexScripts: [] }) },
    async readScript() { return mode === 'script' || (mode === 'card' && !options.draft) ? clone(script()) : undefined },
    async readBoundWorldBook() { return clone(options.boundWorldBook || null) },
    async writeChat(value, metadata) {
      const revision = Math.max(0, Number(chat._storageRevision) || 0) + 1
      let next = clone(value)
      if (metadata && metadata.source === 'foreground.commit' && options.autoSettle !== false) {
        const settlement = timeline.apply({ chat: next, intent: { kind: 'agent.begin', role: 'settlement' } })
        next = timeline.complete({
          chat: settlement.chat,
          operationId: settlement.value.operationId,
          basedOn: settlement.value.basedOn,
          outcome: { status: 'success' }
        }).chat
      }
      chat = next
      chat._storageRevision = revision
      value._storageRevision = revision
      history.set(revision, clone(chat))
    },
    async updateChat(_id, mutation, metadata) {
      const next = await mutation(clone(chat))
      if (next !== undefined) await store.writeChat(next, metadata)
      return clone(chat)
    },
    async updateCard(_cardId, fields, revision, rawOperations) {
      const change = cards.update({ kind: 'card', card: cardWorkspace, patch: fields, revision, rawOperations })
      cardWorkspace = clone(change.card)
      card = clone(change.view)
      return { ...clone(change), card: clone(card) }
    },
    async createCard(_chat, state) {
      cardWorkspace = cards.create({ kind: 'draft', draft: state.draft, player: state.player, sourcePaths: state.sourceIds || state.sourcePaths || [] })
      card = cards.project(cardWorkspace)
      const path = 'cards/' + card.name + '.json'
      card.path = path
      createdCards.push({ path, card: clone(card) })
      return { path, card: clone(card) }
    }
  }
  const orchestrator = createTurnOrchestrator({
    store,
    planner: {
      async plan(input) {
        plannerCalls.push(clone(input))
        if (options.planner) return options.planner.plan(input)
        return {
          text: 'context:' + input.purpose,
          sections: input.purpose === 'body' && Array.isArray(options.plannerSections) ? clone(options.plannerSections) : undefined
        }
      }
    },
    worldBookRecall: options.worldBookRecall,
    captureSceneWorldbook: options.captureSceneWorldbook,
    scripts,
    timeline,
    frameBuilder: createForegroundFrameBuilder(),
    cards,
    workspace: {
      async prepare(value, turn) {
        value.workspace.prepared = { nativeTurn: turn, cursorBefore: value.workspace.cursor, total: 1, window: [{ title: '素材', text: '拔剑。' }] }
        return value.workspace.prepared
      },
      commit(value, turn) {
        if (value.workspace.prepared && value.workspace.prepared.nativeTurn === turn) {
          value.workspace.cursor = 1
          value.workspace.prepared = null
        }
      }
    },
    queueSettlement: (chatId) => settlements.push(chatId),
    renderMacros: options.macros === true ? function (text, value) {
      const result = renderTavernMacros(text, {
        charName: value.cardName,
        userName: value.macroState.userName,
        localVariables: value.macroState.local,
        globalVariables: value.macroState.global
      })
      value.macroState.local = result.localVariables
      value.macroState.global = result.globalVariables
      return result.text
    } : undefined,
    resolvePresetRegexScripts: options.resolvePresetRegexScripts,
    projectUserTemplate: options.projectUserTemplate,
    projectReply: projectReplyPresentation,
    projectWorldBookTemplates: options.projectWorldBookTemplates,
    projectForegroundWorldbook: options.projectForegroundWorldbook,
    recordWorldbookRecall: options.recordWorldbookRecall,
    projectScriptPromptWorldbook: options.projectScriptPromptWorldbook,
    shellToolName: options.shellToolName,
    now: () => 2000
  })
  return {
    orchestrator,
    chat: () => clone(chat),
    card: () => clone(card),
    cardWorkspace: () => clone(cardWorkspace),
    plannerCalls,
    settlements,
    createdCards,
    timeline,
    rollback(value = chat) {
      const target = timeline.rollbackTarget({ chat: value })
      const beforeChat = target === null ? undefined : history.get(target.beforeRevision)
      const result = timeline.apply({ chat: clone(value), intent: { kind: 'turn.rollback', beforeChat: clone(beforeChat) } })
      result.chat._storageRevision = Math.max(0, Number(value._storageRevision) || 0) + 1
      return result
    },
    replaceChat(next) { chat = clone(next) }
  }
}

test('生图世界书版本冻结在生成前，不进入正文 Frame 文本，提交时不借用后来版本', async () => {
  for (const compatibility of [false, true]) {
    let calls = 0, current = { version: 1, digest: 'a'.repeat(64) }
    const run = harness('story', { captureSceneWorldbook: async () => { calls++; return clone(current) } })
    const input = { sessionId: 'session-1', turn: 1, userText: '看一眼林岚。' }
    const first = compatibility ? await run.orchestrator.beginCompatibility(input) : await run.orchestrator.prepare(input)
    if (!compatibility) assert.doesNotMatch(foregroundFrameText(first.frame), /aaaaa|sceneWorldbook/)
    current = { version: 1, digest: 'b'.repeat(64) }
    if (compatibility) await run.orchestrator.beginCompatibility(input)
    else await run.orchestrator.prepare(input)
    assert.equal(calls, 1)
    await run.orchestrator.finalize({ ...input, assistantText: '林岚站在车站。' })
    const message = run.chat().messages.at(-1)
    assert.equal(message.sceneWorldbook.digest, 'a'.repeat(64))
    assert.equal(message.sceneWorldbook.bodyDigests.length, 1)
    const next = { ...input, turn: 2, userText: '继续' }
    if (compatibility) await run.orchestrator.beginCompatibility(next)
    else await run.orchestrator.prepare(next)
    await run.orchestrator.finalize({ ...next, assistantText: '第二轮的正文。' })
    assert.equal(run.chat().messages.at(-1).sceneWorldbook.digest, 'b'.repeat(64))
    assert.equal(run.chat().messages.find(item => item.role === 'assistant').sceneWorldbook.digest, 'a'.repeat(64))
    assert.equal(run.rollback().chat.messages.at(-1).sceneWorldbook.digest, 'a'.repeat(64))
  }
})

test('连续正文回合的实际 Frame 消息不重复基本信息和常驻世界书', async () => {
  const planner = createContextPlanner({ prompt: () => '正文写作规则' })
  const cardData = { name: '阿芙拉', description: '固定描述', personality: '固定性格', scenario: '固定场景', mes_example: '固定示例', system_prompt: '逐轮系统指令', post_history_instructions: '逐轮历史后指令' }
  for (const mode of ['story', 'script']) {
    const run = harness(mode, { planner, cardData, preparedWorldBookContext: '本轮动态世界书' })
    const prefix = await planner.plan({ purpose: 'play-card-snapshot', card: run.card(), chat: run.chat(), worldBookContext: '固定世界设定', worldBookLabel: '常驻世界书' })
    const adapter = createForegroundFrameSessionAdapter()
    let messages = []
    for (const turn of [2, 3]) {
      const input = { sessionId: 'session-1', turn, userText: '继续' }
      const prepared = await run.orchestrator.prepare(input)
      const text = foregroundFrameText(prepared.frame)
      assert.equal(prepared.frame.context.cardContext, '')
      assert.match(text, /逐轮系统指令/)
      assert.match(text, /逐轮历史后指令/)
      assert.match(text, /本轮动态世界书/)
      messages = adapter.append({ messages, frame: prepared.frame, step: 1 }).messages
      await run.orchestrator.finalize({ ...input, assistantText: '雨水敲着窗。' })
    }
    const historyText = messages.map(message => message.content[0].text).join('\n')
    const requestText = prefix.text + '\n' + historyText
    for (const fixed of ['固定描述', '固定性格', '固定场景', '固定示例', '固定世界设定']) {
      assert.equal(requestText.split(fixed).length - 1, 1)
      assert.ok(!historyText.includes(fixed))
    }
    assert.equal(historyText.split('逐轮系统指令').length - 1, 2)
    assert.equal(historyText.split('逐轮历史后指令').length - 1, 2)
  }
})

test('原生正文 Frame 合并关键词世界书与每轮模板投影，不携带 EJS 源码', async function () {
  const planner = createContextPlanner({ prompt: () => '正文写作规则' })
  const run = harness('story', {
    planner,
    preparedWorldBookContext: '关键词命中的钟楼规则。',
    projectWorldBookTemplates: async function ({ chat, card, turn }) {
      assert.equal(card.name, '阿芙拉')
      assert.equal(chat.id, 'chat-1')
      assert.equal(turn, 2)
      return { context: '当前阶段解析出的觉醒规则。', refs: ['entry:9'], diagnostics: [] }
    }
  })

  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '继续' })

  assert.equal(prepared.frame.context.activeWorldbook, '【本轮世界书上下文】\n关键词命中的钟楼规则。\n\n当前阶段解析出的觉醒规则。')
  assert.doesNotMatch(foregroundFrameText(prepared.frame), /<%|getwi|@@preprocessing/)
  assert.deepEqual(prepared.frame.source.worldBook.templateRefs, ['entry:9'])
})

test('游玩回合由生命周期自动准备与提交，不再要求模型回传正文', async () => {
  const run = harness('story')
  assert.equal(await run.orchestrator.modeFor('session-1'), 'story')
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推开窗' })
  assert.equal(Object.hasOwn(prepared, 'text'), false)
  assert.equal(prepared.frame.kind, 'foreground')
  assert.equal(prepared.frame.userInput.projectedText, '推开窗')
  assert.equal(prepared.frame.basedOnRevision, 0)
  assert.equal(prepared.frame.source.card.name, '阿芙拉')

  const saved = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, userText: '推开窗', assistantText: '雨水扑进房间。' })
  assert.equal(saved.saved, true)
  assert.deepEqual(run.chat().messages.map((message) => [message.role, message.text]), [
    ['user', '推开窗'],
    ['assistant', '雨水扑进房间。']
  ])
  assert.deepEqual(run.settlements, [], '正文 turn/end 发出前不得启动后台结算')

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, userText: '推开窗', assistantText: '重复文本' })
  assert.equal(run.chat().messages.length, 2)
  assert.deepEqual(run.settlements, [])
})

test('后台结算失败不阻止下一轮正文，下一轮建立独立 checkpoint', async () => {
  const run = harness('story', { autoSettle: false })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推开窗' })
  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, userText: '推开窗', assistantText: '雨水扑进房间。' })
  let chat = run.chat()
  const settlement = run.timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'settlement' } })
  chat = run.timeline.complete({
    chat: settlement.chat,
    operationId: settlement.value.operationId,
    basedOn: settlement.value.basedOn,
    outcome: { status: 'failed' }
  }).chat
  chat.settleStatus = 'failed'
  chat.settleError = '未调用 posture_submit'
  run.replaceChat(chat)

  await assert.doesNotReject(run.orchestrator.prepare({ sessionId: 'session-1', turn: 3, userText: '继续' }))
  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 3, userText: '继续', assistantText: '她走进雨里。' })

  const current = run.chat()
  assert.equal(current.messages.at(-1).text, '她走进雨里。')
  assert.equal(current.settleStatus, 'pending')
  assert.equal(current.settleError, null)
  assert.equal(run.timeline.inspect({ chat: current }).checkpointCount, 2)
})

test('同一正文 operation 重试复用 ForegroundFrame id', async () => {
  const run = harness('story')
  const first = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推开窗' })
  const plannerCalls = run.plannerCalls.length
  const retried = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推开窗' })

  assert.equal(retried.frame.frameId, first.frame.frameId)
  assert.equal(retried.frame.operationId, first.frame.operationId)
  assert.equal(retried.frame.basedOnRevision, first.frame.basedOnRevision)
  assert.equal(run.plannerCalls.length, plannerCalls, '重试不得重新执行资源规划')
})

test('正文 Planner section 按语义翻译到 ForegroundFrame 槽位', async () => {
  const run = harness('story', {
    plannerSections: [
      { kind: 'base', required: true, text: '正文规则' },
      { kind: 'world-book', text: '午夜钟楼' },
      { kind: 'posture', text: '站在窗边' },
      { kind: 'guide', text: '多写动作' },
      { kind: 'card', text: '人物设定' },
      { kind: 'script', text: '剧本片段' }
    ]
  })
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '继续' })

  assert.match(prepared.frame.context.writingRules, /^正文规则/)
  assert.doesNotMatch(prepared.frame.context.writingRules, /request_character_design/)
  assert.equal(prepared.frame.context.activeWorldbook, '午夜钟楼')
  assert.equal(prepared.frame.context.currentStateProjection, '站在窗边')
  assert.equal(prepared.frame.context.guide, '多写动作')
  assert.equal(prepared.frame.context.cardContext, '人物设定')
  assert.equal(prepared.frame.context.scriptReference, '剧本片段')
})

test('同一 DSH rpcId 即使被重放到新回合也不会再次推进酒馆状态', async () => {
  const run = harness('story')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, requestId: 'rpc-1', userText: '推开窗' })
  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, requestId: 'rpc-1', userText: '推开窗', assistantText: '雨水扑进房间。' })

  const duplicate = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 3, requestId: 'rpc-1', userText: '推开窗' })

  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.committedTurn, 2)
  assert.equal(run.chat().messages.length, 2)
  assert.equal(Object.values(run.timeline.inspect({ chat: run.chat() }).operations).some(function (item) {
    return Number(item.turn) === 3
  }), false)
})

test('无正文失败会保留诊断，下一次正式重试开始时自动清除', async () => {
  const run = harness('story')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, requestId: 'rpc-empty', userText: '继续' })
  await run.orchestrator.recordFailure({
    sessionId: 'session-1', turn: 2, requestId: 'rpc-empty',
    code: 'reasoning-only', message: '模型本轮只返回了思考过程，没有返回正文；请重新生成本轮正文。'
  })
  await run.orchestrator.discard({ sessionId: 'session-1', turn: 2 })

  assert.deepEqual(run.chat().foregroundError, {
    turn: 2,
    requestId: 'rpc-empty',
    code: 'reasoning-only',
    message: '模型本轮只返回了思考过程，没有返回正文；请重新生成本轮正文。',
    at: 2000
  })

  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 3, requestId: 'rpc-retry', userText: '继续' })
  assert.equal(run.chat().foregroundError, null)
})

test('正文准备只读取本地已保存的下一轮世界书上下文，不再触发匹配', async () => {
  let recallCalls = 0
  const run = harness('story', {
    preparedWorldBookContext: '钟楼只有午夜会响。',
    worldBookRecall: {
      async recall() { recallCalls++; throw new Error('正文准备不得调用世界书召回') }
    }
  })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推开窗' })

  assert.equal(run.plannerCalls.at(-1).worldBookContext, '钟楼只有午夜会响。')
  assert.equal(recallCalls, 0)
})

test('没有世界书关键词结果时正文直接使用空上下文', async () => {
  const run = harness('story', {
    worldBookRecall: { async recall() { throw new Error('世界书暂时不可用') } }
  })
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '继续' })

  assert.equal(prepared.frame.contributions[0].text, 'context:body')
  assert.equal(run.plannerCalls.at(-1).worldBookContext, '')
  assert.equal(run.chat().worldBookError, undefined)
})

test('游玩正文不再拆走 HTML，三层回复随剧情消息一起保存', async () => {
  const run = harness('story')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推开窗' })
  await run.orchestrator.finalize({
    sessionId: 'session-1', turn: 2, userText: '推开窗',
    assistantText: '雨水扑进房间。\n\n<details><summary>状态</summary></details>'
  })

  const message = run.chat().messages.at(-1)
  assert.equal(message.text, '雨水扑进房间。\n\n<details><summary>状态</summary></details>')
  assert.equal(message.sourceText, message.text)
  assert.equal(message.displayText, message.text)
  assert.equal(message.displayMode, 'html')
  assert.equal(message.projectionVersion, 2)
  assert.equal(run.chat().presentation, undefined)

  const rolled = run.rollback()
  assert.equal(rolled.chat.presentation, null)
})

test('人物卡展示正则只改变 displayText，Session 与原始消息保持完整', async () => {
  const run = harness('story', {
    extensions: {
      regexScripts: [{
        id: 'status', name: '状态面板', findRegex: '\\[状态\\]([\\s\\S]*)', replaceString: '<aside>$1</aside>',
        placement: [2], enabled: true, markdownOnly: true, promptOnly: false, runOnEdit: true
      }]
    }
  })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '查看状态' })
  const saved = await run.orchestrator.finalize({
    sessionId: 'session-1', turn: 2, userText: '查看状态', assistantText: '她继续向前走。\n\n[状态]体力 100'
  })

  assert.equal(saved.reply.sessionText, '她继续向前走。\n\n[状态]体力 100')
  assert.equal(saved.reply.displayText, '她继续向前走。\n\n<aside>体力 100</aside>')
  assert.equal(run.chat().messages.at(-1).text, '她继续向前走。\n\n[状态]体力 100')
  assert.equal(run.chat().messages.at(-1).sourceText, '她继续向前走。\n\n[状态]体力 100')
  assert.equal(run.chat().messages.at(-1).displayText, '她继续向前走。\n\n<aside>体力 100</aside>')
  assert.equal(run.chat().messages.at(-1).turn, 2)
  assert.equal(run.chat().presentation, undefined)
})

test('人物卡 promptOnly 正则写入 Session，但展示投影仍保留原始状态块', async () => {
  const run = harness('story', {
    extensions: {
      regexScripts: [{
        id: 'draft', name: '移除草稿', findRegex: '/<draft_notes>[\\s\\S]*?<\\/draft_notes>\\s*/', replaceString: '',
        placement: [2], enabled: true, markdownOnly: false, promptOnly: true, runOnEdit: false
      }]
    }
  })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '继续' })
  const saved = await run.orchestrator.finalize({
    sessionId: 'session-1', turn: 2, userText: '继续',
    assistantText: '<draft_notes>内部推演</draft_notes>\n正文。'
  })

  assert.equal(saved.reply.sourceText, '<draft_notes>内部推演</draft_notes>\n正文。')
  assert.equal(saved.reply.sessionText, '正文。')
  assert.equal(saved.reply.displayText, '<draft_notes>内部推演</draft_notes>\n正文。')
  assert.equal(run.chat().messages.at(-1).text, '正文。')
  assert.equal(run.chat().messages.at(-1).displayText, '<draft_notes>内部推演</draft_notes>\n正文。')
})

test('旧对话的后续回复继续使用创建时固化的预设正则', async () => {
  const run = harness('story', {
    runtimePresetSnapshot: {
      text: '固定提示词',
      regexScripts: [{
        id: 'old-status', name: '旧快照正则', findRegex: '<old>([\\s\\S]*?)<\\/old>', replaceString: '<aside>$1</aside>',
        placement: [2], enabled: true, markdownOnly: true, promptOnly: false, runOnEdit: false
      }]
    },
    resolvePresetRegexScripts: async function (chat) { return chat.runtimePresetSnapshot.regexScripts }
  })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '查看状态' })
  const saved = await run.orchestrator.finalize({
    sessionId: 'session-1', turn: 2, userText: '查看状态', assistantText: '她继续向前走。\n\n<old>体力 80</old>'
  })

  assert.equal(saved.reply.sessionText, '她继续向前走。\n\n<old>体力 80</old>')
  assert.equal(saved.reply.displayText, '她继续向前走。\n\n<aside>体力 80</aside>')
  assert.equal(run.chat().presentation, undefined)
})

test('普通游玩的预设中段作为写作规则进入 ForegroundFrame', async () => {
  const run = harness('story', {
    runtimePresetSnapshot: {
      presetPath: 'presets/叙事.json',
      digest: 'preset-digest',
      middle: {
        entries: [{ id: 'middle-1', role: 'system', content: '保持第三人称限知视角。' }]
      }
    }
  })

  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '继续' })

  assert.match(prepared.frame.context.writingRules, /保持第三人称限知视角。/)
  const presetContribution = prepared.frame.contributions.find(function (item) { return item.source.stage === 'runtime-preset' })
  assert.equal(presetContribution.text, '保持第三人称限知视角。')
  assert.equal(presetContribution.source.phase, 'middle')
  assert.equal(prepared.frame.source.preset.digest, 'preset-digest')
})

test('预设中段渲染后进入真实 Frame，并保留存档中的原始宏', async () => {
  const raw = {
    front: { entries: [{ role: 'system', content: '{{setvar::style::温和}}' }] },
    middle: { entries: [{ role: 'system', content: '采用{{getvar::style}}笔调。' }] }
  }
  const run = harness('story', { runtimePresetSnapshot: structuredClone(raw) })
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '继续' })
  assert.match(prepared.frame.context.writingRules, /采用温和笔调。/)
  assert.deepEqual(run.chat().runtimePresetSnapshot, raw)
})

test('游玩回复先执行人物卡宏，再分别保存原文、Session 和展示投影', async () => {
  const run = harness('story', { macros: true })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '查看状态' })
  const saved = await run.orchestrator.finalize({
    sessionId: 'session-1', turn: 2, userText: '查看状态',
    assistantText: '她抬起头。\n\n<style>.status{color:red}</style><div class="status">阶段 {{incvar::stage}}</div>'
  })

  const message = run.chat().messages.at(-1)
  assert.equal(message.sourceText, '她抬起头。\n\n<style>.status{color:red}</style><div class="status">阶段 {{incvar::stage}}</div>')
  assert.equal(message.projectionText, '她抬起头。\n\n<style>.status{color:red}</style><div class="status">阶段 1</div>')
  assert.equal(message.text, message.projectionText)
  assert.equal(message.displayText, message.projectionText)
  assert.equal(message.displayMode, 'html')
  assert.equal(run.chat().presentation, undefined)
  assert.deepEqual(run.chat().macroState.local, { stage: 1 })
  assert.equal(saved.reply.sessionText, message.projectionText)
})

test('官方 MVU owner 的前台只提交正文和待结算快照，不再执行变量协议', async function () {
  const run = harness('story', {
    extensions: {
      regexScripts: [{
        id: 'status', name: '状态栏', findRegex: '<StatusPlaceHolderImpl/>', replaceString: '<aside>官方状态栏</aside>',
        placement: [2], enabled: true, markdownOnly: true, promptOnly: false, runOnEdit: false
      }]
    }
  })
  const initial = run.chat()
  initial.mvu = { enabled: true, owner: 'official', runtime: 'magvarupdate' }
  initial.messages.push({
    role: 'assistant', text: '开场', swipeId: 0, swipes: ['开场'],
    variables: [{ initialized_lorebooks: {}, stat_data: { 体力: 10 }, schema: { extensible: false, properties: {}, type: 'object' } }]
  })
  run.replaceChat(initial)

  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '继续' })
  const saved = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, userText: '继续', assistantText: '正文\n_.add("体力", -1);' })

  const assistant = run.chat().messages.at(-1)
  assert.equal(assistant.variables[0].stat_data.体力, 10)
  assert.equal(assistant.mvu.pending, true)
  assert.equal(assistant.mvu.receipt, undefined)
  assert.match(prepared.frame.context.writingRules, /后台 Agent 独立结算/)
  assert.doesNotMatch(assistant.displayText, /<aside>官方状态栏<\/aside>/)
  assert.doesNotMatch(saved.reply.sessionText, /<aside>/)
})

test('真实玩家回合缺少 prepare 时仍报 operation 错误', async () => {
  const run = harness('story')

  await assert.rejects(
    run.orchestrator.finalize({ sessionId: 'session-1', turn: 1, userText: '向前走', assistantText: '正文' }),
    /找不到本轮正文 operation/
  )
})

test('玩家输入中的酒馆变量宏在正文回合准备时执行并持久化', async () => {
  const run = harness('story', { macros: true })
  const first = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '{{incvar::stage}}继续前进' })
  const retried = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '{{incvar::stage}}继续前进' })

  assert.equal(first.userText, '1继续前进')
  assert.equal(retried.userText, '1继续前进')
  assert.deepEqual(run.chat().macroState.local, { stage: 1 })
})

test('剧本参考在准备时锁定，正文提交后游标前进一块，失败回合可清理', async () => {
  const run = harness('script')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 3, userText: '走进旅店' })
  assert.equal(run.chat().scriptState.prepared.nativeTurn, 3)
  assert.equal(run.chat().scriptState.recalledChunkIds.length, 0)

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 3, userText: '走进旅店', assistantText: '门轴发出低响。' })
  assert.equal(run.chat().scriptState.prepared, null)
  assert.deepEqual(run.chat().scriptState.recalledChunkIds, ['chunk-1'])
  assert.equal(run.chat().scriptState.cursor, 1)

  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 4, userText: '停下脚步' })
  assert.equal(run.chat().scriptState.prepared.chunkId, 'chunk-2')
  assert.equal(await run.orchestrator.discard({ sessionId: 'session-1', turn: 4 }), true)
  assert.equal(run.chat().scriptState.prepared, null)
})

test('正文替代先回到 checkpoint 再提交，剧本游标不会推进两次', async () => {
  const run = harness('script')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 1, userText: '走进旅店' })
  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 1, userText: '走进旅店', assistantText: '第一版正文' })
  assert.equal(run.chat().scriptState.cursor, 1)

  const rolled = run.rollback()
  run.replaceChat(rolled.chat)
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '【重新生成】走进旅店' })
  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, userText: '【重新生成】走进旅店', assistantText: '替代正文' })

  assert.equal(run.chat().scriptState.cursor, 1)
  assert.equal(run.chat().timeline.checkpoints.length, 1)
  assert.equal(run.chat().messages.at(-1).text, '替代正文')
})

test('兼容旧暂存记录：在最终回复完成后写入', async () => {
  const run = harness('card')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 5, userText: '参考 @[人物设定](tavern-file:materials%2F%E4%BA%BA%E7%89%A9%E8%AE%BE%E5%AE%9A.md)，确认改成新描述' })
  assert.deepEqual(run.chat().workspace.mountedResources, [{ kind: 'source', path: 'materials/人物设定.md', label: '人物设定' }])
  assert.deepEqual(run.plannerCalls.at(-1), { purpose: 'card', sourcePrepared: null })
  const staged = await run.orchestrator.stageChanges({ sessionId: 'session-1', turn: 5, fields: { description: '新描述' } })
  assert.equal(staged.changed, true)
  assert.equal(run.card().description, '旧描述')

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 5, userText: '确认改成新描述', assistantText: '已经改好了。' })
  assert.equal(run.card().description, '新描述')
  assert.equal(run.chat().nativeCommits['5'].changed, true)
  assert.deepEqual(await run.orchestrator.visibleTools('session-1'), [
    'web_search',
    'bash',
    'str_replace_editor',
    'read',
    'write',
    'edit',
    'read_image',
    'skill',
    'tavern_read_skill_reference',
    'tavern_save_skill',
    'cordis_inspect_list',
    'cordis_inspect_query',
    'cordis_inspect_self',
    'cordis_define',
    'cordis_run',
    'cordis_stop',
    'cordis_undefine',
    'tavern_user_profile_read',
    'tavern_user_profile_save',
    'tavern_read_card',
    'tavern_read_card_raw',
    'tavern_read_play_chat',
    'tavern_read_worldbook',
    'tavern_update_worldbook',
    'tavern_read_preset',
    'tavern_update_preset',
    'tavern_copy_card', 'tavern_convert_to_mvu', 'tavern_validate_mvu_conversion',
    'tavern_update_card',
    'tavern_restore_card',
    'tavern_validate_card',
    'tavern_test_response',
  ])
})

test('卡片 raw 扩展修改先暂存，最终回复后才写入工作 raw', async () => {
  const run = harness('card')
  await run.orchestrator.stageChanges({
    sessionId: 'session-1', turn: 9,
    rawOperations: [{ op: 'set', path: '/extensions/regex_scripts', value: [{ scriptName: '状态栏' }] }]
  })
  assert.equal(run.cardWorkspace().raw.extensions, undefined)

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 9, userText: '加入正则', assistantText: '已经加入。' })
  assert.deepEqual(run.cardWorkspace().raw.extensions.regex_scripts, [{ scriptName: '状态栏' }])
})

test('Windows 卡片模式暴露 PowerShell 而不是 Bash', async () => {
  const run = harness('card', { shellToolName: 'pwsh' })
  assert.deepEqual(await run.orchestrator.visibleTools('session-1'), [
    'web_search',
    'pwsh',
    'str_replace_editor',
    'read',
    'write',
    'edit',
    'read_image',
    'skill',
    'tavern_read_skill_reference',
    'tavern_save_skill',
    'cordis_inspect_list',
    'cordis_inspect_query',
    'cordis_inspect_self',
    'cordis_define',
    'cordis_run',
    'cordis_stop',
    'cordis_undefine',
    'tavern_user_profile_read',
    'tavern_user_profile_save',
    'tavern_read_card',
    'tavern_read_card_raw',
    'tavern_read_play_chat',
    'tavern_read_worldbook',
    'tavern_update_worldbook',
    'tavern_read_preset',
    'tavern_update_preset',
    'tavern_copy_card', 'tavern_convert_to_mvu', 'tavern_validate_mvu_conversion',
    'tavern_update_card',
    'tavern_restore_card',
    'tavern_validate_card',
    'tavern_test_response',
  ])
})

test('空白卡片工作台确认完整设定后直接创建并绑定正式人物卡', async () => {
  const run = harness('card', { draft: true })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 6, userText: '确认角色和玩家' })
  await run.orchestrator.stageChanges({ sessionId: 'session-1', turn: 6, fields: { name: '阿芙拉', player: '旅行者' } })
  assert.equal(run.chat().workspace.draft.name, '')

  const saved = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 6, userText: '确认角色和玩家', assistantText: '人物卡已创建。' })
  assert.equal(run.chat().workspace.draft.name, '阿芙拉')
  assert.equal(run.chat().workspace.player, '旅行者')
  assert.equal(run.chat().workspace.cursor, 1)
  assert.equal(run.chat().cardPath, 'cards/阿芙拉.json')
  assert.equal(run.chat().cardName, '阿芙拉')
  assert.deepEqual(run.createdCards.map((item) => item.path), ['cards/阿芙拉.json'])
  assert.deepEqual(saved.createdCard, { path: 'cards/阿芙拉.json', name: '阿芙拉' })
  const duplicate = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 6, userText: '确认角色和玩家', assistantText: '重复回调' })
  assert.equal(duplicate.duplicate, true)
  assert.equal(run.createdCards.length, 1)
  assert.deepEqual(await run.orchestrator.visibleTools('session-1'), ['web_search', 'bash', 'str_replace_editor', 'read', 'write', 'edit', 'read_image', 'skill', 'tavern_read_skill_reference', 'tavern_save_skill', 'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self', 'cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine', 'tavern_user_profile_read', 'tavern_user_profile_save', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_read_play_chat', 'tavern_read_worldbook', 'tavern_update_worldbook', 'tavern_read_preset', 'tavern_update_preset', 'tavern_copy_card', 'tavern_convert_to_mvu', 'tavern_validate_mvu_conversion', 'tavern_update_card', 'tavern_restore_card', 'tavern_validate_card', 'tavern_test_response'])
})

test('前台自由故事和剧本模式稳定暴露历史正文检索工具', async () => {
  const story = harness('story')
  const script = harness('script')

  assert.deepEqual(await story.orchestrator.visibleTools('session-1'), ['skill', 'tavern_read_skill_reference', 'tavern_recall_history', 'worldbook_search'])
  assert.deepEqual(await script.orchestrator.visibleTools('session-1'), ['skill', 'tavern_read_skill_reference', 'tavern_read_script', 'tavern_recall_history', 'worldbook_search'])
})

test('游戏前台按快照启用联网搜索，卡片工作台始终启用', async () => {
  assert.deepEqual(await harness('story').orchestrator.visibleTools('session-1'), ['skill', 'tavern_read_skill_reference', 'tavern_recall_history', 'worldbook_search'])
  assert.deepEqual(await harness('story', { webSearchEnabled: true }).orchestrator.visibleTools('session-1'), ['skill', 'tavern_read_skill_reference', 'tavern_recall_history', 'worldbook_search', 'web_search'])
  assert.deepEqual(await harness('script', { webSearchEnabled: true }).orchestrator.visibleTools('session-1'), ['skill', 'tavern_read_skill_reference', 'tavern_read_script', 'tavern_recall_history', 'worldbook_search', 'web_search'])
  for (const webSearchEnabled of [false, true]) {
    assert.equal((await harness('card', { webSearchEnabled }).orchestrator.visibleTools('session-1')).includes('web_search'), true)
  }
})

test('空白工作台缺少新卡必填信息时不接受确认提交', async () => {
  const run = harness('card', { draft: true })
  await assert.rejects(
    run.orchestrator.stageChanges({ sessionId: 'session-1', turn: 7, fields: { name: '阿芙拉' } }),
    /玩家身份还没有确认/
  )
  assert.equal(run.createdCards.length, 0)
})

test('旧会话已有完整临时设定时，再次确认也会落成正式人物卡', async () => {
  const run = harness('card', { draft: true })
  const chat = run.chat()
  chat.workspace.draft = { name: '阿芙拉', description: '旧会话已整理的设定' }
  chat.workspace.player = '旅行者'
  run.replaceChat(chat)

  const staged = await run.orchestrator.stageChanges({ sessionId: 'session-1', turn: 8, fields: { name: '阿芙拉', description: '旧会话已整理的设定', player: '旅行者' } })
  assert.equal(staged.changed, false)
  assert.equal(staged.createsCard, true)
  const saved = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 8, userText: '确认创建人物卡', assistantText: '人物卡已创建。' })

  assert.equal(saved.changed, true)
  assert.equal(run.chat().cardPath, 'cards/阿芙拉.json')
  assert.equal(run.createdCards.length, 1)
})


test('脚本提示实际走本轮准备、Frame 与一次性消费，重复准备不丢失', async () => {
  const run = harness('story', {
    planner: createContextPlanner({ prompt: () => '写作规则' }),
    projectScriptPromptWorldbook: async ({ chat }) => ({ context: chat.tavernScriptPrompts.some(p => p.content === '王都') ? '王都的城门设定' : '' })
  })
  const state = run.chat()
  state.tavernScriptPrompts = [
    { id: 'place', content: '王都', position: 'none', role: 'system', depth: 0, should_scan: true, once: true },
    { id: 'event', content: '本轮事件要求', position: 'in_chat', role: 'system', depth: 0, should_scan: false, once: true }
  ]
  run.replaceChat(state)
  const input = { sessionId: 'session-1', turn: 1, userText: '继续' }
  const first = await run.orchestrator.prepare(input)
  assert.match(foregroundFrameText(first.frame), /王都的城门设定/)
  assert.match(foregroundFrameText(first.frame), /本轮事件要求/)
  assert.deepEqual(run.chat().tavernScriptPrompts, [])
  const repeated = await run.orchestrator.prepare(input)
  assert.deepEqual(repeated.frame, first.frame)
})


test('玩家台账不进入前台 Frame 或原生请求消息', async () => {
  const run = harness('story', { ledger: { version: 1, items: [{ name: 'LEDGER_PRIVATE_SENTINEL', qty: 9 }], npcs: [], scenes: [] } })
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 1, userText: '继续', requestId: 'ledger-isolation' })
  assert.ok(!JSON.stringify(prepared.frame).includes('LEDGER_PRIVATE_SENTINEL'))
  assert.ok(!foregroundFrameText(prepared.frame).includes('LEDGER_PRIVATE_SENTINEL'))
  assert.equal(run.chat().ledger.items[0].name, 'LEDGER_PRIVATE_SENTINEL')
})

test('动态常驻只进入系统区块，正文条件条目继承本次宏变量', async () => {
  const run = harness('story', {
    planner: createContextPlanner({ prompt: () => '正文写作规则' }),
    preparedWorldBookContext: '城市：{{getvar::补充}}',
    projectWorldBookTemplates: async () => ({ dynamicConstants: true, context: '系统常驻正文', macroState: { local: { 补充: '龙姬解封' } }, refs: ['dlc'], diagnostics: [] })
  })
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '继续' })
  const text = foregroundFrameText(prepared.frame)
  assert.match(text, /城市：龙姬解封/)
  assert.doesNotMatch(text, /系统常驻正文/)
})


test('card tool saves immediately; failed turn and finalization do not undo or replay writes', async () => {
  const run = harness('card')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 9, userText: '修改描述' })
  const saved = await run.orchestrator.saveChanges({ sessionId: 'session-1', turn: 9, fields: { description: '已写入' } })
  assert.equal(saved.saved, true)
  assert.equal(run.card().description, '已写入')
  assert.equal(run.chat().pendingCardChanges?.['9'], undefined)
  await run.orchestrator.discard({ sessionId: 'session-1', turn: 9 })
  assert.equal(run.card().description, '已写入')
  await run.orchestrator.saveChanges({ sessionId: 'session-1', turn: 10, fields: { description: '校验后修正' } })
  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 10, userText: '修正', assistantText: '已校验' })
  assert.equal(run.card().description, '校验后修正')
})

test('new card is created and bound before tool returns; next write updates the same file', async () => {
  const run = harness('card', { draft: true })
  await run.orchestrator.saveChanges({ sessionId: 'session-1', turn: 1, fields: { name: '新角色', player: '旅人' } })
  assert.equal(run.chat().cardPath, 'cards/新角色.json')
  assert.equal(run.createdCards.length, 1)
  await run.orchestrator.saveChanges({ sessionId: 'session-1', turn: 1, fields: { description: '第二次修改' } })
  assert.equal(run.card().description, '第二次修改')
  assert.equal(run.createdCards.length, 1)
})


test('repair workbench reaches tools and completes even when its card cannot parse', async () => {
  const run = harness('card', { brokenCard: true })
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 1, userText: '校验并修复人物卡' })
  assert.equal(prepared.ready, true)
  assert.ok((await run.orchestrator.visibleTools('session-1')).includes('tavern_validate_card'))
  const done = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 1, userText: '校验', assistantText: '文件格式仍需修复' })
  assert.equal(done.saved, true)
  const play = harness('story', { brokenCard: true })
  await assert.rejects(play.orchestrator.prepare({ sessionId: 'session-1', turn: 1, userText: '继续' }), /invalid JSON/)
})


test('正式 Frame 使用当前输入的统一世界书投影，重试复用 Frame，不重抽组或重复记冷却', async () => {
  let calls = 0
  const planner = createContextPlanner({ prompt: () => '' })
  const run = harness('story', { planner, preparedWorldBookContext: '过期的预扫描',
    projectForegroundWorldbook: async ({ userText }) => {
      calls++
      assert.equal(userText, '找 Alice')
      return { context: '<角色库>\nAlice\n</角色库>', refs: ['entry:1'], reads: { 'entry:1': { turn: 0, fingerprint: 'test' } },
        activation: { schemaVersion: 2, refs: ['entry:1'], mode: 'keywords' }, diagnostics: [], error: null }
    }
  })
  const first = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 1, userText: '找 Alice' })
  const retry = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 1, userText: '找 Alice' })
  assert.equal(calls, 1)
  assert.deepEqual(first.frame, retry.frame)
  assert.match(first.frame.context.activeWorldbook, /<角色库>\nAlice\n<\/角色库>/)
  assert.doesNotMatch(first.frame.context.activeWorldbook, /过期的预扫描/)
  assert.deepEqual(first.frame.source.worldBook.refs, ['entry:1'])
  assert.equal(run.chat().worldBookReads['entry:1'].turn, 0)
})


test('世界书日志收据进入不可变 Frame；日志写入失败不阻断正文', async () => {
 for (const fail of [false,true]) {
  const run=harness('story',{projectForegroundWorldbook:async()=>({context:'世界书正文',refs:[],activation:{refs:[]},log:{entries:[],outputs:[]}}),
   recordWorldbookRecall:async()=>{if(fail)throw Error('磁盘不可写');return 'worldbook-recalls/chat/op.json'}})
  const result=await run.orchestrator.prepare({sessionId:'session-1',turn:1,userText:'继续'})
  assert.equal(result.ready,true)
  assert.equal(Object.isFrozen(result.frame),true)
  if(fail)assert.equal(result.frame.source.worldBook.recallLogError,'磁盘不可写')
  else assert.equal(result.frame.source.worldBook.recallLog,'worldbook-recalls/chat/op.json')
 }
})

test('玩家模板先于本轮召回，重试不重复执行；提交后只产生一条玩家消息', async () => {
  for (const compatibility of [false,true]) {
    let calls=0
    const run=harness('story',{projectUserTemplate:async()=>{
      calls++
      return {message:{role:'user',text:'进入少林',variables:[{place:'少林'}],tavernPluginData:{is_ejs_processed:[true]}},scopes:{local:{place:'少林'},initial:{}}}
    },projectForegroundWorldbook:async({chat,userText})=>{
      assert.equal(chat.variables.place,'少林');assert.equal(userText,'进入少林')
      return {context:'少林名册',activation:{refs:[]},refs:[],reads:{}}
    }})
    const input={sessionId:'session-1',turn:2,userText:'原始模板'}
    const start=compatibility?'beginCompatibility':'prepare'
    const first=await run.orchestrator[start](input)
    await run.orchestrator[start](input)
    assert.equal(calls,1)
    assert.equal(first.userText,'进入少林')
    assert.equal(run.chat().messages.length,0)
    await run.orchestrator.finalize({...input,assistantText:'少林的僧人迎上前。'})
    assert.equal(run.chat().messages.length,2)
    assert.equal(run.chat().messages[0].text,'进入少林')
    assert.equal(run.chat().messages[0].variables[0].place,'少林')
    assert.equal(run.chat().promptTemplateInput,undefined)
  }
})

for (const mode of ['story', 'script']) test(mode + ' 缺少人物卡绑定时明确拒绝开始回合', async () => {
  const run = harness(mode, { draft: true })
  await assert.rejects(run.orchestrator.prepare({ sessionId: 'session-1', turn: 1, userText: '继续' }), /缺少人物卡绑定/)
  assert.equal(run.plannerCalls.length, 0)
})
