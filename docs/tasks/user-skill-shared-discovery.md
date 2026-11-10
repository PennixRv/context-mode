# 用户 Skill 共享发现入口

根任务：`codex-workflow-optimization/.trellis/tasks/in_progress/11-09-user-skill-placement-governance`。已批准实施，基线 `5db22925549204b898bde7fcabede1d64f8042f2`；由当前会话直接实施。

Codex 的命令 Skill 使用原生 `.agents/skills` 共享通道，与 VS Code 共用渲染结果；配置和 Hook 继续按宿主配置根解析。setup 仅退役可证明由本组件生成的旧 Skill，修改或未知内容拒绝接管；doctor 显示旧路径重复。共享卸载保留其他宿主仍需使用的产物，无法确认时保留并说明。

修改 adapter、registry/setup/doctor/uninstall 和相关测试，不新增注册表或 Skill。执行领域测试、typecheck、原生产品门禁与发行构建，按现有 npm 发布流程正式发布；Lifecycle 固定及真实部署由根任务协调。正常停止点为来源、正式包、安装态、原生发现和根集成一致。

2026-11-10：共享通道、双宿主工具名、旧副本退役、回滚及保守卸载已实施。完整 M7 quick 门禁通过：单元 2798 项中 2756 通过、42 项按原生环境条件跳过；CI 检查、GP 用例、提示词检查及移除检查通过。随后补充断链拒绝与卸载范围保护，typecheck 和领域 33 项再次通过（28 通过、5 项 Windows 检查跳过）。发行版本为 `2.1.5-pennix.2`，正式发布及安装后的真实证据由根任务补录。
