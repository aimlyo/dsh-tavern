# dsh-tavern

**基于 DeepSeek Harness（DSH）的文字游戏 Agent，支持导入 SillyTavern 人物卡。**

选一张卡自由游玩，或绑定小说、剧本和大纲，让故事沿主线推进。也可以与 Agent 对话，从素材制作新卡，修改人物设定和世界书。

[使用文档](https://flizzywine.github.io/dsh-tavern/) · [入门指南](https://flizzywine.github.io/dsh-tavern/#a02) · [宣传视频](https://www.bilibili.com/video/BV1NAeq6iELC/) · [安装与排错](docs/installation.md) · [Discord 交流](https://discord.com/channels/1134557553011998840/1538577327028445194)

![dsh-tavern：左侧会话、中间游玩、右侧人物状态](docs/images/readme/overview.png)

## 可以做什么

- **自由游玩或跟随剧本**：自由输入，也可选择独立生成的行动候选；支持添加持续指导、带意见重写和回退。误回退后，可在「更多」中点击「撤销回退」恢复最近一次回退的正文和状态；开始新生成或编辑后，恢复点会失效。
- **对话式制作人物卡**：管理人物卡、世界书、预设和剧本，导入时保留原版，讨论确认后修改工作版。
- **使用酒馆人物卡**：支持 PNG / JSON 卡、正则美化、HTML 展示、MVU 后台变量更新和已适配的小手机；第三方脚本的兼容范围取决于具体接口。
- **为剧情配图**：手动生成场景插画，支持带意见重画和查看不同版本；需单独配置生图服务。

导入人物卡即可开始，默认使用内置预设。更多功能、界面截图和公开样例见[功能指南](https://flizzywine.github.io/dsh-tavern/#index)。

## 产品特色

- **兼容酒馆生态**：支持人物卡、预设、世界书、酒馆助手、MVU、正则等，大部分酒馆助手脚本可直接使用；具体兼容情况取决于脚本所用接口。
- **无需折腾预设**：导入人物卡即可游玩，默认使用内置预设；通过人物卡或 Guide 调整文风和剧情要求。
- **正文专注讲故事**：候选项和后台状态维护分开处理，减少正文的格式负担；剧本模式可借助原文引导叙事风格，减少模板化表达。
- **速度超快**：一轮交互大约 10 秒，无需超长等待。
- **缓存命中率超高**：95% 以上的缓存命中率。
- **按需读取上下文**：只读取当前需要的资料，减少无效 Token 消耗。
- **长程记忆**：内置记忆检索工具，帮助在长程游玩中维持记忆一致性。
- **人物卡美化与 MVU**：支持正则美化和 HTML 展示，由后台 Agent 更新 MVU 变量，右侧持续展示状态栏。
- **小手机与正文并排**：在人物卡应用中打开已适配的小手机，边读剧情边查看角色聊天。
- **剧情场景插画**：按当前剧情手动生图，支持带意见重画、版本切换和大图查看；默认关闭，需单独配置生图服务。
- **多平台使用**：支持 Windows、macOS、Linux；Windows 和 macOS 可使用 Desktop，Android 可尝试 DSHA。
- **自由扩展插件**：可自行编写、安装和组合 DSH 插件，更新时保留用户添加的插件与配置。

## 界面展示

### 自由游玩：选择行动，也可以自由输入

正文与候选项分开生成，右侧可查看持续指导和人物姿势。

![自由游玩的独立候选项、Guide 与人物姿势](docs/images/readme/free-play-candidates.png)

### 剧本游玩：沿主线推进，保留行动自由

右侧展示剧本进度与本轮参考片段，不必一次塞入整部小说。

![剧本模式的正文、剧情进度与召回片段](docs/images/readme/script-mode.png)

### 对话式改卡：边讨论，边修改人物设定

与 Agent 讨论修改内容，同时查看人物卡字段、世界书和绑定剧本。

![通过对话讨论并编辑人物卡字段](docs/images/readme/card-editor.png)

### MVU：人物状态随剧情变化

后台更新变量，右侧状态栏持续显示，正文下方可查看本轮更新结果。

![MVU 人物卡的变量更新结果与右侧酒馆状态栏](docs/images/readme/mvu-status-panel.png)

### 小手机：角色聊天与正文并排展示

![正文与右侧小手机聊天界面](docs/images/readme/phone-panel.png)

### 场景插画：让剧情有画面

插画显示在对应正文下方，点击可查看大图。

![公开灯塔案例的场景插画与完整产品界面](docs/images/readme/scene-image-product.png)

## 安装与更新

### 纯小白安装（仅限 Windows x64）

**[点击下载 Windows 一键在线安装 EXE](https://github.com/flizzywine/dsh-tavern/releases/download/v2.0/DSH-Tavern-Desktop-2.0.5-x64-Setup-UpdateFix.exe)**

下载后双击运行，**首次启动需要联网，自动安装当前兼容 Desktop 2.0.5 的最新版酒馆**，无需另外安装 Node.js 或 DSH Desktop。Desktop 固定为 2.0.5；已有安装和数据会保留，后续可在酒馆界面中更新。

首次安装可选择文件夹，例如 `D:\Apps\DSH-Tavern`。完成后自动创建**桌面和开始菜单的「DSH Tavern」快捷方式**，重启电脑后从这里打开即可；下载的安装包可以删除。完成提示和安装目录里的 `如何启动.txt` 会列出程序及数据位置。

**旧便携版找不到入口？** 下载上面的新版安装包，运行后点击「修复并启动」，会在原位置补建入口并保留原数据，不必重新导入人物卡或聊天。请不要直接运行 `AppData\Local\DSH-Tavern-Portable\runtime-…` 内的 `DSH Desktop.exe`。详见[Windows 安装与启动入口](docs/installation.md#windows-一键安装版)。

**卸载后重装提示“已记录的安装目录暂时不可用”？** 上方下载已更新为修复版。重新下载并运行，选择「重新安装」后指定安装位置即可，无需手动清理注册表。若要继续使用旧聊天和人物卡，请先连接原磁盘或选择「使用原目录」；重新安装不会删除旧文件，也不能恢复已删除的数据。

**更新一直停在“正在更新”？** Windows 一键版请下载上方修复版安装器，按原安装位置修复入口后重启，再检查更新。普通 Desktop 版可从下方的 DSH 终端重新运行安装命令。新版会自动准备经过校验的独立包管理环境，修复依赖安装完成后进程不退出的问题；聊天、人物卡和适配的 DSH 版本保持不变。

**为什么锁定 DSH 版本？** DSH 经常进行破坏性更新，DSH Desktop 和 DSHA 也会随之更新内置 DSH，可能导致原本能用的插件在宿主升级后无法运行。为避免用户更新后酒馆失效，本项目必须锁定已适配的 DSH 版本：安装器只接受适配版本，检测到非适配版本会停止安装。请使用下方列出的适配版本，等待本项目完成新版本适配后再升级宿主。

首次安装、更新或重新安装使用同一条命令，保留人物卡、对话和配置。所有平台都要求实际运行的 DSH 为 **`0.1.2-rc.1`**；版本不匹配时停止安装，请使用下方适配版本。

### DSH Desktop（Windows / macOS）

适配版本：**[DSH Desktop 2.0.5](https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.5)**（[历史 Release 下载](https://github.com/anywhere-labs/dsh-desktop/releases)）。必须使用适配版本；检测到非适配 DSH 版本时将停止安装。

安装并打开 DSH Desktop 后，进入 **设置 → 通用设置**，点击页面顶部的 **打开 DSH 终端**（如下图）。

![DSH Desktop 设置页面：在顶部点击“打开 DSH 终端”](docs/images/readme/open-dsh-terminal.png)

在弹出的终端窗口中，复制下方对应系统的命令，粘贴后按 **回车** 执行：

Windows：

```powershell
$env:DSH_TAVERN_HOST='desktop'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller
```

macOS：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=desktop sh
```

安装完成后重启 DSH Desktop，进入 **设置 → 桌面设置**，在右侧 **Profile** 列表中点击 **tavern**。当 tavern 旁显示 **当前** 时，就表示已选中酒馆配置（如下图）。

![在设置的“桌面设置”中选择 tavern，红圈标出了入口和目标配置](docs/images/readme/select-tavern-profile.png)

### 命令行（Windows / macOS / Linux）

需要 **Node.js 22.19 或更高版本**，无需预装 DSH。安装器使用独立的 DSH `0.1.2-rc.1`。

**命令行版与电脑上已经安装的 DSH（包括全局 DSH 和 DSH Desktop）相互独立，互不影响。** 运行时、配置和游戏数据分别存放；安装或更新命令行版不会修改已有 DSH，已有 DSH 的升级也不会更换命令行版的独立运行时。

Windows PowerShell：

```powershell
$env:DSH_TAVERN_HOST='cli'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller
```

macOS / Linux / WSL2：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=cli sh
```

安装后会自动启动并打开网页。以后使用：

```bash
dsh-tavern open      # 打开网页
dsh-tavern start     # 启动
dsh-tavern stop      # 停止
dsh-tavern restart   # 重启
dsh-tavern update    # 更新
```

首次安装会询问目录：**1 默认目录 `~/.dsh-tavern/`、2 当前目录（回车默认）、3 其他完整路径**。程序、独立运行时和游戏数据存入所选目录；命令入口和 npm/pnpm 缓存可能位于目录外。更新沿用已安装位置；重新运行安装命令时，请在原安装根目录执行，或设置 `DSH_TAVERN_CLI_HOME` 指向原位置。与 Desktop / DSHA 的数据分开，切换安装方式不会自动同步数据。备份、迁移、自定义目录和手动安装见[完整安装说明](docs/installation.md)。

### Android（实验性）

通过 [DSHA](https://github.com/DSH-APP/DSHA) 安装，适配版本：**[1.2.0-rc1.4](https://github.com/DSH-APP/DSHA/releases/tag/v1.2.0-rc1.4)**（[历史 Release 下载](https://github.com/DSH-APP/DSHA/releases)）。必须使用适配版本；检测到非适配 DSH 版本时将停止安装。Android 属于实验性支持，不保证一定可用。

1. **安装 DSHA**：点击上面的适配版本，展开 **Assets**，下载适合手机的 **APK** 并安装（不要下载 Source code）。
2. **先启动一次**：打开 DSHA，配置模型和 API 密钥，确认 DSHA 可以正常启动。
3. **安装酒馆**：打开 DSHA 底部的 **终端**，完整复制下面这一条命令，粘贴后回车，保持 DSHA 打开并等待执行结束。

```bash
node -e "fetch('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@69d74f5/android/setup.sh').then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);require('fs').writeFileSync('/tmp/dsh-tavern-setup.sh',await r.text())}).then(()=>{const r=require('child_process').spawnSync('bash',['/tmp/dsh-tavern-setup.sh'],{stdio:'inherit'});process.exit(r.status??1)}).catch(e=>{console.error(e);process.exit(1)})"
```

4. **进入酒馆**：看到“全部完成”后重启 DSHA，打开底部 **启动** 页 → 点 **启动** → 等待“已就绪，可进入” → 点 **进入** → 从侧栏打开 **酒馆工作台**。
5. **开始游玩**：导入人物卡，选择人物卡开始。如果无法读取 Download 目录，请在 Android 系统设置中允许 DSHA **访问所有文件**，或尝试系统文件选择器。

点击 **酒馆工作台** 后，酒馆会直接在 DSHA 内打开，无需另外安装窗口插件或手动填写地址。顶部的 **刷新** 用来重新加载页面，**直接打开** 切换到原酒馆页面，**关闭** 返回 DSHA 主界面。

**以后打开：DSHA → 启动 → 进入 → 酒馆工作台。** 使用期间保持 DSHA 运行，从这个入口进入即可，无需手动输入浏览器地址。

**老用户更新：**点击酒馆左侧栏底部的 **更新到最新版**；酒馆打不开时，回到 DSHA 主界面，在 **酒馆工作台**旁点 **更新/修复**。更新完成后，在 DSHA 底部 **启动** 页点 **重启**，再按上述路径进入，即可使用新窗口。安装报错或找不到入口时，见 [Android 安装与排错说明](docs/android-install.md)。

### 手机远程访问（可选插件）

**版本提醒：酒馆当前适配 DSH `0.1.2-rc.1`。参考插件教程时，请勿重新安装或升级到其他 DSH 版本。**

酒馆运行在电脑或服务器上，手机通过浏览器访问，可按场景选择：

- **自己电脑运行，手机扫码连接**：[dsh-pocket](https://github.com/shaobeichen/dsh-pocket)。安装并重启后，在 **设置 → 手机访问** 中选择局域网或公网访问，手机扫码即可。
- **服务器部署，手机远程登录**：[dsh-webui-auth](https://github.com/Yuuz12/dsh-webui-auth)。为远程 WebUI 添加账号密码认证；服务器地址、监听与端口需先配置为可访问，插件本身不提供内网穿透。首次账号设置及配置方法见插件 README。

## 开始游玩

1. 在 **设置 → 模型** 中配置模型服务和 API 密钥。
2. 导入人物卡，选择人物卡开始游玩；也可以进入卡片工作台制作新卡。

[完整使用指南](https://flizzywine.github.io/dsh-tavern/)提供详细操作、截图和样例下载，文档网站本身不是在线游戏服务。

## 交流与反馈

欢迎到 [Discord 讨论频道](https://discord.com/channels/1134557553011998840/1538577327028445194)交流使用经验、分享人物卡或反馈问题。需要具备类脑社区成员资格才能进入。

反馈故障时，可从对话顶部的“日志”下载执行记录；分享前请检查其中的对话和附件隐私。

## 贡献者与致谢

感谢 [@huajiao1998（meng）](https://github.com/huajiao1998) 持续提交详细的问题报告、复现步骤、性能分析和修复建议，并协助验证改进，帮助完善长会话、后台任务和界面稳定性。

## 用户反馈

[![用户反馈：游玩五六百层后，仍能记起开局物品的来历](docs/images/readme/testimonials/long-chat-memory.jpg)](docs/images/readme/testimonials/long-chat-memory.jpg)

[![用户反馈：使用本地 27B 模型，体验非常良好](docs/images/readme/testimonials/local-27b.webp)](docs/images/readme/testimonials/local-27b.webp)

[![用户分享缓存命中率与几十轮游玩的实际花费](docs/images/readme/testimonials/cache-and-cost.webp)](docs/images/readme/testimonials/cache-and-cost.webp)

[![关于默认预设、回复速度与 Guide 剧情引导的反馈](docs/images/readme/testimonials/default-preset-and-guide.jpg)](docs/images/readme/testimonials/default-preset-and-guide.jpg)

[![关于使用体验的反馈](docs/images/readme/testimonials/ease-of-use.webp)](docs/images/readme/testimonials/ease-of-use.webp)

[![关于记忆系统的反馈](docs/images/readme/testimonials/memory-feedback.webp)](docs/images/readme/testimonials/memory-feedback.webp)

[![用户聊天反馈](docs/images/readme/testimonials/chat-feedback.webp)](docs/images/readme/testimonials/chat-feedback.webp)

[![关于文笔的反馈](docs/images/readme/testimonials/writing-feedback.webp)](docs/images/readme/testimonials/writing-feedback.webp)

[![社区用户对插件的反馈](docs/images/readme/testimonials/plugin-feedback.webp)](docs/images/readme/testimonials/plugin-feedback.webp)

[![用户反馈：会主动推进剧情，引入新角色和新事件](docs/images/readme/testimonials/proactive-story.webp)](docs/images/readme/testimonials/proactive-story.webp)

[![用户对整体使用体验的评价与稳定版适配的询问](docs/images/readme/testimonials/overall-experience.webp)](docs/images/readme/testimonials/overall-experience.webp)

[![用户反馈：缓存命中率高](docs/images/readme/testimonials/cache-hit-feedback.webp)](docs/images/readme/testimonials/cache-hit-feedback.webp)

[![用户反馈：MVU 体验不错，喜欢按要求重新生成文本的功能](docs/images/readme/testimonials/mvu-and-rewrite.webp)](docs/images/readme/testimonials/mvu-and-rewrite.webp)

[![用户反馈：回复速度快，十几秒即可收到回复](docs/images/readme/testimonials/reply-speed.webp)](docs/images/readme/testimonials/reply-speed.webp)

[![用户反馈：特别好用，游玩体验更好](docs/images/readme/testimonials/play-experience.png)](docs/images/readme/testimonials/play-experience.png)

[![用户反馈：Agent 写作的输出质量更高](docs/images/readme/testimonials/agent-writing-quality.png)](docs/images/readme/testimonials/agent-writing-quality.png)

[![用户反馈：修改角色卡像给游戏装 MOD，改卡本身也很有趣](docs/images/readme/testimonials/character-card-editing.jpg)](docs/images/readme/testimonials/character-card-editing.jpg)

[![用户反馈：世界书和角色卡调整方便，与 DSH 语音阅读插件兼容良好](docs/images/readme/testimonials/setup-and-plugin-compatibility.jpg)](docs/images/readme/testimonials/setup-and-plugin-compatibility.jpg)

[![用户反馈：AI 修改内容方便，变量更新稳定，轻前端游玩体验不错](docs/images/readme/testimonials/ai-editing-and-variable-stability.jpg)](docs/images/readme/testimonials/ai-editing-and-variable-stability.jpg)
