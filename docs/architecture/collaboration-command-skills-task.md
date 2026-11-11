# 协作宿主命令 Skills 修订任务

关联 `codex-workflow-optimization` 根任务 collaboration-tool-capability-audit 的第 11 版已批准合同 WP2a；本仓库工作分支为 fix/collaboration-role-host-boundaries，维护目标 main，基线 f5ce5e614af8e4a86e230244201b14322f0f64af。

本包只修共享 ctx-doctor、ctx-stats、ctx-upgrade 的 Copilot 原生工具名与宿主说明，并在现有 setup 测试中覆盖共享渲染和私有通道一致性。不改变 Context Mode 会话、存储或清理协议，不创建另一份工作流。双会话与同名来源/回退的真实验证由根任务集成；发现归属缺陷时在本 owner 修复，新的身份协议另回根方案判断。

验收：共享内容包含 Codex 与 Copilot 各自原生工具名，私有渲染维持准确名称，现有 setup 相关测试及 typecheck 通过；准备固定来源供 Lifecycle 引用，源码检查不代表现场安装通过。

## 共享命令的宿主边界

`~/.agents/skills` 中的三个命令 Skill 同时列出 Codex、VS Code 和 Copilot CLI 的工具名称；调用时必须选择当前宿主实际声明的工具。Copilot CLI 私有目录仍只渲染自己的工具名，未改变其配置、Hook 或同名 Skill 的原生发现顺序。自定义 `COPILOT_HOME` 继续由原生路径解析处理。

## 发布检查修正

首个候选 `2.1.5-pennix.5` 的公开 CI 检查发现，本说明原路径不在仓库目标树白名单内。将说明移至既有 `docs/architecture/`，保持仓库卫生门禁；修订候选为 `2.1.5-pennix.6`，保留旧 tag，不覆盖发行身份。此次修订仅调整文档位置、发行版本及先前已准备的固定 tag dispatch，不修改运行时实现或身份协议。
