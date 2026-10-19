# Pennix Context Mode

本仓库基于 [mksglu/context-mode](https://github.com/mksglu/context-mode) 的 `dad48de75686389612bba9ef842e459ee38134cd`，面向 Pennix 工作流提供 Codex stdio MCP、六类原生 Hook、有界执行、FTS5 索引和本地会话恢复。npm 包为 `@pennixrv/context-mode`，命令及 MCP 工具名称沿用 `context-mode`、`ctx_*`。

## 安装与接入

要求 Node.js 22.5 或更新版本。执行代码所需的 Python、shell、rg 等运行时由环境准备；列出的其他语言不表示会自动安装其工具链。

Pennix 用户通过 `pennix-component-lifecycle` Skill 导航到独立 `pennix` 工具，由其管理固定 npm 版本、用户 prefix、Codex MCP 和六类 Hook。只采用这一套接入，不叠加 Codex plugin。包安装与 Hook 启动均不创建或改写用户 AGENTS.md；模板更新由 lifecycle 管理。

仅手动安装程序时可使用：

```sh
npm install --global --prefix "$HOME/.local" @pennixrv/context-mode@beta
context-mode doctor
```

这不会配置宿主。正式工作流使用 lifecycle catalog 固定的版本；不要用程序安装代替 MCP、Hook 与归属验收。本 fork 不提供自更新命令或工具。

## 执行与数据边界

- `ctx_execute`、`ctx_execute_file` 用代码处理文件或执行非交互命令；`ctx_batch_execute` 会索引命令输出。工具帮助是参数和输出限制的准确来源，检索命中不表示已读全文。
- `ctx_index`、`ctx_search` 管理明确来源的索引；`ctx_fetch_and_index` 会将网页内容持久化。凭据和未经核验的外部代码候选应沿其原生入口处理，不能自动索引。
- Codex 请求以原生 `_meta.threadId` 定位且验证唯一 rollout 元数据，Hook 使用相同的 `session_id`。缺失或歧义时明确失败，不猜测最新会话。
- Codex 执行默认期限为 120 秒；RPC 取消传至子进程树。Codex 不支持脱离的 background 模式，长任务与跨轮续读保留宿主执行会话。实际退出码、错误、超时和部分输出需要分别检查。
- 子进程能对宿主文件产生副作用，执行器不等于操作系统沙箱，也不替代 Codex 原生批准或权限。语义编辑、宿主 MCP、视觉和实时 continuation 保持各自入口。

## 本地会话与清理

默认数据根是 `${CODEX_HOME:-$HOME/.codex}/context-mode`，包含 `sessions`、`content` 及组件诊断数据。显式绝对路径 `CONTEXT_MODE_DIR` 可覆盖组件数据根；不会迁移旧目录、改写其他组件目录或读取 Codex 长期 memory。

六类 Hook 采集本地会话事件并提供恢复材料，不向上游平台自动同步。恢复的规则和角色属于历史证据；当前指令、授权和 Trellis 原生任务状态保持权威。完整提问和规则可能含敏感内容，数据目录和文件采用私有权限；有限字段处理不保证任意文本脱敏。

Codex 的 compact/resume 只恢复一份有界摘要，最终 `additionalContext`（含路由与查询指引）不超过 8192 个 UTF-8 字节。已采集且仍在保留范围内的事件正文通过 `ctx_search` 的 `session-events:<当前线程 ID>` 来源查询；自动恢复投影按线程隔离，主动索引继续按项目共享。摘要不会回放旧快照正文。原生命令成败由已落盘的关联结果确认，未知状态保持未知，不根据输出中的“failed”判断成败。

未活动 30 天的会话及可证明归属的自动采集派生数据会清理，当前会话受保护。普通主动索引和 Codex 原始历史保留。显式 `ctx_purge` 必须给出 `confirm: true` 及 `scope: "session"` 或 `scope: "project"`；session 范围只允许当前核验线程。程序卸载与数据清除分别执行。

修复历史超大恢复缓存时，先对项目的规范绝对路径执行只读预览：

```sh
context-mode recovery --project /absolute/canonical/project --json
context-mode recovery --project /absolute/canonical/project --apply --expected-digest <预览的 digest> --json
```

应用只删除该项目已消费且超过 8192 字节的恢复快照；保留未消费快照、原始事件、有效索引和用量。摘要或归属变化则整批拒绝并重新预览。报告区分逻辑移除字节和数据库文件大小，不强制压缩数据库。

## 维护与验证

```sh
npm ci
npm run typecheck
npm test
node scripts/verify-codex-host.mjs
npm pack
```

原生宿主验证要求 Codex 0.163.0，使用隔离 HOME/CODEX_HOME 和本地模拟模型响应，实际贯通 CLI、app-server、MCP、六类 Hook 的原生信任、命令成败、压缩与恢复检索；不读取用户认证、不请求真实模型。发布工作流验证后只发布同一个 tarball，使用 `beta` 标签。上游其他宿主代码保留，当前 Pennix 支持范围以 lifecycle 和集成 Skill 的合同为准。

上游通用实现说明见 [原始仓库](https://github.com/mksglu/context-mode)。本 fork 的维护差异与验证记录见 [docs/pennix-integration.md](docs/pennix-integration.md)。

## 许可与归属

原作者为 Mert Koseoğlu。本 fork 保留原作者声明和 [Elastic License 2.0](LICENSE)；请阅读许可证后使用或分发。
