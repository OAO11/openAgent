---
name: openagent-performance
description: "用基线和可复现实验优化延迟、吞吐、CPU、内存与 I/O；用于系统瓶颈、资源消耗或性能回归。"
license: MIT
---

# 系统性能诊断与优化

用基线和可复现实验优化延迟、吞吐、CPU、内存与 I/O；用于系统瓶颈、资源消耗或性能回归。

## openAgent 使用流程

1. 先定义用户可感知目标与不能退化的约束，冻结代表性输入、指标和测量环境；不要仅凭感觉优化。
2. 从 CPU、内存、磁盘/网络 I/O、数据库和并发等待定位瓶颈；原文中的效率或质量实验只选择与本任务有关的部分。
3. 记录基线后一次验证一个假设，在相同负载下比较 p50/p95、吞吐、错误率和资源峰值。
4. 设置合理的本地实验上限，保留失败和噪声数据；有正确性或稳定性退化时不接受性能提升。
5. 交付复现命令、前后对照、回归结果和剩余限制。生产压测、付费调用和系统级改动仍按实际授权执行。

## 适配与完整来源

- 沿用用户技术栈、仓库规范和已确认的任务范围。只使用当前宿主实际提供的工具；上游专属命令、固定路径、插件与子代理均不是额外前提。
- 不因参考中的固定流程而自动提交、发布、删除已有工作或扩展任务；已获授权的必要工作继续执行。
- 下方保留上游完整正文；未删减原始文件为 [upstream/SKILL.md](upstream/SKILL.md)，原文中相对脚本和引用路径以 upstream 目录为基准，按需要读取，不能假装已经读取或执行。
- 来源：[affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/tree/4adeee6732a12d1540f49a4d50a38ce8c97f9a53/skills/benchmark-optimization-loop)；固定版本 `4adeee6732a12d1540f49a4d50a38ce8c97f9a53`；许可 [MIT](upstream/LICENSE)。中文流程与宿主适配由 openAgent 添加。

## 上游完整参考（英文）

# Benchmark Optimization Loop

Start with what the user needs to accomplish, then choose the benchmark. A
request to improve correctness or quality need not become a speed optimization.
Requests such as "make it 20x faster" or "try 50 recursive optimizations" still
need a bounded, measurable loop.

## When to Activate

Use for goal-driven implementation changes that need repeated measured
comparisons, or to establish the benchmark and plan for such a task. Reuse an
existing adequate regression check for a one-off fix; do not add a search loop
without a reason.

## Tool Requirements

Use the host's already-authorized Read, Write, Edit, Bash, Grep, and Glob tools
or their equivalents. Loading this workflow does not grant tools or expand
existing permissions.

## Required Baseline

Do not optimize until these exist:

- the user task, operation being optimized, and desired outcome;
- the success threshold and correctness, quality, safety, or behavior constraints
  that must stay green;
- the primary metric, its direction and definition: for example discrepancy
  amount, task completion rate, rubric score, wall time, p95 latency, rows/sec,
  cost/resolved task, memory, or error rate;
- representative inputs and independent expected results or a calibrated rubric;
- the current baseline with implementation, input, evaluator, and environment
  versions sufficient to rerun it;
- the search budget: max variants, max time, max spend, max data impact.

Reuse confirmed requirements and authorization. If a material success threshold
or tradeoff is missing, propose a concrete choice and obtain the user's decision.
If the user asks for an unrealistic target, keep the ambition but make the loop
bounded and measurable. A plan-only request stays a plan; paid calls, production
load, and deployment retain their existing authorization boundaries.

Freeze the metric, sample set, expected results, and evaluator for the comparison.
Expected results must not be copied from the candidate implementation. Evaluate
hard constraints separately from aggregate scores. For subjective quality,
calibrate the rubric against accepted examples and record reviewer disagreement;
the optimizing agent's self-score alone is not acceptance evidence.

Record why the metric represents the user outcome. A proxy may help diagnosis,
but improving it does not by itself prove that the user's task improved.

## Loop

1. Measure the baseline, reusing reliable prior evidence only when comparable.
2. Identify the gap from evidence relevant to the user goal.
3. Generate variants that test one hypothesis each.
4. Run variants with the same input shape and evaluation rules under comparable
   conditions; record failures, timeouts, retries, and their costs.
5. Reject variants that fail correctness, other hard constraints, safety, or
   reproducibility.
6. Promote the best measured admissible variant against the agreed objective.
7. Codify the winning path in a script, command, test, config, or doc.
8. Rerun the baseline and winner to confirm the delta, then perform the agreed
   independent acceptance check before declaring the goal met.

Keep a ledger for every run: hypothesis, exact command, implementation and
benchmark versions, case counts, primary result, hard-constraint results,
failures/retries, evidence location, and the keep/reject decision. Failures remain
in task-level denominators. If a statistic covers successes only, report failure
rates and timeouts beside it; distinguish single attempts from complete tasks.

Optimize the implementation rather than quietly lowering the standard. If a
sample or evaluator is wrong, document the evidence. A revision that changes the
meaning of success needs user confirmation; version it and rerun both baseline
and candidate under the revised rules, preserving the original evidence.

## Variant Tables

The following values are illustrative, not measured evidence or default targets.
For a speed goal, track variants like this:

```text
Variant | Hypothesis | Command | Time | Correct? | Notes
baseline | current path | npm run job | 120s | yes | stable
batch-500 | fewer round trips | npm run job -- --batch 500 | 42s | yes | winner
parallel-8 | more workers | npm run job -- --workers 8 | 31s | no | rate limited
```

For a report-correctness goal, independently supplied reconciliation totals
could define the primary measure; faster runtime would not excuse wrong totals:

```text
Variant | Hypothesis | Critical mismatches | All periods processed? | Decision
baseline | current mapping | 4 | yes | baseline
mapping-fix | handle missing category | 0 | yes | candidate for acceptance
skip-errors | omit failing periods | 0 | no | reject: incomplete task
```

## Recursive Search

For recursive or hyperparameter work:

- persist every run to a ledger;
- compare against the prior accepted winner, not only the previous run;
- reserve independent acceptance cases where feasible, controlling answer
  visibility; a known replay check is regression evidence, not an independent
  generalization check;
- once acceptance feedback informs further tuning, treat those cases as
  development evidence and obtain fresh independent cases for final acceptance;
- stop when improvement is within noise, correctness or another hard constraint
  fails, cost exceeds the budget, or the search starts changing more variables
  than it can explain; retain the prior accepted winner and report the gap;
- stop optional search when the requested goal is achieved.

Use phrases like "best measured admissible variant" instead of "global optimum"
unless the search space was actually exhaustive. If independent cases are
unavailable, state that limitation instead of claiming independent acceptance.

## Promotion Gate

A variant cannot become the new default until:

- correctness tests and all other hard constraints pass;
- the objective's measured delta is repeated or explained;
- the agreed acceptance check supports the user goal, with untested paths and
  proxy-only results explicitly identified;
- rollback is obvious;
- the change is encoded in source control or a durable runbook;
- the final summary includes exact commands, versions, measurements, and limits.

Report benchmark success, independent acceptance, and deployed user outcomes
separately. If deployment is authorized, follow the project's release process
and verify the deployed version against the same user-outcome definition;
otherwise report the candidate's pre-deployment status. This skill does not
install a scheduler or grant release authority.

## Related Skills and Sources

Reuse related skills when available in the host's installed profile; optional
references below link to ECC's canonical sources.

- [benchmark](../benchmark/SKILL.md) collects browser/API/build performance
  baselines; reuse it when those measurements serve the chosen goal.
- [eval-harness](https://github.com/affaan-m/ECC/blob/main/skills/eval-harness/SKILL.md) provides agent capability/regression
  evals and grader methods; reuse an appropriate existing evaluator.
- [loop-design-check](https://github.com/affaan-m/ECC/blob/main/skills/loop-design-check/SKILL.md) designs or reviews feedback
  loops and runaway prevention; this skill conducts the measured search.
- [benchmark-methodology](https://github.com/affaan-m/ECC/blob/main/skills/benchmark-methodology/SKILL.md) scores competitors
  for competitive analysis, rather than implementation variants.
- [Sources and scope](upstream/references/sources.md) records this extension's provenance.
