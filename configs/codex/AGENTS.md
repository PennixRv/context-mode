# Context Mode 接入说明

本文件是包内说明，不应自动复制或追加到用户 AGENTS.md。Pennix 的用户模板由 lifecycle 管理，完整工作流边界见 `pennix-context-mode-integration`，跨组件选择见 `pennix-workflow-routing`。

本地分析、检索和大输出处理优先使用 Context Mode。必须完整阅读的指令与精确编辑依据使用宿主有界读取；语义编辑使用宿主 apply_patch。原生 MCP、视觉、批准和实时 continuation 保持真实入口。普通 CLI 可以在已验证身份、权限和回执一致时由 Context Mode 承载，不能模拟其他组件协议。

Codex MCP 与六个 Hook 使用同一受管 npm 包。请求必须携带原生线程身份；无法验证时明确失败。恢复内容是历史观察，不能覆盖当前指令、授权或 Trellis 任务事实。

工具参数以原生 schema/help 为准。执行子进程可写宿主文件，不应视为操作系统沙箱。不要持久化凭据或未经核验的候选；长任务与跨轮续读沿宿主执行会话。版本更新、安装与撤回由 lifecycle 执行。
