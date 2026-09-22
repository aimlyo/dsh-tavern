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
    description: '将人物卡转换为独立 MVU 副本。先 inspect 获取精简目录和版本，再 read/search 按需读取；preview 预检不保存，用户授权转换后 apply。已有副本默认合并已保存方案，省略的定义与清理保留。工具从磁盘复制整卡后清理并追加 MVU；参数仅提交改动和变量定义，不回传原卡或保留内容。工具负责初值/后台规则、固定面板、每个开场入口、模型历史隔离与绑定，不需要手写 HTML 或正则。同一来源和名称可重复调用；更新现有副本须提供 inspect 返回的 targetRevision。',
    parameters: {
      action: { type: 'string', required: true, enum: ['inspect', 'read', 'search', 'preview', 'apply'] },
      sourcePath: { type: 'string', required: true, description: '原卡 cards/... 路径；始终保留原卡' },
      detail: { type: 'string', enum: ['summary','full'], description: 'inspect 默认 summary 只返回目录；full 返回整卡及副本，仅小卡需要' },
      scope: { type: 'string', enum: ['source','target','plan','preservedWorldbook'], description: 'read/search 默认 source；target/plan 还需 targetRevision，路径均相对于该对象' },
      path: { type: 'string', description: 'read/search 的 JSON Pointer；空串为根目录，read 对象返回子目录，字符串分页返回 text' },
      query: { type: 'string', description: 'search 必填：原文片段，非正则，最多 1000 字符' },
      offset: { type: 'number', description: 'read 的字符/目录起点，search 的匹配结果起点；使用返回的 nextOffset 续读' },
      limit: { type: 'number', description: '每页上限：字符串 8000 字符、目录 100 项、搜索 40 项' },
      planMode: { type: 'string', enum: ['merge','replace'], description: 'apply/preview 默认 merge：保留已保存定义和清理，追加去重；replace 显式替换完整方案，需要重新提交全部定义和清理' },
      cleanupResetPaths: { type: 'array', items: { type: 'string' }, description: 'merge 时先移除这些原卡路径的全部旧清理操作，再追加 cleanup；纠正同字段操作时使用' },
      name: { type: 'string', description: '副本名称，默认原卡名加 MVU版本；重复调用保持相同名称' },
      sourceRevision: { type: 'string', description: 'read/search/preview/apply 必填，inspect 返回的来源版本' },
      targetRevision: { type: 'string', description: '更新副本时填 inspect 返回的目标版本' },
      initialState: { type: 'json', description: '首次 apply/preview 或 replace 必填：变量初值对象，不包裹 stat_data；可扩展集合保留 $meta' },
      updateRules: { type: 'string', description: '首次 apply/preview 或 replace 必填：路径、类型及依据剧情事实更新的规则' },
      displayFields: { type: 'array', description: '可选展示字段；首次省略则展示全部非内部字段，增量省略沿用已保存配置', items: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true, description: '相对于初值的 JSON Pointer，如 /玩家/位置；可选择整个集合' },
        label: { type: 'string', description: '显示名称' }
      } } },
      cleanup: { type: 'array', description: '相对于 source 底稿的小改动；版本号校验整个底稿。整项删除只传路径，短改文只传片段，长区块只传首尾标记；同字段支持多处不重叠编辑。无需回传原卡。', items: { type: 'object', additionalProperties: false, properties: {
        op: { type: 'string', required: true, enum: ['replaceText', 'replaceBlock', 'replace', 'remove'] },
        path: { type: 'string', required: true, description: '如 /description 或 /character_book/entries/0；数组下标按 inspect 底稿' },
        reason: { type: 'string', description: '简短说明本项为何属于旧状态/候选项实现；保留到验收删除清单' },
        expected: { type: 'json', description: '仅 replaceText 必填：恰好出现一次的短原文；remove/replace 省略，无需回传完整原值' },
        start: { type: 'string', description: 'replaceBlock 必填：在字段内唯一的起始标记，包含在替换范围中' },
        end: { type: 'string', description: 'replaceBlock 必填：在字段内唯一且位于 start 后的结束标记，同样包含在替换范围中' },
        value: { type: 'json', description: '替换值；replaceText/replaceBlock 必须是字符串，删除片段或区块用空字符串；replace 仅提交新值，remove 省略' }
      } } }
    },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      await requireWorkbench(exec)
      try { return { report: await conversion.convert(args) } }
      catch (error) {
        if (!error.code || !error.details) throw error
        return { report: { ok:false, error:{code:error.code,message:error.message,...error.details} } }
      }
    }
  }))
  tools.register(defineTool({
    name: 'tavern_validate_mvu_conversion',
    description: '只读验收专用工具生成的 MVU 副本：报告实际删除/保留条目、已识别旧渲染残留与方案外修改，从磁盘检查绑定、初值、后台分流、所有开场、面板唯一性与模型历史隔离，并在隔离 DOM 中模拟固定面板的变量更新/恢复。不会调用模型或执行原卡自定义脚本；报告明确列出未实测的真实结算和浏览器项目。',
    parameters: { path: { type: 'string', required: true, description: '转换后的 cards/... 副本路径' } },
    output, isConcurrencySafe: () => true,
    async execute(args, exec) { await requireWorkbench(exec); return { report: await conversion.verify(args) } }
  }))
}
