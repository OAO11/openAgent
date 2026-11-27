# openAgent 本地桌面版调整（2026-11-26）

## 产品范围

继续使用 LiveAgent 桌面代码与 K-brain 后端，不新增自有后端。工作台启动默认收起；窗口启动尺寸为 1159 × 857 个逻辑像素，不恢复旧窗口尺寸或最大化状态。

设置与输入区移除语音输入、SSH、远程访问和云同步。移除 Gateway 的启动、IPC 注册、托盘入口、构建、打包、WebUI workspace 和发布任务；移除 K-brain 的 SSHManager、TunnelManager、SSH API。保留桌面自身使用的本地 K-brain 服务；K-brain 主机工具桥只开放鉴权的回环 ReadTerminal。本机浏览器扩展桥继续保留，不提供远程 WebUI。正常运行不开启调试检查桥接，开发验收需显式指定端口。

本地终端、工作区、浏览器工具、模型供应商、MCP、备份导入导出保留。旧设置中的远程和语音字段不再启用；旧工作台布局中的 SSH/穿透面板会被清理，本地面板继续恢复。旧备份可以读取，但不恢复语音配置，新导出不包含语音凭据。

远程服务不再通过当前产品入口注册、启动或作为 sidecar 打包。未注册的旧原生服务目录、部分停用的前端辅助代码和兼容类型仍留在仓库；不宣称所有前端辅助代码均已从 bundle 物理排除。批量递归删除旧模块目录被自动审批拒绝，因此本轮不宣称已物理删除全部相关源码。

## 提示词来源与使用

检查 `wnnz/LiveAgent-custom` 的 revision `4eb6a4a89a5a49ffa0ebcde69f6b0fad373a6ad2`，其默认模板列表为空，没有可直接继承的预置角色库。

从 `msitarzewski/agency-agents`（revision `8ae6164602c95ca78828b148b9052460ee426885`，MIT）内置八个角色：工程协调器、架构设计、后端开发、前端开发、AI 运行时开发、测试工程师、代码审查、构建发布。v2 保留完整英文 Markdown 原文（包括 YAML、章节、示例和代码块），界面名称与简介仍为中文。旧 v1 曾使用中文精简改写，例如架构设计仅 370 个字符；本次修正为完整原文 6,432 个 Unicode 字符。

首次启动合并加入已有模板，不覆盖相同 ID 的内容；默认作为可选子代理角色，未设为全局提示词。v1 升级至 v2 时，仅替换仍与旧预设正文完全一致的正文，保留名称、简介、开关、模型和推理配置；编辑过的正文及已删除项保持原样，版本标记原子持久化。JSON、原始 Markdown、来源路径与 SHA-256 清单、完整 MIT 许可证和版权说明位于 `resources/prompts`，许可证随桌面包分发。

## 开源外观调研

以下仓库 README 与许可证通过 GitHub API 于 2026-11-26 核验；尚未导入代码或改动现有主题。

| 项目 | 许可证 | 适用范围 | 接入判断 |
| --- | --- | --- | --- |
| catppuccin/palette | MIT | 配色主题 | 推荐先做可选主题，将颜色映射到现有背景、文字、边框、主色变量，并检查对比度。 |
| radix-ui/colors | MIT | 明暗配色与色阶 | 适合完善状态色、悬浮态与禁用态；需要定义应用语义变量映射。 |
| shadcn-ui/ui | MIT | React 组件源码 | 可参考设置页与弹窗组件；替换范围比单纯换配色大，不建议整套覆盖现有组件。 |

项目使用 React、Tailwind 和共享组件；建议先增加 Catppuccin 可选配色，保留当前主题。主题变量还应同步覆盖编辑器、终端、浮层和滚动条，随后检查亮/暗模式与窄窗口。

研究记录保存在本地 `.openagent-validation/theme-research.json`；原始项目地址分别为 `https://github.com/catppuccin/palette`、`https://github.com/radix-ui/colors`、`https://github.com/shadcn-ui/ui`。

## 本地预览

唯一用户预览入口为 `target/debug/openAgent.exe`。只运行 `pnpm preview:build` 覆盖此文件，不额外生成安装包或带日期的 EXE。K-brain 与 computer helper 是必需运行时文件，不是额外产品预览版本。

## 前序本地化与设置验证记录

验证平台：Windows，2026-11-26。以下记录对应 17:16 构建；后续子代理状态与完整模板改动的验证见文末。

- GUI 构建与共享 UI TypeScript 检查通过。
- 前端定向回归 112 项通过；另增启动回归 6 项通过，覆盖全部平台窗口配置和工作台重新挂载时默认收起。
- Rust 设置/备份测试 85 项通过；本地主机桥/终端测试 36 项通过、1 项忽略。
- K-brain resources、backend、agent、prompts 定向测试通过；锁定补丁及 sidecar 收据校验通过。
- 打包脚本测试 13 项通过；2 项 Unix 文件权限测试在 Windows 跳过。CI 明确安装 Go 1.27.0，再委托锁定准备脚本构建 K-brain。
- 最终 EXE 完整界面验收连续 3 次通过，包含本地终端、真实桌面经本地 K-brain 调用受控模型响应、8 个内置模板、模板编辑/删除后的后端重启持久化、移除的设置项/原生命令/SSH 路由、本地备份入口、话题按钮对齐、提示词双开关和窄窗口布局。
- 独立应用重启验收通过：测试结束前窗口缩至 700 × 650，再次启动恢复 1159 × 857，工作台保持关闭，删除的预设不再出现、模板修改保留。
- 正常用户启动已打开唯一预览 EXE，原生客户区实测 1159 × 857、96 DPI；未启用调试检查桥接，直接子进程未出现 Gateway，观察到的监听地址均为 127.0.0.1。未读取真实用户对话或供应商凭据。

验收使用隔离数据目录、假供应商凭据及本地 HTTP 模型响应，不产生真实模型调用费用。报告和日志在 `.openagent-validation`，包括 `settings-smoke.json`、`startup-restart-smoke.json`、`normal-preview.json`。

### 验证边界与待观察项

- 首次最终尺寸验收曾在发送对话后 30 秒超时；当时仅观察到乐观用户消息、未发现对应新会话落盘，未定位到确定根因。保留失败隔离目录 `settings-smoke-30QC5K`。后续保留相同断言并增加请求/错误诊断，连续三次完整验收通过；不把未复现写成已修复。
- 未运行全部上游遗留测试、跨平台桌面验收、安装/卸载流程，也未自动操作原生保存文件对话框。本地备份数据往返由 Rust 测试覆盖。
- 原生构建仍有上游/停用兼容代码的 unused 警告，不宣称无警告构建。
- 开源主题仅完成调研，没有擅自替换当前主题。


## 子代理状态与角色证据

工作台输入区上方常驻子代理状态入口，区分当前会话尚未调用、正在运行、已结束、读取中和无法确认。记录覆盖整个当前会话，包含历史调用，不声称全部是当前回合。打开入口可查看当前启用的可选角色、子代理任务、模型、状态、用量与独立会话；支持手动刷新读取失败的记录。

可选角色的开关只是允许模型选择。只有模型实际调用 `subagent` 并选中 `role`，角色正文才应用到该子代理。卡片与详情中的“已应用角色”来自后端在创建子代理时记录的 ID/名称快照。前台事件和后台任务都持久化该快照；模板以后改名或删除，不会改写历史角色记录。旧记录或未选角色的任务显示“未记录角色模板”，不推断已应用。此改动不强制模型启动子代理，也不读取模型内部推理来猜测是否委派。


## 完整模板与子代理状态验证（2026-11-26）

唯一预览 EXE 已覆盖更新：`target/debug/openAgent.exe`，构建时间 18:50:33，大小 86,102,016 字节。GUI、共享 UI 类型检查和桌面原生构建通过；仍有 190 条上游/停用兼容代码的 Rust unused 警告。

- 子代理状态、失败重试、角色元数据合并及 8 份完整原文/来源哈希定向测试：34 项通过。
- 设置归一化与真实 K-brain 提示词读取、保存、模型请求测试：91 项通过，覆盖正文首尾空白和末尾换行保留。
- K-brain agent/resources/backend/prompts 定向测试通过。新增前台、后台子代理的角色证据重启集成测试通过，验证实际子代理请求与角色快照持久化。
- 打包测试 14 项通过，2 项 Unix 权限测试在 Windows 跳过。最终 K-brain 补丁 SHA-256 与锁文件一致，实际 Windows 预览 sidecar 收据校验通过。
- 实际 EXE 验收通过：v1 短正文安全迁移、用户修改/删除/模型选择保留；架构设计编辑器完整显示 6,432 个字符，原样保存后正文逐字符一致。
- 实际桌面通过 K-brain 调用本地受控模型响应，验证常驻“尚未调用”、运行中、已结束状态、角色目录、主对话工具卡和子代理会话。真实子代理模型请求包含完整架构设计 Markdown；角色改名及后端重启后，历史名称仍为创建时的“架构设计”。
- 已检查正常窗口截图及缩窄窗口截图；缩窄后客户区 744 × 691，状态入口仍在可视范围内，子代理面板没有横向溢出。
- 完整应用退出/重启验收通过：启动客户区恢复 1159 × 857，工作台默认收起；完整正文、用户编辑/删除、历史角色名称和子代理会话内容保留。

桌面验收使用隔离目录、假凭据和本地 HTTP 响应，不调用真实付费模型，不读取用户真实对话或供应商凭据。它验证调用链与显示行为，不代表每个模型都会自动选择角色或启动子代理。前台调用完成了实际 EXE 验收；后台角色持久化由 Go 集成测试覆盖。

验收发现编辑器归一化曾删除原文末尾换行，已修正读取和保存逻辑，并在最终 EXE 验证逐字符往返一致。验收脚本的供应商路由、按钮选择器和重启后的会话选择已根据实际接口修正；最终保留相同产品断言并通过。

日志和报告位于 `.openagent-validation`：`subagents-preview-build-final.log`、`subagents-final-tests.log`、`full-prompt-settings-tests.log`、`subagents-go-tests.log`、`subagent-evidence-tests.log`、`subagents-packaging-tests.log`、`subagent-smoke.json`、`subagent-restart-smoke.json`，截图以 `subagent-` 开头。

18:59 已使用正常用户环境打开上述唯一预览 EXE，启动时移除了验收数据目录和调试桥环境变量。原生窗口标题为 openAgent，客户区实测 1159 × 857（96 DPI）；未读取用户数据内容。启动记录为 `.openagent-validation/normal-preview.json`。


## Skills 改名与商店修复（2026-11-26 19:40）

内置代码审查技能改为 `openagent-code-review`，同时更新了资源路径、所有权标记和输入框代码审查动作的查找名称。启动时仅迁移带旧版内置标记的 `liveagent-code-review`：旧目录完整移入 Skills 根目录的 `.backups`，原文件及附加笔记保留。无内置标记的同名用户技能保持原样。K-brain 按新标记识别并保护该内置技能；旧名称的全局/项目选择在读取和保存时映射到新名称，不强制开启原本关闭的技能。

商店空白的实际原因是 K-brain 将空关键词发送至 `/api/v1/search`，该服务返回空 `results`。修复后，无关键词走 `/api/v1/skills` 目录，关键词走 `/api/v1/search`；桌面请求的排序、每页数量、翻页游标和发布者条件传入 K-brain。目录嵌套的版本、统计数据和新版搜索发布者字段已兼容。明确属于其他注册源的搜索条目不传给 ClawHub 安装器。网络错误、HTTP 错误和错误的响应结构按失败返回，不再默认为空列表；商店查询最长 25 秒。

K-brain 改动保存在 `patches/kbrain/openagent-roles.patch`，锁文件 SHA-256 为 `03edd1c587f0f23cdd4c90b1b3465f3eaa604a7c95bab2308c3d31bc9e6fe1b3`。已从锁定 revision 的独立检出应用补丁并构建真实后端，预览配套二进制收据校验通过。

唯一预览仍是 `target/debug/openAgent.exe`，2026-11-26 19:40:33 覆盖构建，大小 86,104,064 字节。没有新增预览副本或安装包。

- 前端 Skills 测试：111 通过、0 失败、1 项需要外部连接文件的可选集成测试跳过；GUI 和共享 UI 类型检查通过。
- 原生 Skills 测试：51 通过，包含旧内置目录备份迁移和用户同名目录保留。
- K-brain `internal/skills` 完整包通过；`TestOpenAgent|TestSkillsHTTP` 定向测试通过，覆盖目录/搜索路由、分页和嵌套字段、HTTP 入口参数传递、错误不伪装为空结果、内置所有权及全局/项目选择迁移。
- 打包回归：13 通过，2 项 Unix 权限场景在 Windows 跳过；真实 Windows 预览布局和哈希校验通过。
- 真实 EXE 验收：隔离目录中旧内置技能无重复迁移，新名称被识别为内置并保持启用，额外笔记在备份中逐字保留。
- 真实商店验收：首页 24 项，翻页后 48 项，星标排序和 `review` 搜索正常，详情完成加载并显示版本、作者、许可证和更新日志。已人工查看截图。未安装第三方技能或调用真实模型。
- 启动客户区仍为 1159 × 857，右侧工作台默认关闭，隔离 EXE 正常退出码 0。

扩大执行的 `internal/backend` 完整包仍有 5 项失败：4 项需要 Windows 创建符号链接权限，1 项上游健康契约仍预期 SSHManager 存在，与本产品此前移除 SSH 的配置不符。本次 Skills 定向测试均通过，未将整个后端包描述为全绿。

证据位于 `.openagent-validation`：`skills-go-tests.log`、`skills-go-focused.log`、`skills-rust-tests.log`、`skills-frontend-tests.log`、`skills-ui-typecheck.log`、`skills-gui-typecheck.log`、`skills-packaging-tests.log`、`skills-packaging-actual.log`、`skills-kbrain-build.log`、`skills-preview-build.log`、`skills-smoke.json`。截图为 `skills-installed.png`、`skills-store-home.png`、`skills-store-search.png`、`skills-store-detail.png`。详情验收等待骨架屏消失，确认完整字段加载后再判定通过。

19:44 已重新打开正常用户环境的唯一预览 EXE，原生窗口标题 openAgent，客户区 1159 × 857（96 DPI），仅一个 openAgent 桌面进程。正常启动移除隔离验收目录与调试桥变量；未读取个人对话或供应商凭据。启动证据：.openagent-validation/normal-preview.json。


## Skills 中文阅读译文（2026-11-26）

技能商店新增“翻译当前结果”，对当前已加载且符合分类筛选的卡片名称/简介生成中文阅读译文。详情页支持翻译名称、简介和更新说明；已安装技能详情支持翻译描述与完整 Markdown 正文。保留原文切换，安装标识、来源链接、权限与实际执行的 SKILL.md 均不改变。非 Markdown 文件和已截断的预览不作为完整正文发送翻译，保留现有原文和截断提示。

模型下拉框来自已启用供应商模型，默认跟随已选模型（无有效选择时使用首个已启用模型）。仅点击翻译按钮才调用 K-brain 既有 `/v1/text/generate`；界面明确说明会将技能说明发送给所选模型、可能产生模型费用。无模型时提示先启用模型。该接口无 agent 会话和工具调用，本次没有修改 K-brain 后端、补丁或锁文件。

译文使用独立的本地缓存，按提示词版本、目标中文语言、供应商、模型和原文 SHA-256 区分；原文/模型变化后不会复用旧译文。缓存上限 200 条、序列化长度 100 万字符，不保存模型密钥。长文按最多约 1400 个 Unicode 字符分段，优先完整行；代码围栏原样保留，行内代码/URL 使用占位符保护。JSON 分段响应必须完整、逐段匹配并保留保护标记后才显示和缓存该条目；不会用部分长文代替完整正文。支持停止、错误保留原文和重试，页面/模型/内容变化会取消旧请求。

代码：`SkillTranslation.tsx`、`skillTranslationService.ts`、`kbrainSkills.ts`，以及 Skills 商店/已安装详情展示。翻译由 AI 生成，应保留原文核对；结构完整校验不能替代译文准确性判断。

验证：Skills 测试共 122 项，121 通过，1 项需手动启用的联网集成测试跳过；包含 10 项新增翻译行为/HTTP 边界测试。共享 UI 与桌面类型检查、UI 层边界检查通过。详细日志为 `.openagent-validation/skills-translation-suite.log`、`skills-translation-tests.log`、`skills-translation-ui-typecheck.log`、`skills-translation-gui-typecheck.log`、`skills-translation-boundaries.log`。


最终本地预览于 2026-11-26 20:19:41 构建成功，仍为 `target/debug/openAgent.exe`（86,108,160 字节）；Windows 配套 K-brain 打包收据校验通过。构建保留 190 项既有 Rust 未使用项警告，未生成安装包或额外命名的 EXE。

最终实际 EXE 隔离验收通过（`skills-translation-smoke.json`，退出码 0）：未点击时无模型请求；无模型时提示配置；24 条商店结果的译文与原文切换，技能标识保持原样；6,686 字符测试文件的描述、100 步正文、代码块和末尾要求完整显示，长文使用 6 次分段请求；切换/重开/重载界面复用持久缓存；不完整输出保留原文，停止后不接收迟到结果，重试成功；技能原文件逐字符一致。验收调用真实 K-brain 和本地受控模型响应，仅验证调用与 UI 行为，不代表真实供应商的翻译质量。未读取正常用户的对话或供应商凭据。

已检查 `skills-translation-store.png`、`skills-translation-installed.png`、`skills-translation-installed-end.png`、`skills-translation-detail.png`；正文末尾代码块滚动进入可视区域后完整显示。商店截图中的“中文简介验收”是隔离模型的固定测试文本，不是写入产品的翻译。验收脚本已修正首次引导、带计数的页签选择及代码块可见时机；最终完整断言通过。脚本与日志位于 `.openagent-validation/skills-translation-smoke.mjs`、`skills-translation-smoke-run.log`、`skills-translation-preview-build.log`、`skills-translation-packaging.log`。

## MCP 中文翻译与插件商店（2026-11-26）

MCP 中心的官方目录改为中文界面，商店列表和详情支持选择模型后翻译名称、简介、配置说明与警告，并可切换原文。Skills、MCP 和插件商店共用资源翻译组件，沿用原有本机译文缓存。翻译只在点击后通过 K-brain 既有 `/v1/text/generate` 发起；不修改 MCP 连接参数、插件标识、安装清单或实际执行文件。无可用模型、失败、取消和不完整响应保留原文。模型翻译可能产生费用，译文质量需结合原文判断。

设置 → 插件新增“已安装 / 插件商店”。商店通过 GitHub 公开仓库查询支持关键词、`owner/repo` 和仓库地址，目录按 `k-brain-plugin`、`liveagent-plugin`、`openagent-plugin` 三个标签分别检索并合并。搜索结果是候选仓库，详情读取固定提交下的真实 `plugin.json` 并确认 K-brain 格式及工具、提示词、钩子或面板贡献后，才提供安装。此次检索没有找到公开兼容目录条目；界面显示真实空状态，不添加测试插件或伪造市场数据。Claude Code、VS Code 等其他应用的插件不能直接视为兼容插件。

K-brain 增加 `/v1/plugins/store/search`、`/v1/plugins/store/detail`、`/v1/plugins/store/install`，仍使用现有鉴权和插件管理器。安装固定提交中的选定插件子目录，校验 ID、路径、包体积和文件数量，拒绝目录穿越、符号链接、特殊文件与大小写冲突，不覆盖同名插件，不执行安装脚本。新插件始终默认关闭，可在“已安装”中启用；需要的 Node.js、Python 等环境依赖按插件说明准备。

累积补丁仍位于 `patches/kbrain/openagent-roles.patch`，源 revision 为 `02cd80037809790478281e986a2d3b1004737c32`，SHA-256 为 `308dc923302800e9f414b21b0d938dded8f4bedfce90ddc694fe875ee5769671`，与锁文件一致。保留此前角色、Skills、本地化和移除远程能力的改动。

唯一预览 `target/debug/openAgent.exe` 已于 2026-11-26 21:04:48 覆盖构建，大小 86,116,352 字节；K-brain 打包收据验证通过，未生成额外预览版本或安装包。Rust 构建仍有 190 项既有未使用项警告。

验证结果：

- 前端相关回归共 212 项：211 通过、1 项可选联网测试跳过；另有插件商店解析/HTTP 边界测试 4 项、标签与翻译检查 14 项、角色/MCP 回归 10 项通过。共享 UI 和桌面类型检查、UI 边界检查及改动文件格式检查通过。
- K-brain 新增商店的 8 项顶层测试及归档安全子用例通过，`internal/plugins` 完整包通过。归档下载、固定提交安装和非法包拒绝由受控 HTTP 的 Go 集成测试验证。扩大执行的既有 `TestPlugin` 测试仍有两项依赖 Windows 符号链接权限而失败：`TestPluginPanelErrorsAreReported`、`TestPluginPanelAssetsServeSandboxed`；不宣称全部后端测试通过。
- 最终真实 EXE 隔离验收通过：公开官方 MCP 目录 15 张卡片完成翻译与原文切换，详情复用缓存，MCP 配置保持一致；公开 GitHub 仓库搜索和兼容性检查通过。
- 插件安装界面验收使用隔离测试目录及测试商店响应，断言精确提交、目录与插件 ID，并通过原有真实本地安装接口落盘。验证默认关闭、启用/停用、安装元数据未变及面板初始化和实际显示。追加面板验收等待 `host.initialize` 成功后截图，确认显示测试面板标题。没有将该测试描述为安装真实公开第三方插件；新的归档安装接口另由 Go 集成测试覆盖。
- 翻译验收使用真实 K-brain 和本地受控模型，不调用付费供应商，不评价模型翻译质量。启动客户区仍为 1159 × 857，右侧工作台默认收起，验收进程正常退出码 0；不读取正常用户的对话或供应商凭据。

证据位于 `.openagent-validation`：`mcp-plugin-frontend-tests.log`、`mcp-plugin-backend-tests.log`、`mcp-plugin-manifest-tests.log`、`mcp-plugin-roles-mcp-tests.log`、`mcp-plugin-ui-typecheck.log`、`mcp-plugin-gui-typecheck.log`、`mcp-plugin-boundaries.log`、`mcp-plugin-preview-final-build.log`、`mcp-plugin-packaging.log`、`mcp-plugin-smoke.json`、`mcp-plugin-panel-smoke.json`。已查看 MCP 列表/详情、插件商店/详情及实际插件面板截图。
## 取消插件商店与主题调研（2026-11-26）

按最新产品要求取消插件商店。移除设置中的商店页签/页面、专用翻译文案、客户端商店类型与 HTTP 适配，以及 K-brain 的搜索、详情、下载/归档安装接口和专用测试。保留原有本地文件夹安装、已安装列表、启停、卸载、重新加载、工作区信任与沙盒面板。Skills 和 MCP 商店及共用的中文翻译保持有效。此前“MCP 中文翻译与插件商店”小节是历史记录，其中新增商店的描述已被本节取代。

已重新生成累积 K-brain 补丁并验证锁文件，SHA-256 为 `03edd1c587f0f23cdd4c90b1b3465f3eaa604a7c95bab2308c3d31bc9e6fe1b3`；与引入商店前的补丁一致，先前角色、Skills 与本地产品范围改动均保留。构建脚本从锁定提交独立检出并应用补丁后生成配套后端。

唯一预览仍为 `target/debug/openAgent.exe`，本次于 2026-11-26 21:30:18 覆盖构建，大小 86,112,256 字节；未生成安装包或额外预览副本。K-brain 打包收据校验通过。构建仍报告既有的 190 项 Rust 未使用项警告。

验证结果：

- 前端定向回归 202 项：201 通过、1 项可选联网测试跳过，覆盖插件/MCP 沙盒、Skills 中文翻译、MCP 设置和样式；UI 与桌面 TypeScript 检查、UI 边界检查通过。
- K-brain `internal/plugins` 完整包通过；本次不重复扩大执行此前依赖 Windows 符号链接权限的后端测试。
- 真实 EXE 隔离验收通过：插件商店入口和搜索框不存在，前端无商店请求；带鉴权的 search/detail/install 商店路径均返回 404。测试插件通过真实本地安装接口落盘，验证默认关闭、启用、停用、卸载、元数据不变、面板初始化并显示内容，人工核对截图。
- MCP 商店和翻译控件继续存在；本次验收未调用任何模型。初始窗口仍为 1159 × 857，右侧工作台关闭，验收进程正常退出码 0，未操作正常用户的个人对话或凭据。
- 验收脚本修正了设置按钮渲染等待和含 Esc 提示的返回按钮选择方式；没有为测试导航调整产品代码。

证据位于 `.openagent-validation`：`remove-plugin-store-frontend.log`、`remove-plugin-store-go-tests.log`、`remove-plugin-store-ui.log`、`remove-plugin-store-gui.log`、`remove-plugin-store-boundaries.log`、`remove-plugin-store-kbrain-build.log`、`remove-plugin-store-preview-build.log`、`remove-plugin-store-packaging.log`、`remove-plugin-store-smoke.json`。截图：`remove-plugin-store-empty.png`、`remove-plugin-store-local-panel.png`。

开源主题本轮完成 Catppuccin、Rosé Pine、Nord 的官方配色与 MIT 许可证核验，以及现有 CSS、终端、编辑器和沙盒主题同步的接入分析。建议优先内置 Catppuccin Latte/Mocha，并保留独立的浅色/深色/跟随系统选项。尚未改动当前主题或引入主题依赖，详见 `OPENAGENT_THEME_RESEARCH.md`。

## 独立配色主题与明暗模式（2026-11-26）

按用户确认的方案完成主题设置，取代上一节“尚未改动当前主题”的历史状态。入口为“设置 → 系统设置 → 通用”：配色主题提供“openAgent 默认 / Catppuccin”，明暗模式独立提供“浅色 / 深色 / 自动”。Catppuccin 的浅色使用 Latte、深色使用 Mocha；自动模式跟随系统。旧配置继续使用原有配色，新选择即时生效并保存在本机，关闭应用后仍保留。现有配置备份不导出本地 UI 偏好，导入配置保留当前本地主题。

适配范围包含主界面、设置、聊天与工具卡片、差异视图、终端、Monaco 编辑器、Markdown 代码高亮、Mermaid 和沙盒插件/MCP 面板。主题变化更新已有终端与编辑器实例，保留会话、内容和撤销记录。同一明暗模式内切换配色也会通知已有沙盒面板。Markdown 同步配置高亮插件的 getThemes，因为当前 Streamdown 优先采用该配置；继续复用已有高亮缓存与并发队列。

官方 Catppuccin palette 1.8.0 固定提交 `07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd` 的 Latte/Mocha 配色内置于前端；MIT 许可证随应用资源分发。未添加运行时依赖，未修改 K-brain 后端。配色来源及生成方式见 `OPENAGENT_THEME_RESEARCH.md` 和 `crates/agent-ui/src/lib/appearance/README.md`。

唯一预览仍为 `target/debug/openAgent.exe`，最终于 2026-11-26 22:30:50 覆盖构建，大小 86,116,352 字节；未生成安装包或另一个预览 EXE。构建成功，仍报告 190 项既有 Rust 未使用项等警告。

验证结果：

- 定向测试 93/93 通过，覆盖配置兼容、保存、主题初始化、系统跟随、文字对比度、设置搜索、终端变量、编辑器连续性、Mermaid 和插件/MCP 面板通知。最后的 Markdown 高亮修正追加运行 17/17 回归通过，其中包含新增的真实 Streamdown 挂载测试；两次运行有重叠用例，不合计为 110 项独立测试。
- 共享 UI 与桌面 TypeScript 检查、UI 边界检查以及最后改动文件的 Biome 检查通过。
- 扩大回归 821 项中 818 通过、3 项失败：`settings/gateway-settings-sync-acks-app.test.mjs`、`settings/gateway-settings-sync-acks.test.mjs`、`settings/stt-settings.test.mjs` 仍断言此前按用户要求移除的 Gateway 同步和语音输入功能。本轮未恢复这些功能，也不宣称扩大回归全部通过。
- 最终真实 EXE 隔离验收通过：Latte/Mocha 和默认浅深色切换、保存、WebView 重载，以及通过受控系统偏好事件验证自动模式的浅深切换；不修改宿主 Windows 的主题设置。
- 真实本地插件面板在同一深色模式下收到默认配色与 Catppuccin 的切换通知，iframe 保持不变。真实终端渲染背景即时更新，DOM、会话 ID 和已有回显保持不变。
- 完全退出 EXE 后使用同一隔离配置重新启动，通过主题与明暗模式的恢复检查；初始窗口仍为 1159 × 857，右侧工作台默认收起。两次原生验收均正常退出码 0；使用真实 K-brain、独立测试配置，无模型调用，不读取正常用户对话或供应商凭据。
- 已核对浅色/深色设置、插件面板和工作台终端截图。原生验收完成后重新打开正常用户配置下的同一个预览 EXE。

证据位于 `.openagent-validation`：`theme-preview-build.log`、`theme-targeted-final.log`、`theme-markdown-regression.log`、`theme-tests-final.log`、`theme-ui-types.log`、`theme-gui-types.log`、`theme-boundaries.log`、`theme-final-biome.log`、`theme-smoke.json`、`theme-restart-smoke.json`。截图：`theme-latte-settings.png`、`theme-mocha-settings.png`、`theme-mocha-plugin.png`、`theme-mocha-workbench.png`。

## Falcon 多主题下拉选择与原生验收（2026-11-26）

按用户修正后的需求，将系统设置 → 通用里的配色切换改为“系统主题”可搜索下拉框。提供 28 款 Falcon 主题，保留 openAgent 默认和 Catppuccin，共 30 个选项；每项附中文名称、浅深标识及三色预览。Falcon 包含浅绿、高对比绿、青瓷、豆绿、浅灰、樱粉、暖黄、米杏，以及经典深色、Darcula、深青绿、深海蓝、暗紫、暖咖啡；各有 Classic 与 Islands 版本。

主题从 `panxiaoan/falcon-jetbrains-themes` 的固定提交 `c3ddba2d8c71137e5191033df8e882b2936f8f7d` 转换，保留上游完整 MIT 许可证。接入 UI JSON 与 XML 编辑器/控制台配色，转换为 openAgent CSS、Monaco、Shiki、终端、Mermaid、差异视图及插件/MCP 面板可用的颜色。Islands 使用上游独立外框色，不复制 JetBrains 布局引擎。背景和强调色来自上游，部分正文/状态/语法文字进行对比度调整。来源文件 SHA-256 和生成脚本已保存；生成脚本拒绝与固定来源清单不符的数据。本次未修改 K-brain，未增加主题运行时依赖或网络请求。

Falcon 每款自带固定明暗，选中即同步保存对应模式，启动与主界面的解析一致。主题行下方显示实际明暗及说明。默认/Catppuccin 仍提供浅色、深色、自动；固定主题下通过托盘/工具栏明暗入口打开系统设置选择其他主题。主题存于本地 UI 偏好，配置备份行为保持原有约定。

唯一预览 `target/debug/openAgent.exe` 于 2026-11-26 23:30:09 覆盖构建，86,140,928 字节，无额外预览副本或安装包。构建成功，190 项既有 Rust 警告仍存在。源许可证和构建资源的 SHA-256 一致：`4B93BD5E6DDB2877294509C6FFB1CA3E4F7D7965C66A984361479FBB0D9C09C0`。

验证结果：

- 119/119 定向测试通过，包括全部 28 个主题的合法 ID、固定明暗、启动恢复、正文对比度和终端颜色，真实 Shiki 自定义主题渲染，保存不写后端，设置搜索，以及已挂载编辑器/Markdown/Mermaid/沙盒的切换连续性。
- UI、桌面与 Node 配置的 TypeScript 检查和 UI 边界检查通过。改动文件 Biome 检查通过，仅保留 App.tsx 原有无效 suppression 注释警告。首轮测试的高亮双色返回格式断言已修正，并保留旧英文“color theme”搜索词兼容；最终同一组测试全绿。
- 最终真实 EXE 使用隔离测试配置，逐个从下拉框选择全部 28 个 Falcon 主题，核对实际背景/侧栏颜色、明暗和保存值。下拉总数 30，中文“咖啡”搜索得到 Classic/Islands 两项。恢复默认及 Catppuccin 浅/深切换通过。
- 同一深色下暖咖啡/暗紫切换时，已有真实插件 iframe 收到颜色通知且未重建；真实终端渲染颜色更新，DOM、会话 ID、已有输出保持不变。
- WebView 重载和 EXE 完整退出后重启均恢复暖咖啡主题；窗口仍为 1159 × 857，右侧工作台初始收起。两次原生验收均正常退出码 0，模型调用为 0；未读取正常用户对话或供应商凭据。
- 人工核对下拉框、暖咖啡、暗紫和 Islands 樱粉截图。完成后重新打开正常配置下的同一个本地预览。

本轮未重复扩大运行此前 821 项回归；上一节记录的 3 个已移除 Gateway/语音功能旧测试失败仍是历史已知项，不宣称全仓测试通过。

证据：`.openagent-validation/falcon-targeted.log`、`falcon-ui-types.log`、`falcon-gui-types.log`、`falcon-boundaries.log`、`falcon-biome.log`、`falcon-preview-build.log`、`falcon-smoke.json`、`falcon-restart-smoke.json`。截图：`falcon-theme-dropdown.png`、`falcon-theme-search.png`、`falcon-dark-coffee-settings.png`、`falcon-dark-violet-settings.png`、`falcon-islands-green-settings.png`、`falcon-islands-pink-settings.png`、`falcon-coffee-plugin.png`、`falcon-coffee-workbench.png`。


## AnyRouter 模型发现与供应商代理（2026-11-27）

现场复现：本机直连 `anyrouter.top` 在 TLS 握手阶段失败；Windows/应用代理均为已启用的本地 HTTP 代理。K-brain 同一密钥、同一 `/v1/models` 地址，`useSystemProxy=false` 返回 `unreachable`，`true` 返回 18 个模型。裸域名也已具备 `/v1/models` 回退，无需修改 K-brain 或伪造模型列表。CC Switch 上游模型发现通过其全局 HTTP 客户端执行；其代理配置会改变请求路由，与 openAgent 供应商默认直连的行为不同。

修正：设置页和首次引导新增供应商时，默认跟随当前应用代理是否已开启；编辑已有供应商继续保留其保存的路由，旧条目缺省仍为直连。将“使用应用代理”从高级设置移到 API Key 下方，显示当前路由及应用代理未启用的提示；切换后自动重新获取模型，保存后对话也使用同一路由。连接失败提示增加代理排查说明。没有改动 K-brain 网络隔离、自动切换代理或认证规则。

建议配置：OpenAI 兼容供应商 Base URL 使用 `https://anyrouter.top/v1`，完整 URL 开关关闭，启用“使用应用代理”，并确保系统设置中的应用代理已配置且可用。本次验证仅调用模型列表，未验证该服务的具体模型是否支持 Responses 或 Chat Completions，也未产生对话调用。

验证记录位于 `.openagent-validation/anyrouter-*`；提供的真实密钥仅通过内存/标准输入参与临时发现请求，没有保存为供应商或写入验证脚本、文档和测试夹具。只覆盖现有 `target/debug/openAgent.exe`。


验收完成：针对性供应商回归 24/24、首次引导 3/3；UI/GUI TypeScript、界面边界检查、六个改动 TS/TSX 文件的 Biome 检查通过。实际 EXE 隔离验收为 200/18 模型 → 关闭代理后 502/unreachable → 开启后 200/18 模型；裸域名回退也为 200/18 模型。截图为 `.openagent-validation/anyrouter-models.png`，记录为 `anyrouter-smoke.json`。启动为 1159 × 857，右侧工作台保持折叠。预览构建成功（仍有此前的 190 条 Rust 警告），已重新打开正常用户配置的同一个 EXE。


## 内置 Hooks 与完整开发 Skills（2026-11-27）

设置 → Hooks 新增“我的 Hooks / 内置预设 · 5”。预设为任务结束提示音、Git 改动格式检查、项目类型检查、项目 Lint 检查、项目 CI 测试。每项展示来源，打开完整可编辑脚本后保存，默认关闭；支持原有编辑、开关与删除，稳定 ID 阻止重复添加，删除后可重新添加。已有自定义 Hook 保留。生命周期名称中文化。

新增 16 个开发 Skills，连同原有代码审查、技能编写、技能安装共 19 个。覆盖全流程导航、计划、架构、API、后端、前端、React 性能、PostgreSQL、数据库迁移、TDD、排错、Web E2E、安全、系统性能、CI/CD、Docker。来源为 everything-claude-code、Superpowers、Anthropic Skills、Supabase Agent Skills；全流程导航为 openAgent 原创。15 个来源技能保留完整正文、80 份原始来源文件、固定提交、哈希及许可证，附加中文流程和宿主适配。详见 `docs/OPENAGENT_BUILTIN_DEVELOPMENT.md` 与 `prompt/skills/catalog.json`。

兼容处理：Supabase 的 CHANGELOG.md 仅重命名为 upstream/history.md；3 个 Web 测试 Python 示例增加 shebang，同时以 .py.txt 保留逐字原文件及校验值。没有放宽宿主技能校验。Rust 嵌入和 K-brain 内置白名单同步，只有精确所有权标记的内置技能受到保护；同名用户技能保留，升级备份原内容，不重置技能选择。来源更新通过本地目录与生成脚本完成，运行时无需下载。

仅覆盖 `target/debug/openAgent.exe`，2026-11-27 11:27:23 构建完成，86,657,536 字节；未额外生成预览副本或安装包。K-brain 从固定版本应用累计补丁后重建成功，补丁 SHA-256 为 `2e35a6ed2c12a8851e5f4970cc2e0c5518af1496c2be5a8a00607797de3b70b2`。构建仍有原有 190 条 Rust 警告。

验证结果：

- 60/60 定向前端与脚本回归通过，最终兼容修正后 Hooks/Skills 24/24 再次通过。真实 PowerShell 检查覆盖成功、失败、跳过、缺工作区、中文/引号路径、暂存与未暂存 Git 改动，以及不回退监听测试命令。
- Rust 内置播种与保护定向测试 13/13；16 个新增技能的 quick_validate 全部通过；80 份原始文件哈希及嵌入列表检查通过。
- K-brain 技能与 Hook 定向测试通过；UI/GUI TypeScript、UI 边界、6 个改动 TS/TSX 文件的 Biome、改动文件 diff hygiene 通过。
- 实际 EXE 隔离验收：19 个技能无无效条目，16 个新增技能均识别为内置，正文与打包文件逐字一致且没有截断；Postgres 支持文件可读，重复播种保持不变。
- 5 个预设均可查看全文、添加且默认关闭，重复按钮禁用；改名与启停正确保存，删除后允许重加，自定义 Hook 保留。技能列表与架构全文预览正确显示。已人工查看预设、已添加列表、Skills 列表及全文预览截图。
- 完整退出后重新打开同一隔离配置，19 个技能、选择状态、Hook 关闭状态和删除结果保持。原有 skills-creator/skills-installer 的系统固定启用行为保留。两轮最终原生验收正常退出码 0，模型调用为 0。
- 两次启动均为 1159 × 857，右侧工作台初始收起。验收不读取正常用户对话或供应商凭据。

边界：预设检查主要面向 JS/TS 项目的已有命令，其他技术栈需要编辑脚本；结果保存在本机 hook-reports 并沿用 Hook 失败警告，不自动要求模型修复、不作为强制发布门禁。技能是可按阶段加载的工作指引，不自动启动子代理或发布生产环境。本次未执行真实项目上线、付费模型流程或全仓测试。

证据：`.openagent-validation/builtin-targeted.log`、`builtin-final-targeted.log`、`builtin-rust-tests.log`、`builtin-skill-validation.log`、`builtin-kbrain-tests.log`、`builtin-kbrain-build.log`、`builtin-ui-types.log`、`builtin-gui-types.log`、`builtin-boundaries.log`、`builtin-biome-final.log`、`builtin-preview-build.log`、`builtin-smoke.json`、`builtin-restart-smoke.json`。截图为 `builtin-hook-presets.png`、`builtin-hook-editor.png`、`builtin-hooks-installed.png`、`builtin-skills-list.png`、`builtin-skill-preview.png`。

验收后已重新打开正常用户配置下的同一个预览 EXE，确认窗口标题为 openAgent，K-brain 启动正常，启动日志未发现技能播种错误。
