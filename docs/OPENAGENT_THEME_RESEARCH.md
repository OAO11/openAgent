# openAgent 开源主题接入调研

核验日期：2026-11-26。范围：检查现有桌面主题代码，直接获取下列官方 GitHub 仓库的配色、README 与许可证。后续已按用户确认的方案接入 openAgent 默认 / Catppuccin 两组配色，明暗模式保持独立。Catppuccin 当前提供 Latte / Mocha，未增加运行时依赖。其他主题仍为备选调研。

## 可采用的配色

| 项目 | 配色与风格 | 对 openAgent 的适配判断 |
| --- | --- | --- |
| Catppuccin | Latte 浅色；Frappé、Macchiato、Mocha 深色。柔和的彩色强调色，背景和文字色阶齐全。 | 优先推荐。先接 Latte + Mocha，作为一对跟随系统切换的方案；其他深色变体可随后加入。官方 palette.json 包含颜色名、HEX、RGB、HSL 等值，适合映射现有 CSS 变量。 |
| Rosé Pine | Dawn 浅色；Main、Moon 深色。偏暖、带玫瑰紫色调。 | 可作为第二组可选主题。官方提供按 base、surface、overlay、text 等角色命名的颜色，以及 CSS/Tailwind 用法。 |
| Nord | 16 色基础色板，包含 Polar Night、Snow Storm、Frost、Aurora 四组。蓝灰背景与青蓝强调色。 | 可作为冷色风格备选。它提供基础色板，完整的浅/深界面层级与状态色仍需在 openAgent 中定义；建议先适配深色。 |

三者当前核验的许可证均为 MIT。若后续导入配色资源，应一起保留原版权和完整许可证。这里只核验这些指定仓库，不将相关社区主题或商业版本一概视为同一许可。

官方来源与本次核验提交：

- Catppuccin：`https://github.com/catppuccin/palette`，提交 `07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd`；文件 `palette.json`、`README.md`、`LICENSE`。
- Rosé Pine：`https://github.com/rose-pine/palette`，提交 `92af52b465ab6e47437aca223c9b8d3009a2023b`；文件 `palette.json`、`README.md`、`LICENSE`。
- Nord：`https://github.com/nordtheme/nord`，提交 `1cef71605416a222e57225b544540ce0fcec18d4`；文件 `src/nord.css`、`src/nord.scss`、`readme.md`、`license`。

本地原始研究证据在 `.openagent-validation/theme-research-current`，含官方响应、精确提交、配色及许可证。GitHub API 返回的许可标识已与实际许可文本交叉检查。

## 现有代码与接入方式

初次调研时的主题类型在 `crates/agent-ui/src/lib/settings/types.ts`，为 light、dark、system；`themeAndMemory.ts` 处理跟随系统和旧值归一化。桌面 `crates/agent-gui/src/App.tsx` 通过根节点 dark class 切换，设置入口在 `SystemSettingsForm.tsx`。

`crates/agent-ui/src/styles/tokens.css` 和 `semantic-colors.css` 已集中定义背景、文字、边框、浮层和状态颜色，适合新增配色预设。建议保留原有“浅色 / 深色 / 跟随系统”，另加“配色主题：openAgent 默认 / Catppuccin / Rosé Pine / Nord”，避免将明暗模式与配色名称混在同一枚举。第一步可以只加入默认与 Catppuccin，用 Latte/Mocha 对应浅/深模式。

完整接入应覆盖：

1. 主窗口、设置、侧边栏、工作台、表单、菜单、选中/悬停/焦点与禁用状态；检查中文小字号和状态色的可读性。
2. 终端 `lib/terminal/theme.ts` 的 ANSI 与选区颜色，并让现存终端响应同一明暗模式下的配色变更。
3. 编辑器 `WorkspaceCodeEditorOverlay.tsx` 目前只选 Monaco 的 vs/vs-dark；需注册并切换对应编辑器主题。Markdown 代码、diff 和 Mermaid 也需要统一检查。
4. 沙盒插件/MCP 页面 `lib/sandboxed-ui/theme.ts` 已读取宿主 CSS 变量，但强调色仍读取既定蓝色 token，观察器只关注明暗变化；需支持配色变更通知和新的强调色映射。
5. 设置持久化、启动前的主题应用、恢复备份、旧版本缺失字段的默认值，以及跟随系统模式下的切换验证。

这是桌面层的配色与设置工作，预计不需要增加独立后端，也不依赖插件商店。具体工作量取决于要同时覆盖的主题数量与编辑器等内嵌组件范围，不在调研阶段承诺未经验证的工期。


## 第一阶段记录：默认与 Catppuccin

设置 → 系统设置 → 通用中提供独立的“配色主题”和“明暗模式”。配色为 openAgent 默认 / Catppuccin，明暗为浅色 / 深色 / 自动；自动跟随操作系统，不改变系统设置。托盘原有明暗切换继续工作，且不改变所选配色。

- `AppSettings.colorTheme` 与 `theme` 分开；缺失或非法配色回退到默认。保存在本机 `liveagent.ui-settings.v1`，主题编辑不向 K-brain 写入。当前配置备份不打包这类本机 UI 偏好，导入后仍使用本机主题。
- 启动 HTML 先应用保存的配色和明暗，React 接管系统变化监听。主窗口用 `data-color-theme` 与 `.dark` 驱动同一套语义颜色。
- Latte/Mocha 的原始 HEX 数据固定在 `src/lib/appearance/catppuccin.json`。`scripts/generate-catppuccin-theme.mjs` 生成语义 CSS 和终端 ANSI 配色；浅色状态文字额外加深以达到正常字号文字 4.5:1 对比度。
- Monaco 注册两套主题，保留已有编辑器、模型、未保存内容和撤销栈；终端更新已有实例的选项；Markdown 复用现有 Shiki 内置 Catppuccin，Mermaid 使用适配后的主题变量，diff 使用统一表面和增删颜色。
- 统一观察根节点配色和明暗；插件及 MCP iframe 接收主题通知，页面不重载。页面内部是否采用通知颜色仍由该插件/MCP 页面的实现决定。
- 完整 MIT 许可随前端资源打包到 `third-party/catppuccin-LICENSE.txt`，版权和精确来源见 `crates/agent-ui/src/lib/appearance/README.md`。

实际构建、回归及原生窗口验收见 `OPENAGENT_LOCAL_DESKTOP.md` 的“独立配色主题与明暗模式”。

## 当前实施：Falcon 多主题下拉选择（2026-11-26）

用户进一步明确需要多种可直接选择的视觉风格。系统设置 → 通用中的主题行现为“系统主题”，使用可搜索的下拉列表，提供 28 款 Falcon 配色，加上 openAgent 默认和 Catppuccin 共 30 个选项。每项显示中文名称、明暗标识和背景/外框/强调色预览。

已核验并固定来源 `panxiaoan/falcon-jetbrains-themes` 提交 `c3ddba2d8c71137e5191033df8e882b2936f8f7d`，采用其完整 MIT 许可证。浅色包含浅绿、高对比绿、青瓷、豆绿、浅灰、樱粉、暖黄、米杏；深色包含经典深色、Darcula、深青绿、深海蓝、暗紫、暖咖啡。上述 14 种均有 Classic 与 Islands 两个版本，总计 28 项。该来源当前没有名为赛博朋克的主题。

JetBrains 插件格式不能作为 openAgent 插件直接加载。本次转换上游 `.theme.json` 与 XML 编辑器配色，映射到现有桌面布局、终端、Monaco、代码高亮、差异视图、Mermaid 与沙盒主题通知。Islands 的外框/侧栏颜色使用其独立 mainBackground，未引入 JetBrains 的布局引擎。颜色无需联网下载；源文件清单与 SHA-256、生成脚本和许可证均保留。

Falcon 每项保留原有浅色或深色风格，选中即同步应用并保存对应明暗，固定主题下不再显示可导致配色冲突的明暗切换按钮。托盘/工具栏的明暗快捷入口在固定主题下打开系统设置供选择；默认与 Catppuccin 保留浅/深/跟随系统。切换采用已有主题通知通道，不重建终端会话或编辑器模型。完整验收结果见 `OPENAGENT_LOCAL_DESKTOP.md` 最新小节。
