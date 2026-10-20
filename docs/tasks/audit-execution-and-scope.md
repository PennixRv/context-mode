# 审查残余：执行结果与本次查询作用域

根协调任务：`codex-workflow-optimization/.trellis/tasks/10-20-audit-residual-convergence`。本组件在 main 维护 F-010、F013、F019、F014，基线 `e18c61442066e938f1f92832d42d2f5749501d49`、`1.0.169-pennix.8`。用户已在完整方案展示后明确批准推进至既定停止点，覆盖实施、正式发布及单组件安装。

## 需求与修改范围

- F-010：共享路由的动态提示采用固定格式 `printf` 和 POSIX 字面量参数，避免 `$()`、反引号、引号、反斜杠或换行再次成为 shell 程序；隔离回归证明没有执行原命令或副作用。
- F013：串/并行批处理保留逐项退出码、成功/非零/超时/异常/跳过；用户明确选择存在硬失败就设置整体 `isError`，同时保留已完成和部分输出，复用现有 shell 软失败分类。最终响应直接列逐项状态，空查询或检索未命中不能掩盖失败；未知不能写成成功，不自动重试。
- F019：POSIX 预加载环境设置作为独立 export 语句作用于整个原始 shell 程序，不在 for/if 前放命令级变量赋值；保留原超时、并发和执行器环境安全策略。
- F014：execute intent 和默认 batch 检索仅查询本次 `index` 返回的数值 sourceId；内部精确条件在 SQL 候选 LIMIT 前应用，贯穿 porter/trigram/fuzzy/RRF，不仅在结果后过滤。显式 global 与普通 ctx_search 仍支持共享历史，自动会话来源隔离保持；无数据库 schema 迁移。

主要目标：`hooks/core/routing.mjs`、`src/server.ts`、`src/store.ts` 及已有 routing/echo/server/search/store 测试。内部来源参数同步到搜索调用和测试替身，不新增 MCP 用户参数或依赖。不修改用户级 Skill、AGENTS、安装副本或运行数据库。build/bundle 产物由原生脚本生成。

本记录命中现有 `tasks/` 忽略规则；提交前须精确列入提交计划，并沿已有 `docs/tasks/session-recovery.md` 的受跟踪惯例，仅对本文件强制暂存。不扩大 ignore 规则或纳入其他任务数据。

## 回归与完整验证

1. 先补旧代码失败的回归，再修复。F-010 实际执行提示并检查隔离标记；F013/F019 串并行覆盖 0、exit 7、软失败、超时、异常、跳过和 for/if/多行/heredoc；确认 Node 跟踪设置和实际退出码。
2. F014 覆盖跨线程重复标签、error 前后缀、batch 标签截断碰撞、同线程并发及超过候选 LIMIT 的旧记录；本次无旧词则不返回历史，本次词可达，global 明确保留历史命中。
3. 执行 `npm run typecheck`、`npm test`（包含原生 pretest build/bundle/drift），再运行 `node scripts/verify-codex-host.mjs`。不得用缺少 native threadId 的 handler 调用替代真实宿主验收，不伪造身份或关闭校验。
4. 原生 pack 后用 `node scripts/verify-tarball.mjs <精确 tgz>` 检查同一制品。记录真实通过、失败和既有跳过，不保存用户数据库、rollout 或原始工具日志到 Git。

## 发行、安装与停止点

源码验证：新增回归先复现失败，再验证通过；完整测试 201 个文件、4503 项通过、30 项既有跳过。`npm run typecheck`、pretest build/bundle/drift 通过。原生 `verify-codex-host.mjs` 的 Codex CLI、app-server 身份链和压缩后失败事件恢复均通过；该隔离验证不替代安装后的当前宿主现场证据。

四项合并为同一发行物。首个 `v1.0.169-pennix.9` CI 在测试阶段失败，runner 未安装可选 zsh；`.10` 因 `it.each` 回调不提供 context、缺少 zsh 时调用 skip 失败，均未进入 npm publish。改用已有 `it.skipIf`；本机完整路由领域 99 项通过，受控 PATH 排除 zsh 时 sh 通过、zsh 明确跳过，类型检查通过。采用新补丁候选 `1.0.169-pennix.11`，保留两个失败 tag。发行前核对远端及版本未占用。沿本 fork 的 npm 版本/manifest 同步、main/tag/CI 链，CI 验证同一 tarball 后发布 scoped 包 `@pennixrv/context-mode` 的 beta。以当前 README、Pennix 维护记录和 CI 为合同，不执行遗留上游 ops 文档的 unscoped 本地 publish、自动多代理、next 合并或分支清理。

根任务负责制品版本/ref/integrity 核验、当前机器 `pennix update context-mode` 和必要的 `pennix repair context-mode`，保留其他 MCP/Hook 和用户自有资产。安装候选必须与本任务制品一致，失败保留原生 journal；不手改 lock/receipt。

隔离原生 Codex 宿主链验证制品，现场还须证明实际宿主加载获批包/Hook，并有 F-010、F013/F019/F014 受影响路径的真实代表回执。旧常驻 MCP、另一个 CLI 或模拟宿主不能代替现场加载证据；不强制终止本会话。若原生入口无法等价重连，保存断点、保持未完成，待用户重连后直接续验。复用仍适用的前序证据，不重跑整个历史路由矩阵。

安装前后由根记录真实 PATH 下的 `pennix plan/status/check`、入口路径、版本/来源、包/native receipt、lock 和必要 Hook 清单，确保无意外变更或未解决 journal。代码、制品、安装、现场行为及组合验收通过后，最终交付记录和全部范围内变更提交推送到 main；本地 HEAD 与实时 origin/main 相同、ahead/behind=0/0，tracked/untracked 无任务记录遗漏。根 gitlink 固定最终已验收 HEAD，发行代码/tag 提交另记。

发布前失败停在源码现场，已发布版本不覆盖，后续缺陷采用新补丁；正式降级缺少 owner 接口时停止部署并报告。遵守根设计的唯一完成停止点；提前停止须记录实际阶段、缺失证据、恢复状态和唯一待续动作，成功后无 pending next action，不追加升级、清理或重复实验。
