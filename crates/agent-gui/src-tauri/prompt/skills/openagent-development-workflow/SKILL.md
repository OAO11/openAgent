---
name: openagent-development-workflow
description: "按需求、架构、实现、测试、优化、发布组织完整软件开发流程，并按当前阶段选择内置 Skills；适用于跨多个阶段的功能交付。"
license: MIT
---

# 软件开发全流程

这是一份 openAgent 原创的流程导航，用于协调内置开发技能。它不会自动启动子代理，也不要求把所有技能同时加载。先确定当前阶段，读取相关 Skill 的完整正文和实际需要的引用，再执行任务。

## 从用户目标确定工作范围

先读仓库说明、现有入口和相关测试，确认目标行为、技术栈、现有约束、交付物与验收标准。用户只要设计时交付设计；用户已要求实现时继续完成实现与验证，不反复请求同一授权。保持已有代码和无关修改。

## 按阶段选择能力

| 阶段 | 技能 | 应产生的证据 |
|---|---|---|
| 需求拆分与实现计划 | openagent-planning | 验收条件、文件范围、接口与依赖顺序 |
| 系统设计与选型 | openagent-architecture | 组件边界、数据流、取舍与必要 ADR |
| 后端和接口 | openagent-backend、openagent-api-design | 服务实现、契约与异常路径测试 |
| 前端和交互 | openagent-frontend | 可操作页面、状态反馈、布局与可访问性验证 |
| 数据库设计与迁移 | openagent-postgres、openagent-database-migrations | 模式、索引、迁移与回滚证据 |
| 自动化测试与故障定位 | openagent-tdd、openagent-debugging、openagent-web-testing | 失败复现、回归测试、UI 验收 |
| 代码与安全审查 | openagent-code-review、openagent-security-review | 可定位的问题、修复与残留风险 |
| 性能优化 | openagent-performance、openagent-react-performance | 相同环境下的前后基线对比 |
| 容器和上线准备 | openagent-containers、openagent-deployment | 构建制品、健康检查、发布和恢复方案 |

PostgreSQL 技能仅适用于 PostgreSQL；其他数据库沿用其原生工具与项目约定。React 技能仅用于相关技术栈。没有相关问题时跳过对应阶段，不制造额外工作。

## 执行与验收

把任务排成依赖顺序，先完成阻塞接口，再落实调用方。每完成一个有意义的改动就运行对应验证；失败时先定位原因再修复。工具无法使用或环境缺失时，说明事实并交付可复现步骤，不能伪造测试或部署结果。

子代理仅在宿主实际提供且任务授权允许时使用；没有子代理也能顺序完成整个流程。任何 Skills 的名称都不是保证工具已经存在的证据。Hooks 的检查结果也不是自动通过的验收门槛。

提交交付说明时，分别列出已完成行为、实际执行的测试、未验证边界和必要下一步。构建、安装、部署和线上验收分别报告。用户要求本地预览时沿用指定制品路径，不创建无必要的版本副本；生产发布继续遵守既有授权范围。
