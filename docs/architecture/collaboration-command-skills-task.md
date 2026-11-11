# 协作宿主命令 Skills 修订任务

关联 `codex-workflow-optimization` 根任务 collaboration-tool-capability-audit 的第 11 版已批准合同 WP2a；本仓库工作分支为 fix/collaboration-role-host-boundaries，维护目标 main，基线 f5ce5e614af8e4a86e230244201b14322f0f64af。

本包只修共享 ctx-doctor、ctx-stats、ctx-upgrade 的 Copilot 原生工具名与宿主说明，并在现有 setup 测试中覆盖共享渲染和私有通道一致性。不改变 Context Mode 会话、存储或清理协议，不创建另一份工作流。双会话与同名来源/回退的真实验证由根任务集成；发现归属缺陷时在本 owner 修复，新的身份协议另回根方案判断。

验收：共享内容包含 Codex 与 Copilot 各自原生工具名，私有渲染维持准确名称，现有 setup 相关测试及 typecheck 通过；准备固定来源供 Lifecycle 引用，源码检查不代表现场安装通过。

## 共享命令的宿主边界

`~/.agents/skills` 中的三个命令 Skill 同时列出 Codex、VS Code 和 Copilot CLI 的工具名称；调用时必须选择当前宿主实际声明的工具。Copilot CLI 私有目录仍只渲染自己的工具名，未改变其配置、Hook 或同名 Skill 的原生发现顺序。自定义 `COPILOT_HOME` 继续由原生路径解析处理。

## 发布检查修正

首个候选 `2.1.5-pennix.5` 的公开 CI 检查发现，本说明原路径不在仓库目标树白名单内。将说明移至既有 `docs/architecture/`，保持仓库卫生门禁；修订候选为 `2.1.5-pennix.6`，保留旧 tag，不覆盖发行身份。此次修订仅调整文档位置、发行版本及先前已准备的固定 tag dispatch，不修改运行时实现或身份协议。

`pennix.6` 的版本递增遗漏源树插件 manifest，公开 CI 的两项版本检查拒绝发布。最终修订使用原生 `scripts/release/dev-version.mjs` 的 `setVersions` 同步全部五处版本来源为 `2.1.5-pennix.7`，完整本地门禁通过后再发布。保留前两次失败，不修改版本检查或旧 tag。

## 原生 Copilot 会话归属修复

`pennix.7` 已公开安装并能被两个 Teamwork 宿主调用，但现场标记核验发现 Copilot Hook 使用原生会话 ID，MCP 仍回退到 `mcp:<serverId>`。有界原生探针确认 Copilot CLI 1.0.107 的 MCP `_meta` 只有 progressToken；同一 ACP 进程中两个并发会话分别通过 `COPILOT_AGENT_SESSION_ID` 和 `COPILOT_SESSION_CWD` 向各自 MCP 子进程提供准确的原生会话 ID 和工作树，值与 session/new 回执一致。

按根合同的归属缺陷处置，在既有 HOST_SESSION_ENV 映射中补齐 Copilot 原生字段，保持 `_meta.sessionId` 优先、其他宿主及缺省回退规则不变。不读取最近会话、不新增身份文件或协议、不扫描宿主历史；增加优先级、空值、跨宿主及真实双 MCP 连接回归。修订候选为 `2.1.5-pennix.8`，重新公开发行、原生安装并以实际 Hook/MCP 标记复核后才能接受。

旧版已写入的 `mcp:*` 分区保留，不自动归并到某个原生会话。原生环境字段的现场支持证据限于上述 CLI 版本，缺失字段时仍使用既有回退，不按进程或文件时间猜测身份。
