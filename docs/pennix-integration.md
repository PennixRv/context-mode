# Pennix 集成任务

根协调任务：`codex-workflow-optimization/.trellis/tasks/10-18-context-mode-fastctx-replacement`。本仓库维护本组件源码、测试、构建和 npm 制品；不维护用户运行配置或其他组件源码。

批准范围是 Codex 原生线程与项目绑定、并发隔离、恢复原子消费、取消与期限、本地采集及保留、安全落点、路由和指令来源、移除自更新、scoped npm 发布及隔离验收。未采用的上游宿主实现不作为 Pennix 接入合同。

首版为 `@pennixrv/context-mode@1.0.169-pennix.1`，发布标签为 `beta`。固定上游基线及行为边界见 README。源任务完成前须记录类型检查、全套测试、真实 Codex CLI/app-server、同一 tarball 安装检查与 registry 发布回执。

当前实测已确认 Codex 原生 session_meta 首行可超过 16 KiB；身份解析采用分块读取，上限 1 MiB，仅接受唯一且核验匹配的线程元数据。

本地最终门禁：typecheck 通过；Vitest 201 文件、4470 测试通过，30 个上游可选场景跳过；build、bundle 断言和漂移断言通过。最终 tarball 在独立 HOME/prefix 安装后，bin 归属、版本、Claude/Codex 现有文件不变，以及真实 Codex 0.163.0 CLI/app-server 原生 MCP 身份验证均通过。发布 workflow 对同一 tarball 验证后发布；registry 回执由根任务继续登记。

首次 CI 中 Linux 全套通过；继承的 macOS/Windows 任务暴露平台测试夹具与 POSIX 执行差异，不能记为跨平台通过。Pennix 采用的部署目标为 Linux/WSL，CI 收敛到这一合同；其他上游宿主及平台资产继续保留，但不宣称已适配或验证。此项仅调整 CI，没有更改已发布 tarball 的运行内容。
