---
name: openagent-postgres
description: "设计 PostgreSQL 表结构、索引、RLS 和连接管理，诊断慢查询、锁等待与资源消耗；也适用于非 Supabase 托管的 PostgreSQL。"
license: MIT
---

# PostgreSQL 数据库设计与优化

设计 PostgreSQL 表结构、索引、RLS 和连接管理，诊断慢查询、锁等待与资源消耗；也适用于非 Supabase 托管的 PostgreSQL。

## openAgent 使用流程

1. 先确认数据库版本、表规模、访问模式和租户隔离要求；不得将 Postgres 专属语法直接套到其他数据库。
2. 按具体问题读取 upstream/references 对应规则：query、conn、security、schema、lock、data、monitor。不要一次加载全部文件。
3. 通过查询计划与实际负载诊断索引、N+1、连接耗尽和锁争用；EXPLAIN ANALYZE 会真实执行查询，写语句须使用授权的隔离环境。
4. 为模式变化准备迁移和回滚，为 RLS 和权限编写正反向测试；在代表性数据上复测性能和隔离。

## 适配与完整来源

- 沿用用户技术栈、仓库规范和已确认的任务范围。只使用当前宿主实际提供的工具；上游专属命令、固定路径、插件与子代理均不是额外前提。
- 不因参考中的固定流程而自动提交、发布、删除已有工作或扩展任务；已获授权的必要工作继续执行。
- 下方保留上游完整正文；未删减原始文件为 [upstream/SKILL.md](upstream/SKILL.md)，原文中相对脚本和引用路径以 upstream 目录为基准，按需要读取，不能假装已经读取或执行。
- 来源：[supabase/agent-skills](https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7/skills/supabase-postgres-best-practices)；固定版本 `c9be0e931b7930f7d02126d04774d904c381e7d7`；许可 [MIT](upstream/LICENSE)。中文流程与宿主适配由 openAgent 添加。

## 上游完整参考（英文）

# Supabase Postgres Best Practices

Comprehensive performance optimization guide for Postgres, maintained by Supabase. Contains rules across 8 categories, prioritized by impact to guide automated query optimization and schema design.

## When to Apply

Reference these guidelines when:
- Writing SQL queries or designing schemas
- Implementing indexes or query optimization
- Reviewing database performance issues
- Configuring connection pooling or scaling
- Optimizing for Postgres-specific features
- Working with Row-Level Security (RLS)

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Query Performance | CRITICAL | `query-` |
| 2 | Connection Management | CRITICAL | `conn-` |
| 3 | Security & RLS | CRITICAL | `security-` |
| 4 | Schema Design | HIGH | `schema-` |
| 5 | Concurrency & Locking | MEDIUM-HIGH | `lock-` |
| 6 | Data Access Patterns | MEDIUM | `data-` |
| 7 | Monitoring & Diagnostics | LOW-MEDIUM | `monitor-` |
| 8 | Advanced Features | LOW | `advanced-` |

## How to Use

Read individual rule files for detailed explanations and SQL examples:

```
references/query-missing-indexes.md
references/query-partial-indexes.md
references/_sections.md
```

Each rule file contains:
- Brief explanation of why it matters
- Incorrect SQL example with explanation
- Correct SQL example with explanation
- Optional EXPLAIN output or metrics
- Additional context and references
- Supabase-specific notes (when applicable)

## References

- https://www.postgresql.org/docs/current/
- https://supabase.com/docs
- https://wiki.postgresql.org/wiki/Performance_Optimization
- https://supabase.com/docs/guides/database/overview
- https://supabase.com/docs/guides/auth/row-level-security
