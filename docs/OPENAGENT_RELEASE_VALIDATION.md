# openAgent v0.1.0 Windows 验收记录

日期：2026-11-27。环境：Windows x64，系统 WebView2。

## 构建和图标

- Windows release 原生编译、NSIS LZMA 打包成功。
- Setup 包含桌面、锁定版本并应用产品补丁的 K-brain、computer helper 和许可资源。
- EXE 与 Setup 的内嵌图标已提取，与新 ICO 的 32×32 图像逐像素相同。
- 桌面与开始菜单快捷方式指向安装后的 openAgent.exe，使用其内嵌图标。
- 界面 Logo 与 Windows 托盘使用同一原始图片生成。

## 实际安装验收

- 全新安装的聊天列表和工作空间为空，不自动读取开发预览或其他历史目录。
- 实际数据根目录为安装目录下的 data，开发环境的目录覆盖变量无效。
- WebView2 的 Local Storage 位于 data/webview；窗口状态文件位于 data。
- 窗口 1159×857，右侧工作台收起，新 Logo 正常显示。
- K-brain 健康检查成功；未认证请求返回 401；19 个内置 Skills 可读取。
- 关闭窗口可隐藏至托盘。
- 同版本 /UPDATE 覆盖安装保留测试 Hook 和 Local Storage。
- 默认卸载移除程序并保留 data；重装后测试 Hook 和 Local Storage 仍可读取。
- 明确删除数据的卸载清理 data 和空安装目录，保留开发预览的 AppData。

## 针对性检查

- GUI/UI TypeScript 类型检查、UI 边界检查通过。
- 发布工具测试：21 通过，2 项因 Windows 上无法观察 Unix 执行权限而跳过。
- 数据目录单元测试：10 通过。
- 更新模块单元测试：8 通过。
- 历史迁移相关测试：18 通过，2 忽略。
- NSIS Hook 测试：8 通过，包括更新优先保留、显式删除参数、子进程文件锁、持续占用失败报告和预览数据保护。
- Tauri 更新签名验证通过；被修改的安装包校验失败。
- 导出源码扫描未发现新增凭据，不包含应用数据、签名私钥、构建缓存或依赖目录。

## 验证边界

这是首个发行版本，覆盖安装、持久化和签名机制已实测；尚无旧的正式版可用于验证真实的跨版本在线升级。未运行所有上游测试。原生编译仍有上游遗留警告。没有 Windows Authenticode 发布者证书，更新包使用独立的 Tauri 更新签名。

安装验收的本机数据、截图、日志保存在被 Git 忽略的 .openagent-validation/packaging，不随源码发布。
