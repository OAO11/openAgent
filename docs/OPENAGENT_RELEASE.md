# openAgent Windows 安装与在线更新

## LiveAgent 的机制

对照本机 LiveAgent v2.0.39 Setup 和安装目录，Setup 为 86,708,983 字节（约 82.69 MiB），包含 `liveagent.exe`、K-brain、computer helper、gateway 及浏览器扩展。主程序和三个后端程序合计约 206.4 MiB。NSIS 使用整体压缩；Tauri 使用系统 WebView2，没有随应用打包完整 Electron Chromium/Node。

上游发布工作流生成安装包、更新签名和 `latest.json`。应用查询 GitHub Releases 版本，读取对应版本清单，按系统和架构选取下载地址，用发布公钥校验更新包，再运行安装程序更新。

## openAgent 的实现

- Windows x64 NSIS，明确使用 LZMA 整体压缩，仅构建一个 Setup 格式。
- 包含 `openAgent.exe`、`k-brain.exe`、`k-brain-computer.exe`，不分发 gateway。
- 每用户安装，可选安装目录。建议使用当前用户可写目录；写入 `data` 失败会显示错误，不会静默落到另一个目录。
- 正式版使用可执行文件所在目录的 `data`，忽略预览版本的目录重定向设置和环境变量。
- 后端、界面 WebView2、本地窗口状态和内置检查报告均位于该根目录下。项目目录、系统临时文件、系统 WebView2 运行时和用户自行安装的开发工具不属于应用持久数据。
- 默认卸载和升级保留 `data`。勾选删除应用数据才清理安装目录内的 `data`；不清理 LiveAgent 或开发预览的数据。静默卸载需要明确传入 `/DELETEAPPDATA` 才删除数据，`/UPDATE` 始终保留数据。
- UI Logo、EXE、Setup、桌面/开始菜单快捷方式和 Windows 托盘使用统一的项目图标。

## 更新信任与版本

更新源固定为 `OAO11/openAgent`。`src-tauri/updater-public-key.txt` 和 Tauri 配置保存同一公钥，私钥不进入源码。

版本必须来自 `v<semver>` 标签。构建脚本生成临时版本配置，把相同版本写入 Tauri 包信息和应用版本显示。正式与预发布渠道沿用现有版本筛选逻辑。发布一个比已安装版本更高的标签，并同时上传 Setup、签名和 `latest.json` 后，应用即可检测到该版本；Git 提交本身不会触发客户端更新。

更新不是无提示强制安装：用户在应用更新入口检查/确认后下载安装。签名验证通过后才调用安装程序；安装前停止本地后端并释放文件句柄。

Tauri 更新签名不能替代 Windows Authenticode。当前未配置 Windows 发布者证书，Windows 可能提示未知发布者。

## 构建与发布

本地使用 `scripts/release/build-windows.ps1`。私钥和密码参数均为仓库外文件路径；也可以由 CI 注入 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

1. 更新产品代码与 `docs/releases/vX.Y.Z.md`，运行相关检查。
2. 提交并推送源码，给相同提交创建并推送 `vX.Y.Z` 标签。
3. 本地构建后上传 `dist/releases/vX.Y.Z` 中的四个文件；或从 GitHub Actions 手动运行 **openAgent Windows Release**，输入该标签。
4. 验证公开的 `latest.json` 指向本版本 Setup，签名和哈希与本地文件相符。

自动发布任务不会覆盖已有 Release。已有版本如需修改可执行内容，应增加版本号后重新发布，避免客户端缓存或签名不一致。

密钥备份：本机构建密钥位于当前用户 LocalAppData 下的 `openAgent/release-keys`，目录 ACL 限制为当前用户和 SYSTEM。GitHub 仓库 Secrets 已配置同一密钥与密码。妥善离线备份；丢失私钥后不能使用现有已安装公钥发布可验证的新版本。

## 数据迁移

开发预览继续使用旧的 `.openagent` 数据目录，正式版不会自动导入。通过应用备份导出，再在正式版导入需要的内容。更新/卸载保留的是正式版安装目录内的数据；删除安装目录会同时删除 `data`。
