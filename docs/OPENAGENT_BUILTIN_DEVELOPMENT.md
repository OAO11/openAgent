# openAgent 内置开发 Skills 与 Hooks

审查与集成日期：2026-11-27。这里记录经过筛选、适配和验证的来源，不做“全网最好”的不可验证排名。

## Skills

新增 16 个，保留原有代码审查、技能编写和安装技能。通过现有启动播种机制自动安装，可在 Skills 菜单查看并按项目启用；不会强制全选或额外启动子代理。

| 用途 | 名称 | 固定版本来源与许可 |
|---|---|---|
| 软件开发全流程 | `openagent-development-workflow` | openAgent 原创流程导航 |
| 开发计划 | `openagent-planning` | [obra/superpowers](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/writing-plans/SKILL.md) · MIT |
| 系统架构设计 | `openagent-architecture` | [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/blob/4adeee6732a12d1540f49a4d50a38ce8c97f9a53/skills/architecture-decision-records/SKILL.md) · MIT |
| API 与接口契约 | `openagent-api-design` | [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/blob/4adeee6732a12d1540f49a4d50a38ce8c97f9a53/skills/api-design/SKILL.md) · MIT |
| 后端工程 | `openagent-backend` | [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/blob/4adeee6732a12d1540f49a4d50a38ce8c97f9a53/skills/backend-patterns/SKILL.md) · MIT |
| 前端界面与交互 | `openagent-frontend` | [anthropics/skills](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/frontend-design/SKILL.md) · Apache-2.0 |
| React 性能优化 | `openagent-react-performance` | [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/blob/4adeee6732a12d1540f49a4d50a38ce8c97f9a53/skills/react-performance/SKILL.md) · MIT |
| PostgreSQL 数据库设计与优化 | `openagent-postgres` | [supabase/agent-skills](https://github.com/supabase/agent-skills/blob/c9be0e931b7930f7d02126d04774d904c381e7d7/skills/supabase-postgres-best-practices/SKILL.md) · MIT |
| 数据库迁移 | `openagent-database-migrations` | [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/blob/4adeee6732a12d1540f49a4d50a38ce8c97f9a53/skills/database-migrations/SKILL.md) · MIT |
| 测试驱动开发 | `openagent-tdd` | [obra/superpowers](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/test-driven-development/SKILL.md) · MIT |
| 系统化故障排查 | `openagent-debugging` | [obra/superpowers](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/systematic-debugging/SKILL.md) · MIT |
| Web 端到端测试 | `openagent-web-testing` | [anthropics/skills](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/webapp-testing/SKILL.md) · Apache-2.0 |
| 应用安全审查 | `openagent-security-review` | [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/blob/4adeee6732a12d1540f49a4d50a38ce8c97f9a53/skills/security-review/SKILL.md) · MIT |
| 系统性能诊断与优化 | `openagent-performance` | [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/blob/4adeee6732a12d1540f49a4d50a38ce8c97f9a53/skills/benchmark-optimization-loop/SKILL.md) · MIT |
| CI/CD 与上线发布 | `openagent-deployment` | [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/blob/4adeee6732a12d1540f49a4d50a38ce8c97f9a53/skills/deployment-patterns/SKILL.md) · MIT |
| Docker 与运行环境 | `openagent-containers` | [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/blob/4adeee6732a12d1540f49a4d50a38ce8c97f9a53/skills/docker-patterns/SKILL.md) · MIT |

16 个技能都有中文触发描述与操作流程；其中 15 个上游适配技能还保留完整上游正文、未删改的 `upstream/SKILL.md`、全部同目录支持文件和许可证。Supabase 的 CHANGELOG.md 按宿主校验规则重命名为 upstream/history.md，原文内容与哈希保持一致。Web 测试的三个 Python 示例增加 shebang 首行以符合宿主校验，逐字原文另存为同目录 `.py.txt` 并保留来源哈希。原文的脚本与引用以 `upstream/` 为根，中文适配说明优先处理宿主工具、技术栈、授权和路径差异；不会因为加载技能就执行附带脚本。Postgres 和 React 技能仅针对相应技术栈，Web 测试不会冒充原生桌面验收。

`crates/agent-gui/src-tauri/prompt/skills/catalog.json` 记录每个原始文件的仓库、40 位固定提交、路径、SHA-256 与许可证。`node scripts/generate-builtin-skills.mjs` 生成 Rust 嵌入列表，`--check` 校验列表一致性；安装与读取不依赖网络。K-brain 以明确的名称白名单加精确所有权标记识别内置技能。同名未标记的用户技能保留；内置升级先备份，现有用户选择不被重置。

## Hooks

设置 → Hooks 增加“我的 Hooks / 内置预设”两个标签。预设须查看完整脚本并保存，默认关闭，之后在“我的 Hooks”启用。稳定 ID 防止重复添加；删除后允许重新添加。既有自定义 Hooks 不被覆盖。

| 预设 | 来源与适配 | 执行范围 |
|---|---|---|
| 请求结束提示音 | ECC desktop-notify 的思路，openAgent 原生 Windows 适配 | 系统声音，无需 BurntToast；结束不等于成功 |
| Git 改动格式检查 | openAgent 实现，Git `diff --check` | 暂存和未暂存的已跟踪文件，不含未跟踪文件 |
| 项目类型检查 | ECC post-edit-typecheck 的思路 | 已有 openagent:hook:typecheck / typecheck / check:types |
| 项目 Lint 检查 | ECC stop-format-typecheck 的思路 | 已有 openagent:hook:lint / lint:check / lint，不添加 --fix |
| 项目 CI 测试 | ECC verification-loop 的思路 | 已有 openagent:hook:test / test:ci / test:run，避免默认 test 的监听模式 |

上游 ECC 固定版本为 `4adeee6732a12d1540f49a4d50a38ce8c97f9a53`，MIT 版权与许可随脚本文本嵌入。它们是适配实现，不是假称直接运行的 Claude 插件；没有引入 Claude 插件路径、工具 JSON 输入、会话记忆注入或工具阻断等当前执行器不提供的能力。

五个预设均在 `agent_end` 执行。检查脚本使用明确的工作区路径，不在缺少工作区时猜测当前目录。Node 项目按 packageManager/锁文件选择已安装的 npm、pnpm 或 yarn；缺少工具失败，缺少支持的项目或命令如实写 skipped，不自动安装依赖。项目脚本行为由项目自行定义；非 JS/TS 项目可编辑预设使用其原生命令。测试最长五分钟，其他检查使用较短超时，仍沿用 K-brain 的运行取消机制。

检查结果在 `data/hook-reports\<工作区哈希>\<检查名>.json` 保留每项最新状态与输出。检查失败返回非零退出码，由当前对话显示 Hook 警告；结果不会自动成为模型上下文，也不能用作阻断发布的强制门禁。没有改动现有供应商或真实对话。

## 验证

记录与原生截图见 `.openagent-validation/builtin-*`。覆盖资源完整性、内置冲突保护、重复播种、脚本成功/失败/跳过、中文与特殊字符路径，以及 EXE 中的添加、编辑、开关、去重、删除恢复和技能全文读取。最终结果在 `docs/OPENAGENT_LOCAL_DESKTOP.md` 追加。
