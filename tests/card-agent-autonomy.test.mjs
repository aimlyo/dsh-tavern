import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = relative => readFile(new URL('../' + relative, import.meta.url), 'utf8')
const cardMode = await read('tavern-plugin/prompts/card-system.md')
const editTask = await read('tavern-plugin/prompts/card-task-edit.md')
const extractTask = await read('tavern-plugin/prompts/card-task-extract.md')
const worldBookTask = await read('tavern-plugin/prompts/card-task-worldbook.md')
const presetTask = await read('tavern-plugin/prompts/card-task-preset.md')
const scriptTask = await read('tavern-plugin/prompts/card-task-script.md')
const advancedSkill = await read('presets/tavern/skills/advanced-capabilities/SKILL.md')
const mvuSkill = await read('presets/tavern/skills/card-to-mvu/SKILL.md')

test('卡片 system 默认空白，任务与技能独立保留', () => {
  assert.equal(typeof cardMode, 'string')
  assert.doesNotMatch(advancedSkill, /普通 Tavern 资源能由专用工具完成时，仍优先走专用工具/)
})

test('任务提示继承用户已有授权，不强制重复确认或禁止适合任务的整体读取', () => {
  for (const prompt of [editTask, extractTask, worldBookTask, presetTask, scriptTask]) {
    assert.doesNotMatch(prompt, /得到(?:我|用户)明确确认后/)
    assert.doesNotMatch(prompt, /不要一次读取(?:整张卡|全文|整本世界书|整个大型预设)/)
  }
})

test('MVU 转换创建保留封面的独立副本，并保护原卡和无关字段', () => {
  assert.match(mvuSkill, /`tavern_convert_to_mvu`/)
  assert.match(mvuSkill, /默认保留无关字段/)
  assert.match(mvuSkill, /工具保存封面、世界书和绑定/)
  assert.match(mvuSkill, /原卡及共享资源保持不变/)
  assert.match(mvuSkill, /原文不匹配重新定位/)

})

test('剧本任务不把现有界面路径描述成 Agent 的能力禁令', () => {
  assert.doesNotMatch(scriptTask, /绑定或解绑人物卡是剧本库中的手动操作，不通过 Agent 完成/)
})
