# openAgent 本地开发

产品目录：`D:\Desktop\openAgent\openAgent`。发布仓库：`OAO11/openAgent`，开发分支 `main`。

## 源码结构

- `crates/agent-gui`：桌面入口、K-brain 适配器、Tauri/Rust 原生宿主、浏览器扩展及桌面测试。
- `crates/agent-ui`：界面组件、主题、设置、会话与工作台共享逻辑。
- `crates/virtual-core`：项目使用的虚拟列表依赖源码。
- `patches/kbrain`：K-brain 产品补丁。后端仍为 K-brain，没有新增产品自有后端。
- `scripts`、`.github/workflows`：开发检查、资源生成、构建和发布。
- `resources`、`docs/upstream`：品牌资源、内置内容、来源和许可证。

相邻 `LiveAgent` 和 `K-brain` 是上游参考源码。产品构建不依赖它们的未提交修改，K-brain 的提交及补丁校验由 `scripts/release/kbrain.lock.json` 锁定。

## 工具与命令

Windows x64、Node.js、pnpm 10.32.1、Rust/MSVC、Go 1.27.0、WebView2、C++ Build Tools、libclang。完整版本约定见 `mise.toml`。

```powershell
pnpm install --frozen-lockfile --filter openagent-workspace --filter liveagent...
pnpm dev
# 只生成一个开发预览，不生成安装包
pnpm preview:build
.\target\debug\openAgent.exe
```

首次准备 K-brain 会下载锁定源码、应用补丁并编译。开发依赖包括 `node_modules`、K-brain 制品缓存和 `src-tauri/binaries` 中的本地 sidecar，均不提交到 Git。

```powershell
pnpm check:source-scope
pnpm check:ui-boundaries
pnpm typecheck:ui
pnpm typecheck:gui
pnpm check:script-tests
pnpm test:gui
cargo check --workspace --tests --locked
node scripts/generate-builtin-skills.mjs --check
```

`check:fast/all/strict` 是更广的开发检查入口，使用 `mise` 调用固定工具链；现有上游代码的 lint 告警不等同于发布构建失败。具体发布门禁以 CI 为准。

## 数据与发布

正式 Windows 版本使用 `<安装目录>\data`。开发预览默认使用 `%USERPROFILE%\.openagent`，可用 `OPENAGENT_DEV_HOME` 隔离测试数据。不要把应用数据放入源码提交。

更新源为 `OAO11/openAgent` Releases，签名私钥在仓库外。正式 Setup 生成流程见 [发布说明](OPENAGENT_RELEASE.md)。清理源码和开发缓存不修改已发布的版本或附件。
