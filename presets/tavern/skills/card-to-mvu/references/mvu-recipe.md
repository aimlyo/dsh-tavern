# 转换参数与边界

固定装配由 `tavern_convert_to_mvu` 维护。本文件只解释如何把原卡语义填入工具，不维护另一份 HTML/正则配方。

## 调用示例

先 inspect 取得 catalog、sourceRevision；用 read/search 读取 source 底稿。更新已有副本时还需 targetRevision；用 scope=plan 看方案、scope=target 看副本。

```json
{"action":"inspect","sourcePath":"cards/原卡.json","name":"原卡 MVU版本"}
```

按目录读取一个字段：

```json
{"action":"read","sourcePath":"cards/原卡.json","sourceRevision":"inspect 返回的版本号","path":"/character_book/entries","offset":0,"limit":30}
```

对象/数组返回下一层目录；字符串返回原文 text、总长度和 nextOffset。search 使用原文 query，不执行正则；每个匹配包含 JSON Pointer、字符位置和短上下文。read/search 都校验版本。位置仅供定位，cleanup 仍用唯一原文边界。

先 preview，通过后用同样参数 apply。下面的版本号、路径和短片段仅为示例，必须来自 inspect 底稿。复制整卡、清理和安装 MVU 都由工具完成：

```json
{
  "action": "apply",
  "sourcePath": "cards/原卡.json",
  "name": "原卡 MVU版本",
  "sourceRevision": "inspect 返回的版本号",
  "initialState": {
    "玩家": {"位置": "门口"},
    "人物": {"$meta": {"extensible": true, "template": {"姓名": "", "位置": "未明确", "在场": true}}}
  },
  "updateRules": "玩家.位置为字符串，正文确认移动后才更新，打算移动不算。人物按姓名索引，新增时提交完整对象；离场改在场为 false，保留档案。",
  "displayFields": [{"path":"/玩家","label":"玩家"},{"path":"/人物","label":"人物"}],
  "cleanup": [{"op":"replaceText","path":"/description","expected":"每轮末尾输出状态表。","value":""}]
}
```

`cleanup` 路径相对于 source 底稿，不带 `/data` 或 `/raw`。删除数组元素时用 inspect 时的原始下标，工具处理下标移动。修改后的文本保持剧情语义；不留下迁移说明。同字段多处清理分别提交小操作；所有操作按修改前底稿定位，工具拒绝重叠范围。

清理长内容的示例（仅用于原卡确有对应内容时）：

```json
[
  {"op":"remove","path":"/character_book/entries/3"},
  {"op":"remove","path":"/extensions/regex_scripts/1"},
  {"op":"replaceBlock","path":"/first_mes","start":"<旧状态栏>","end":"</旧状态栏>","value":""},
  {"op":"replaceText","path":"/description","expected":"每轮输出三个候选行动。","value":""}
]
```

`remove` / `replace` 由来源版本号保护，省略 `expected`。`replaceBlock` 包含首尾标记，两者必须各自唯一、前后有序；边界有歧义时选择更长但仍简短的标记。无需转录区块内部代码或保留的剧情。

展示路径使用 JSON Pointer，键中的 `~` 和 `/` 分别写作 `~0`、`~1`。省略 displayFields 展示全部非内部字段；选择集合时，新成员会自动展示。工具不会生成自定义布局或迁移按钮行为。

## 需要额外判断的卡

- **已有 MVU**：先识别原有初值、Schema、脚本和面板。转换工具遇到残留初值、后台规则或旧状态声明会停止，要求明确合并/清理；它不是通用的已有 MVU 卡升级器。已有复杂 MVU 正常工作时可保留现状，不必强行重装。
- **多开场**：工具给每个开场安装一个入口，但共享一份初值。开场事实不同，先统一初值策略或分别生成副本，不能声称入口检查证明各开场语义一致。
- **外部世界书**：工具复制实际绑定内容到副本，处理合并编号并保留触发条件；原卡未生效的内置书作为保留数据，不因转换而启用。inspect 返回的世界书内容是清理操作的依据。
- **增量修订**：apply 默认把新 cleanup 追加到已保存方案，完全相同的操作去重；省略 initialState/updateRules/displayFields 沿用旧值。底稿始终是原卡，不是副本。修改同字段旧操作时提交 cleanupResetPaths，例如 `["/first_mes"]`，同时提交该字段的完整新清理。需要恢复该字段原文时，只 reset 不追加。
- **完整重做**：planMode=replace 不继承任何旧定义或清理，必须提交完整方案。旧版副本没有 cleanup 记录，或 sourceRevision 已改变时只能完整重做。
- **已有副本被手工改过**：inspect.target.externallyModified 会提示，默认合并被拒绝。先以 scope=target 读取，把需要保留的副本修改纳入完整方案，再以 planMode=replace 和 targetRevision 更新，不能忽略差异直接覆盖。
- **定位失败**：error.anchor 指明 expected/start/end，matches 是出现次数，candidates 是最多 5 个短上下文。0 次先读原卡字段，检查是否误用了副本附加换行；2 次以上选择更长的唯一标记。不要模糊匹配、盲目改编码或直接写资源文件。
- **验收清单**：changes 是实际执行的清理操作，removedEntries/preservedEntries 分别列实际删除与原样保留的世界书条目，带条目名与 enabled；禁用不等于可删除。planIntegrity 检查是否有方案外修改，legacyResidue 只检查被修改来源渲染正则中可识别的标签；它们不能替代剧情语义判断。
- **真实结算**：初值定义通过不代表官方初始化已成功；模板 DOM 模拟使用测试快照，不运行原卡脚本，也不调用模型。完整实测以实际结算回执、持久变量和 UI 为准。

保持一套清晰的变量约束。可扩展集合需要完整模板；已有 Zod 脚本的约束仍需单独核对。后台操作路径相对于 stat_data，例如 `/玩家/位置`，不是 `/stat_data/玩家/位置`。原卡不存在的数值、公式和状态机制不新增。
