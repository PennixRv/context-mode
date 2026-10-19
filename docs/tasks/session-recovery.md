# Codex 会话恢复与状态采集修复

根协调任务：`codex-workflow-optimization/.trellis/tasks/10-19-context-mode-session-boundary`。用户已批准该任务封口方案 revision 1；本组件基线为 `2cb3b93e6dfa57510b13dc20eb5a7b3aac6ce6bb`、`1.0.169-pennix.2`，发行目标为 `1.0.169-pennix.4`，沿用本 fork 的 main/tag/CI 发布链。

## 行为差距与修改范围

现状是 Codex 从成功输出关键词误提取失败，未知不透明状态被写成成功；恢复将错误全文和 guide 叠加，检索投影又截短或遗漏事件。修复保留聚合、持久化和线程连续性：最终恢复字段不超过 8192 字节，正文在既有保留范围内按线程查询。

修改目标为共享状态提取、Codex rollout 解析与 Stop/PreCompact 共用采集、SessionDB 事件/游标事务、共享快照可选预算、Codex SessionStart 与完整投影、原生 recovery CLI、既有领域测试及真实宿主/包验证脚本。其他宿主未传预算或完整投影选项时保持原默认合同；不扩张私密/MCP/编排采集，不改用户规则或其他组件。

原生 recovery 默认严格只读预览；摘要匹配应用只删除本项目已消费且超预算旧快照。原始事件、有效索引、未消费快照、用量、宿主历史受保护。失败整批回滚，不强制 VACUUM，不复制用户历史作为测试夹具。

## 验证与发行

先在现有领域文件写失败回归，再修复并执行 typecheck、完整 Vitest、原生 build/bundle/drift、真实 Codex 和同一 tarball 验证。通过后发布 beta 精确版本，核对 registry integrity/tag/commit；Lifecycle 固定与当前 WSL 部署由根任务继续协调。发布前失败不部署；已发布版本不覆盖，修复采用后续版本。

当前：领域回归、build/bundle/drift 与 typecheck 通过。单次事务复用现有 bulkInsertEvents，兼容 Node SQLite 适配器；严格只读预览已验证静止库不创建 WAL/SHM，断链与损坏拒绝。自动恢复来源在 SQL LIMIT 前按线程过滤，主动索引共享保持；外部 MCP 同名命名空间不会作为原生命令采集。真实 Codex 0.163.0 已贯通六 Hook 原生信任、命令退出 0/7、单条失败、原生压缩、重连 resume 和实际原文检索。完整产品门禁、最终 tarball 与发布部署仍在推进；未清理运行数据。

发行前最终结果：typecheck 通过；201 个 Vitest 文件、4483 项测试通过，30 项上游可选场景跳过；build/bundle/drift 与差异检查通过。最终 tarball 包含 recovery 模块和共享 rollout Hook，独立 HOME/prefix 安装与真实 Codex 验证通过；带 1 MiB 正文及 40 类多字节事件的真实原生压缩/resume 恢复字段为 8153 字节，完整 JSON 为 8490 字节，原文实际检索可达。JSON 转义开销独立报告，不混入字段预算。

全套运行需排除调用者继承的 CODEX_THREAD_ID/CODEX_CI 平台识别信号，避免将 OpenCode 等宿主夹具识别为当前 Codex；产品验证仍使用原生线程身份。两个路由测试改用既有 resetGuidanceThrottle 清理其固定测试会话的一次性标记，重复运行可通过。共享约束提取保留其他宿主既有 Error/显式失败入口。

本地 tarball SHA-1 为 dcf70465b7c730325cae83fdf4c48d52efefc52f；发布 CI 仍须对实际发布的 tarball 复验，当前 WSL 部署及历史维护由根任务继续记录。

.3 的 main/tag 为 4224578331624980ae6079262b4e889c6fc4ab5e；Linux CI 39180003996 通过，发布 CI 39180020381 的类型及全套检查也通过，但 runner 的只读网络沙箱配置 loopback 失败，使原生命令实际退出 1，精确包断言正确阻断发布，npm 未发布 .3。保留失败标签，前向发布 .4。夹具仅为合成命令显式使用原生 `readOnly` / `networkAccess: true` 策略，保留文件只读和原生 Hook 信任；不使用 bypass，不修改用户设置，不发起外部功能请求。另兼容 npm pack JSON 的数组/对象形态。

.4 的最终 tarball 已在本地以修订夹具验证通过：CLI/app-server、六 Hook 信任、原生压缩/resume 与原文查询均通过，恢复字段 8153 字节、完整 JSON 8490 字节；registry 版本预检返回 E404，尚未占用。后续 CI/registry 和部署回执由根执行记录保存。
