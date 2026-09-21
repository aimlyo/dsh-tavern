# 转换参数与边界

固定装配由 `tavern_convert_to_mvu` 维护。本文件只解释如何把原卡语义填入工具，不维护另一份 HTML/正则配方。

## 调用示例

先 inspect，读取返回的 card、sourceRevision；更新已有副本时也读取 existingTarget、targetRevision。

```json
{"action":"inspect","sourcePath":"cards/原卡.json","name":"原卡 MVU版本"}
```

再 apply。下面的版本号和原文仅为示例，必须替换为 inspect 返回的实际值：

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

`cleanup` 路径相对于 inspect 的 card，不带 `/data` 或 `/raw`。删除数组元素时用 inspect 时的原始下标，工具处理下标移动。修改后的文本保持剧情语义；不留下迁移说明。字段包含多个清理位置时，用一次 replace 提交完整原值和整理后的值。

展示路径使用 JSON Pointer，键中的 `~` 和 `/` 分别写作 `~0`、`~1`。省略 displayFields 展示全部非内部字段；选择集合时，新成员会自动展示。工具不会生成自定义布局或迁移按钮行为。

## 需要额外判断的卡

- **已有 MVU**：先识别原有初值、Schema、脚本和面板。转换工具遇到残留初值、后台规则或旧状态声明会停止，要求明确合并/清理；它不是通用的已有 MVU 卡升级器。已有复杂 MVU 正常工作时可保留现状，不必强行重装。
- **多开场**：工具给每个开场安装一个入口，但共享一份初值。开场事实不同，先统一初值策略或分别生成副本，不能声称入口检查证明各开场语义一致。
- **外部世界书**：工具复制实际绑定内容到副本，处理合并编号并保留触发条件；原卡未生效的内置书作为保留数据，不因转换而启用。inspect 返回的世界书内容是清理操作的依据。
- **已有副本被手工改过**：inspect 会返回 existingTarget。更新从原卡底稿重新生成；先把需要保留的副本修改纳入定义或清理操作，再提交 targetRevision，不能忽略差异直接覆盖。
- **真实结算**：初值定义通过不代表官方初始化已成功；模板 DOM 模拟使用测试快照，不运行原卡脚本，也不调用模型。完整实测以实际结算回执、持久变量和 UI 为准。

保持一套清晰的变量约束。可扩展集合需要完整模板；已有 Zod 脚本的约束仍需单独核对。后台操作路径相对于 stat_data，例如 `/玩家/位置`，不是 `/stat_data/玩家/位置`。原卡不存在的数值、公式和状态机制不新增。
