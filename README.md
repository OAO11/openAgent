# openAgent

![openAgent](resources/branding/openagent-logo.png)

基于 LiveAgent 桌面端和 K-brain 本地后端的 Windows Agent 工作台。当前正式版本：**v0.1.0**。

## 安装和更新

从本仓库 Releases 下载 `openAgent-v0.1.0-Windows-x64-Setup.exe`，安装到当前用户可写的目录，例如 `D:\software\openAgent`。

- 安装包包含桌面程序、K-brain 和本机操作辅助程序；使用系统 WebView2，缺少时安装程序会联网安装运行时。
- 正式版数据位于 **`<安装目录>\data`**，包括聊天、设置、Skills、记忆、界面缓存和检查报告。
- 原地安装/更新保留 `data`；卸载默认保留，只有明确选择“删除应用数据”才删除。
- 应用从 `OAO11/openAgent` Releases 检查更新，用 openAgent 专用公钥验证安装包。
- 安装包尚未配置 Windows Authenticode 发布者证书；更新验证签名与 Windows 发布者证书是两种不同机制。

开发预览仍使用 `%USERPROFILE%\.openagent`，与正式版隔离；不会自动读取或搬移旧版及 LiveAgent 用户数据。已有内容可通过应用备份/导入迁移。

## 产品范围

- 本机工作区、话题、模型供应商、工具审批、会话与记忆。
- 可选择的外观主题，中文 Skills/MCP 浏览与翻译，内置开发流程 Skills 和 Hook 预设。
- 工作区与子代理角色提示词，完整原始模板内容及来源记录。
- 初始窗口 1159 × 857，右侧工作台默认收起，关闭窗口可保留到系统托盘。

不提供远程控制、SSH、WebUI、云同步或插件商店。桌面直接使用 K-brain，不另建产品后端。部分上游兼容代码和包名保留用于后续维护，不代表产品对外开放这些功能。

## 本地开发

工具：Windows x64、Go 1.27.0、Rust/MSVC、Node.js、pnpm 10.32.1、protoc，以及 C++ Build Tools、WebView2、libclang。`LIBCLANG_PATH` 指向包含 `libclang.dll` 的目录。

```powershell
npx.cmd --yes pnpm@10.32.1 install --frozen-lockfile --filter openagent-workspace --filter liveagent...
npx.cmd --yes pnpm@10.32.1 dev
```

首次构建会从锁定的 K-brain 提交应用产品补丁并编译本地制品；上游版本、补丁摘要、产物摘要均会校验。代码位于 `patches/kbrain`，锁文件为 `scripts/release/kbrain.lock.json`。

```powershell
# 更新唯一的本地预览版本，不生成安装包
npx.cmd --yes pnpm@10.32.1 preview:build
.\target\debug\openAgent.exe
# 检查
npx.cmd --yes pnpm@10.32.1 typecheck:ui
npx.cmd --yes pnpm@10.32.1 typecheck:gui
npx.cmd --yes pnpm@10.32.1 check:ui-boundaries
npx.cmd --yes pnpm@10.32.1 check:source-scope
node scripts/generate-builtin-skills.mjs --check
cargo test -p liveagent --lib openagent --locked
```

请保留同目录的 `k-brain.exe`、`k-brain-computer.exe` 及资源。不要把 `data`、用户配置、API Key、签名私钥、`target`、`node_modules` 或构建缓存提交到 Git。

## 发布

详见 [Windows 安装与更新](docs/OPENAGENT_RELEASE.md)。本地构建：

```powershell
.\scripts\release\build-windows.ps1 -Tag v0.1.0 `
  -SigningKeyPath '<仓库外的私钥路径>' `
  -SigningPasswordPath '<仓库外的密码文件路径>'
```

产物位于 `dist/releases/<tag>`：Setup、`.sig`、`latest.json` 和 `SHA256SUMS.txt`。GitHub Actions 的 **openAgent Windows Release** 可对已推送的标签手动构建并发布；签名凭据仅通过仓库 Secrets 提供。

## 来源和许可

- LiveAgent：MIT；保留根目录 `LICENSE` 及 `docs/upstream` 中的上游说明。
- K-brain：Apache-2.0；见 `docs/upstream/K-brain-LICENSE`。
- 内置提示词、Skills、Hooks、主题保留各自的许可、原始来源、锁定版本和说明，见 `docs/OPENAGENT_BUILTIN_DEVELOPMENT.md`、`resources/prompts`、`crates/agent-gui/src-tauri/prompt/skills`。
- openAgent 图标使用项目提供的原始图片，见 `resources/branding`；`python scripts/generate-app-icons.py` 使用 Pillow 重新生成平台图标。

源码目录、保留的兼容边界和本地清理约定见 [源码范围](docs/OPENAGENT_SOURCE_SCOPE.md)。
