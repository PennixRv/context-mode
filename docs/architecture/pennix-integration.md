# Pennix 架构与集成记录

## 当前：跟随上游稳定版本

根任务为 `context-mode-routing-upstream-audit`。固定上游为 `v2.1.5`、提交 `157464a3f47b9c5e2e068a800b3490ffca67aab2`；采用保留双亲历史的普通合并。发行目标为 `@pennixrv/context-mode@2.1.5-pennix.1`、`beta` 通道和 `v2.1.5-pennix.1` 标签，当前实施和验收事实以根任务的 execution.md 为准。

运行架构、工具 API、共享数据根 `~/.context-mode`、项目共库、journal、2048 字节恢复状态、seq 原文、自动淘汰及数据库自愈遵循上游。旧 rollout 事件补采、session-events 投影、8192 字节恢复及主动索引永久保护均不迁入。原始 Codex 历史和独立 memories 保留。

必要差异限定为 scoped 发行身份、Codex 原生线程元数据核验、submodule 项目解析、未知结果的真实报告和 Lifecycle 安装归属。Codex 每次 MCP 调用使用实际 threadId，核验唯一 rollout 的首条 session_meta；不采集后续事件。Codex 0.167.0 的原生 Bash Hook 只给出正文时，journal 保留正文并将结果留为未知，不能据此标记成功或恢复错误状态。

安装、更新、卸载、MCP、四类 Hook/trust 和三个命令 Skill 由 Pennix Lifecycle 负责。`setup --print codex --json` 使用上游 registry、本地 hash/path 计算，输出声明式计划；不启动 Codex 探测。Lifecycle 校验成员、路径、归属及合并后的 trust 位置后写入，并由真实宿主核验。完整 setup、upgrade、remove、repair 和 dry-run 入口仅返回 owner 指引；doctor 的配置交互修复关闭，数据库自愈保留。独立的 Pennix Context Mode 集成 Skill 由集合 owner 移除。

Pennix 验收目标为 Linux/WSL、Codex 0.167.0、Node.js 24.15.0 及 26。上游多宿主实现和测试保留，涉及上游自行安装、改写发行分支或维护统计的 CI 只在上游仓库运行；fork 使用独立的现有 CI job 和 tag 发布 job。最终提交固定后构建 release-out，本地与 CI 各自构建；CI 只 pack 一次，验证该 tarball 后发布，不声称两次构建的字节相同。

旧数据维护入口为一次性 `node scripts/cleanup-v1-data.mjs`，默认只读预览；仅在核验旧 writer 已退出后，使用当前预览 digest 执行。脚本只识别 `${CODEX_HOME:-$HOME/.codex}/context-mode` 下的已知 v1 布局/schema，拒绝链接、未知文件、活动占用、变更或并发清理。失败和未知对象保留，不自动清理其他数据根，也不创建旧索引备份。Linux 进程检查是关闭现场的必要证据，不能消除任意外部写入竞态；维护窗口中不得再启动旧宿主。

## v1 历史记录

根协调任务：`codex-workflow-optimization/.trellis/tasks/10-18-context-mode-fastctx-replacement`。本仓库维护本组件源码、测试、构建和 npm 制品；不维护用户运行配置或其他组件源码。

批准范围是 Codex 原生线程与项目绑定、并发隔离、恢复原子消费、取消与期限、本地采集及保留、安全落点、路由和指令来源、移除自更新、scoped npm 发布及隔离验收。未采用的上游宿主实现不作为 Pennix 接入合同。

首版为 `@pennixrv/context-mode@1.0.169-pennix.1`，发布标签为 `beta`。固定上游基线及行为边界见 README。源任务完成前须记录类型检查、全套测试、真实 Codex CLI/app-server、同一 tarball 安装检查与 registry 发布回执。

当前实测已确认 Codex 原生 session_meta 首行可超过 16 KiB；身份解析采用分块读取，上限 1 MiB，仅接受唯一且核验匹配的线程元数据。

本地最终门禁：typecheck 通过；Vitest 201 文件、4470 测试通过，30 个上游可选场景跳过；build、bundle 断言和漂移断言通过。最终 tarball 在独立 HOME/prefix 安装后，bin 归属、版本、Claude/Codex 现有文件不变，以及真实 Codex 0.163.0 CLI/app-server 原生 MCP 身份验证均通过。发布 workflow 对同一 tarball 验证后发布；registry 回执由根任务继续登记。

首次 CI 中 Linux 全套通过；继承的 macOS/Windows 任务暴露平台测试夹具与 POSIX 执行差异，不能记为跨平台通过。Pennix 采用的部署目标为 Linux/WSL，CI 收敛到这一合同；其他上游宿主及平台资产继续保留，但不宣称已适配或验证。此项仅调整 CI，没有更改已发布 tarball 的运行内容。

## 会话恢复修复

后续根任务为 `10-19-context-mode-session-boundary`，组件记录见 [docs/tasks/session-recovery.md](tasks/session-recovery.md)，发行目标 `1.0.169-pennix.6`。Codex 最终恢复字段限制为 8192 个 UTF-8 字节；原始事件在既有保留范围内完整投影，自动恢复来源按核验线程隔离，主动索引保持项目共享。成功输出不再因关键词形成错误或约束，未知状态不标成功；Stop/PreCompact 从原生 rollout 的关联结果确认失败，与用量共用原子游标。

`context-mode recovery` 提供严格只读预览和带预览摘要的精确应用，仅清除已消费的超大恢复快照。数据、归属、旁路文件或摘要不确定时拒绝；不改原始事件、有效索引和用量，不强制回收 SQLite 物理空间。清理会改变恢复快照派生指标，不调整 ADR-0004 的统计公式。

隔离真实 Codex 已贯通六 Hook 的原生信任、成功/失败、原生压缩、resume 与实际 MCP 原文检索。发布制品、完整门禁和当前 WSL 进程验收以组件任务及根执行记录的最终回执为准；隔离通过不等同于当前运行会话已加载新代码。
