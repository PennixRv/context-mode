# Pennix 集成任务

根协调任务：`codex-workflow-optimization/.trellis/tasks/10-18-context-mode-fastctx-replacement`。本仓库维护本组件源码、测试、构建和 npm 制品；不维护用户运行配置或其他组件源码。

批准范围是 Codex 原生线程与项目绑定、并发隔离、恢复原子消费、取消与期限、本地采集及保留、安全落点、路由和指令来源、移除自更新、scoped npm 发布及隔离验收。未采用的上游宿主实现不作为 Pennix 接入合同。

首版为 `@pennixrv/context-mode@1.0.169-pennix.1`，发布标签为 `beta`。固定上游基线及行为边界见 README。源任务完成前须记录类型检查、全套测试、真实 Codex CLI/app-server、同一 tarball 安装检查与 registry 发布回执。

当前实测已确认 Codex 原生 session_meta 首行可超过 16 KiB；身份解析采用分块读取，上限 1 MiB，仅接受唯一且核验匹配的线程元数据。

本地最终门禁：typecheck 通过；Vitest 201 文件、4470 测试通过，30 个上游可选场景跳过；build、bundle 断言和漂移断言通过。最终 tarball 在独立 HOME/prefix 安装后，bin 归属、版本、Claude/Codex 现有文件不变，以及真实 Codex 0.163.0 CLI/app-server 原生 MCP 身份验证均通过。发布 workflow 对同一 tarball 验证后发布；registry 回执由根任务继续登记。

首次 CI 中 Linux 全套通过；继承的 macOS/Windows 任务暴露平台测试夹具与 POSIX 执行差异，不能记为跨平台通过。Pennix 采用的部署目标为 Linux/WSL，CI 收敛到这一合同；其他上游宿主及平台资产继续保留，但不宣称已适配或验证。此项仅调整 CI，没有更改已发布 tarball 的运行内容。

## 会话恢复修复

后续根任务为 `10-19-context-mode-session-boundary`，组件记录见 [docs/tasks/session-recovery.md](tasks/session-recovery.md)，发行目标 `1.0.169-pennix.5`。Codex 最终恢复字段限制为 8192 个 UTF-8 字节；原始事件在既有保留范围内完整投影，自动恢复来源按核验线程隔离，主动索引保持项目共享。成功输出不再因关键词形成错误或约束，未知状态不标成功；Stop/PreCompact 从原生 rollout 的关联结果确认失败，与用量共用原子游标。

`context-mode recovery` 提供严格只读预览和带预览摘要的精确应用，仅清除已消费的超大恢复快照。数据、归属、旁路文件或摘要不确定时拒绝；不改原始事件、有效索引和用量，不强制回收 SQLite 物理空间。清理会改变恢复快照派生指标，不调整 ADR-0004 的统计公式。

隔离真实 Codex 已贯通六 Hook 的原生信任、成功/失败、原生压缩、resume 与实际 MCP 原文检索。发布制品、完整门禁和当前 WSL 进程验收以组件任务及根执行记录的最终回执为准；隔离通过不等同于当前运行会话已加载新代码。
