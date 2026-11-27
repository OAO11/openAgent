# openAgent

![openAgent](resources/branding/openagent-logo.png)

基于 LiveAgent 桌面端和 K-brain 本地后端的 Windows Agent 工作台，使用 Tauri、React 和 Rust。后端直接使用 K-brain，产品面向本机工作区。

## 源码结构

- `crates/agent-gui`：桌面入口、Tauri 原生宿主、K-brain 适配、浏览器扩展和测试。
- `crates/agent-ui`、`crates/virtual-core`：界面组件、主题和虚拟列表源码。
- `patches/kbrain`：K-brain 产品补丁；固定上游版本和补丁 SHA-256 见 `scripts/release/kbrain.lock.json`。
- `resources`：品牌、内置提示词和许可证；`src-tauri/prompt/skills` 中的 Markdown 是随应用加载的技能资源。
- `scripts`、`.github/workflows`：开发检查、资源生成、构建和发布。

Git 仅保留源码、运行资源、必要测试、依赖锁、构建配置、许可证和本说明。`docs`、工作记录、安装包、依赖目录、构建缓存、用户数据及私钥不提交；`pnpm check:source-scope` 检查提交文件范围。

## 开发与检查

需要 Windows x64、Rust/MSVC、C++ Build Tools、WebView2、libclang，以及 `mise.toml` 中固定的 Node.js、pnpm、Go、protoc 等工具。`LIBCLANG_PATH` 指向包含 `libclang.dll` 的目录。

```powershell
npx.cmd --yes pnpm@10.32.1 install --frozen-lockfile --filter openagent-workspace --filter liveagent...
npx.cmd --yes pnpm@10.32.1 dev
# 更新唯一的本地预览，不生成安装包
npx.cmd --yes pnpm@10.32.1 preview:build
.\target\debug\openAgent.exe
```

首次构建会下载锁定的 K-brain 源码、应用产品补丁并编译；不依赖相邻参考仓库的本地改动。构建依赖保存在 `node_modules`、`.liveagent` 和 `src-tauri/binaries`，不上传 Git。调整补丁时必须同步更新锁文件的摘要并重建后端。

```powershell
pnpm check:source-scope
pnpm typecheck:ui
pnpm typecheck:gui
pnpm check:ui-boundaries
pnpm check:script-tests
pnpm test:gui
cargo check --workspace --tests --locked
node scripts/generate-builtin-skills.mjs --check
```

## 安装包与在线更新

从本仓库 Releases 下载安装包。正式版数据位于 `<安装目录>\data`，开发预览默认使用 `%USERPROFILE%\.openagent`。安装目录应允许当前用户写入；升级及默认卸载保留数据，卸载时明确选择删除数据才清理。

对已提交的版本创建并推送 `v<semver>` 标签后，可运行 GitHub Actions 的 **openAgent Windows Release**，或使用本地脚本：

```powershell
.\scripts\release\build-windows.ps1 -Tag v0.1.1 `
  -SigningKeyPath '<仓库外的私钥路径>' `
  -SigningPasswordPath '<仓库外的密码文件路径>'
```

将 `dist/releases/<tag>` 中的 Setup、`.sig`、`latest.json` 和 `SHA256SUMS.txt` 发布到对应 Release。CI 通过仓库 Secrets 提供 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；不覆盖已有 Release。发布说明由 GitHub 根据提交生成，不依赖仓库文档。

应用从 `OAO11/openAgent` Releases 检查更新，使用项目公钥验证安装包。Git 提交不会直接更新客户端，需发布更高版本的签名安装包。Setup 使用 NSIS 和系统 WebView2，缺少 WebView2 时联网安装运行时；更新签名不等同于 Windows 发布者证书。

## 来源与许可证

- LiveAgent：MIT，原始版权声明保留在根目录 `LICENSE`。
- K-brain：Apache-2.0，完整文本位于 `resources/licenses/K-brain-LICENSE`，随安装包分发。
- 提示词：`msitarzewski/agency-agents`；原文、固定版本及摘要见 `resources/prompts`，MIT 许可见 `LICENSE.agency-agents`。
- 内置 Skills：来源、固定版本和文件摘要见 `crates/agent-gui/src-tauri/prompt/skills/catalog.json`，原始内容与许可证保留在各技能目录；Hooks 的来源和许可随脚本嵌入。
- 主题：Catppuccin palette 1.8.0（`07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd`）和 `panxiaoan/falcon-jetbrains-themes`（`c3ddba2d8c71137e5191033df8e882b2936f8f7d`）。来源记录保存在主题源码中，完整 MIT 许可证位于 `crates/agent-gui/public/third-party`。
- 应用图标：源图位于 `resources/branding`，使用 `python scripts/generate-app-icons.py` 及 Pillow 生成平台图标。
