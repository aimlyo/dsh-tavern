// Keep the conversion contract separate from generic card editing. JSON values
// carry story-specific state; the tool owns all executable/template scaffolding.
export function registerMvuConversionTools({ tools, defineTool, conversion, chatForSession }) {
  const output = {
    schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'json', required: true } } },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.report, null, 2) }]
  }
  const requireWorkbench = async exec => {
    const chat = await chatForSession(exec?.agent?.session?.id || '')
    if (chat?.mode !== 'card') throw Error('MVU 转换工具只能在卡片工作台使用')
  }
  tools.register(defineTool({
    name: 'tavern_convert_to_mvu',
    description: '将人物卡转换为独立 MVU 副本。先 inspect 获取实际世界书合并底稿、sourceRevision 和清理路径；用户授权转换后 apply。工具负责初值/后台规则、固定面板、每个开场入口、模型历史隔离与绑定，不需要手写 HTML 或正则。同一来源和名称可重复调用；更新现有副本须提供 inspect 返回的 targetRevision。',
    parameters: {
      action: { type: 'string', required: true, enum: ['inspect', 'apply'] },
      sourcePath: { type: 'string', required: true, description: '原卡 cards/... 路径；始终保留原卡' },
      name: { type: 'string', description: '副本名称，默认原卡名加 MVU版本；重复调用保持相同名称' },
      sourceRevision: { type: 'string', description: 'apply 必填，inspect 返回的来源版本' },
      targetRevision: { type: 'string', description: '更新副本时填 inspect 返回的目标版本' },
      initialState: { type: 'json', description: 'apply 必填：变量初值对象，不包裹 stat_data；可扩展集合保留 $meta' },
      updateRules: { type: 'string', description: 'apply 必填：路径、类型及依据剧情事实更新的规则' },
      displayFields: { type: 'array', description: '可选展示字段；省略则递归展示所有非内部字段', items: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true, description: '相对于初值的 JSON Pointer，如 /玩家/位置；可选择整个集合' },
        label: { type: 'string', description: '显示名称' }
      } } },
      cleanup: { type: 'array', description: '相对于 inspect 返回 card 的最小清理操作；全部按修改前底稿定位。保留无关内容。原值不匹配时整次转换不写入。', items: { type: 'object', additionalProperties: false, properties: {
        op: { type: 'string', required: true, enum: ['replaceText', 'replace', 'remove'] },
        path: { type: 'string', required: true, description: '如 /description 或 /character_book/entries/0；数组下标按 inspect 底稿' },
        expected: { type: 'json', required: true, description: 'replace/remove 为完整原值；replaceText 为只出现一次的原文片段' },
        value: { type: 'json', description: '替换值；replaceText 必须是字符串，删除片段用空字符串；remove 省略' }
      } } }
    },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) { await requireWorkbench(exec); return { report: await conversion.convert(args) } }
  }))
  tools.register(defineTool({
    name: 'tavern_validate_mvu_conversion',
    description: '只读验收专用工具生成的 MVU 副本：从磁盘检查绑定、初值、后台分流、所有开场、面板唯一性与模型历史隔离，并在隔离 DOM 中模拟固定面板的变量更新/恢复。不会调用模型或执行原卡自定义脚本；报告明确列出未实测的真实结算和浏览器项目。',
    parameters: { path: { type: 'string', required: true, description: '转换后的 cards/... 副本路径' } },
    output, isConcurrencySafe: () => true,
    async execute(args, exec) { await requireWorkbench(exec); return { report: await conversion.verify(args) } }
  }))
}
