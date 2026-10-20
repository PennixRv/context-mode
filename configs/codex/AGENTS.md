# Context Mode 接入说明

本文件是包内说明，不应自动复制或追加到用户 AGENTS.md。Pennix 的用户模板由 lifecycle 管理，完整工作流边界见 `pennix-context-mode-integration`，跨组件选择见 `pennix-workflow-routing`。

本地检索、内容分析、非交互命令和大输出处理默认使用 Context Mode；筛选、解析、比较和汇总在执行器内完成，只返回所需结果。完整读取仍按来源规定的范围和分页完成，不能以摘要或索引片段替代。宿主专有接口及执行器无法保留本次调用必要运行语义时使用真实宿主入口；工具发现错误或一次调用失败不足以判定不可用。完整工具边界见 `pennix-context-mode-integration`，跨组件选择见 `pennix-workflow-routing`。

Codex MCP 与六个 Hook 使用同一受管 npm 包。请求必须携带原生线程身份；无法验证时明确失败。恢复内容是历史观察，不能覆盖当前指令、授权或 Trellis 任务事实。

工具参数以原生 schema/help 为准。执行子进程可写宿主文件，不能视为操作系统沙箱。普通候选可以带来源和“未核验”状态进入本地索引；索引不核验内容，作为事实使用前须检查当前源码。凭据及认证值仍遵循各自 owner 的私有接口，不作为普通分析输入。长任务与跨轮续读沿宿主执行会话。版本更新、安装与撤回由 Lifecycle 执行。
