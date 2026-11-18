# Pennix 架构与集成记录

## 当前任务：同步上游 v2.2.1

根任务 codegraph-context-mode-upstream-sync 已批准第 2 版合同，冻结上游为 99c5f38b622c918a9a2abfe8a263a2737623e21b，组件决定及验证见 [upstream-sync-2.2.1.md](../tasks/upstream-sync-2.2.1.md)。拟发行 2.2.1-pennix.1，当前仍在合并验证，不代表已发布或部署。保留既有 Pennix 输出／恢复、身份与 Lifecycle 归属，采用适用的上游修复及 OMP 元数据。

## 前序稳定基线：v2.1.10

当前根任务为 `11-14-workflow-input-growth-context-mode-audit`，组件记录见 `docs/tasks/input-growth-audit.md`。固定上游为 `v2.1.10`、提交 `4bffb4283bf2198b959062192882a8f33655c8d0`；采用保留双亲历史的普通合并。发行目标为 `@pennixrv/context-mode@2.1.10-pennix.1`、`beta` 通道和同版本 v 标签，实施和验收事实以根任务 execution.md 为准。原稳定基线为 v2.1.5（`157464a3f47b9c5e2e068a800b3490ffca67aab2`）。

本轮 batch 逐项退出与未执行状态独立于查询筛选；混合/未完成结果在现有 journal 中保持未知，完整全零才是整体成功。超时/取消保留已取得的诊断输出，长状态列表以独立索引来源恢复。具名来源无匹配后按位置返回必须明确标注 fallback，不能冒充命中。这些有意变更替代旧 D-BATCH-FRAMING-1 的无状态短回复及无标记来源回退；工具输入和数据库 schema 不变。

退出后的 drain 定时器在判断 held 前必须让待处理 I/O 获得一次 poll；新到数据重置 idle 判断，真实 EOF 不冒充后台持管道。原最大 drain/取消界限保留。doctor 对附加透传探针核对成功退出、取消和 held 状态，再解释正文；空结果不证明探针成功。此合同由可控计时器/pipe 顺序回归及真实子进程正反例共同验证。

运行架构、工具 API、共享数据根 `~/.context-mode`、项目共库、journal、2048 字节恢复状态、seq 原文、自动淘汰及数据库自愈遵循上游。旧 rollout 事件补采、session-events 投影、8192 字节恢复及主动索引永久保护均不迁入。原始 Codex 历史和独立 memories 保留。

必要差异限定为 scoped 发行身份、Codex 原生线程元数据核验、submodule 项目解析、未知结果的真实报告和 Lifecycle 安装归属。Codex 每次 MCP 调用使用实际 threadId，核验唯一 rollout 的首条 session_meta；不采集后续事件。Codex 0.167.0 的原生 Bash Hook 只给出正文时，journal 保留正文并将结果留为未知，不能据此标记成功或恢复错误状态。

安装、更新、卸载、MCP、四类 Hook/trust 和三个命令 Skill 由 Pennix Lifecycle 负责。`setup --print codex --json` 使用上游 registry、本地 hash/path 计算，输出声明式计划；不启动 Codex 探测。Lifecycle 校验成员、路径、归属及合并后的 trust 位置后写入，并由真实宿主核验。完整 setup、upgrade、remove、repair 和 dry-run 入口仅返回 owner 指引；doctor 的配置交互修复关闭，数据库自愈保留。独立的 Pennix Context Mode 集成 Skill 由集合 owner 移除。

新设备部署任务`11-15-fresh-device-lifecycle-deployment`补充原生doctor的幂等核验，组件记录见[docs/tasks/fresh-device-hook-idempotence.md](../tasks/fresh-device-hook-idempotence.md)。JSON对象键顺序不同不改变Hook身份；比较相同自有项时保留原位置，避免移动后置外来Hook并改变Codex信任索引。发行目标为`2.1.10-pennix.3`、beta通道。该修复不修改用户配置或代替Lifecycle写入信任。

Pennix 验收目标为 Linux/WSL、Codex 0.167.0、Node.js 24.15.0 及 26。上游多宿主实现和测试保留，涉及上游自行安装、改写发行分支或维护统计的 CI 只在上游仓库运行；fork 使用独立的现有 CI job 和 tag 发布 job。最终提交固定后构建 release-out，本地与 CI 各自构建；CI 只 pack 一次，验证该 tarball 后发布，不声称两次构建的字节相同。

旧数据维护入口为一次性 `node scripts/cleanup-v1-data.mjs`，默认只读预览；仅在核验旧 writer 已退出后，使用当前预览 digest 执行。脚本只识别 `${CODEX_HOME:-$HOME/.codex}/context-mode` 下的已知 v1 布局/schema，拒绝链接、未知文件、活动占用、变更或并发清理。失败和未知对象保留，不自动清理其他数据根，也不创建旧索引备份。Linux 进程检查是关闭现场的必要证据，不能消除任意外部写入竞态；维护窗口中不得再启动旧宿主。

## 全组件体检整改：执行保真和有界恢复

根任务workflow-health-remediation-release-deploy已获整体实施批准，组件记录见[docs/tasks/workflow-health-remediation.md](../tasks/workflow-health-remediation.md)。本轮保留上游稳定基线，选择性修复HA03/13/21/22/23/24/41，不用整包升级替代针对性验证。

stdout和stderr无论退出码均保留，stderr显式标记。超时／取消且已有输出时先保存诊断再返回不完整状态；ctx_execute和run-wrapper不把停止后的命令标成正常退出。单命令stdout＋stderr共享16MiB采集预算，超过后停止进程组、停止采集并明确输出不完整，回复仍遵守原OUTPUT_CAP。若超限发生在timeout／cancel之后，保留首个停止原因并额外标记采集到达上限；不完整UTF-8尾部不产生伪替换字符。原始完整历史不因回复或资源限额被删除。

ctx_resume的默认状态查询在SQLite内先按原有每节MAX_CANDIDATES选择最新请求、未解决错误、编辑、决定和索引候选，保留全历史重复计数，然后复用原buildCandidates／renderState的打分、总量上限和字节选择。各查询绑定首次观察的最大seq，避免跨进程追加混入同一恢复快照；不把最近固定窗口误当完整状态。最多读取5×MAX_CANDIDATES＋2行，不读取无关命令body；直接seq读取仍返回原始完整body。该上限约束候选行数，不是单条body、SQLite物理空间或查询扫描成本上限。

500MB／30天只描述原生清理实际覆盖的对象，不能当成全部事件、活跃会话或数据库文件大小的硬上限；没有本轮实证泄漏就不引入活跃数据删除。ctx_doctor MCP可以自愈数据库、写报告和索引大报告，不能称为只读；严格只读检查使用原生context-mode doctor CLI。Skill和工具提示不自动授权执行Fix，fork可达更新建议及v1停止脚本均指向Lifecycle。

定向回归已验证成功stderr检索、timeout诊断、共享采集上限、UTF-8、ELOOP候选跳过、更新路线与v1不写入。合成恢复样本1855行投影到363行，候选、计数和最终渲染与原全量读取完全相等，另验证并发追加不改变原快照。四个相关测试文件570项，568通过、2项Windows条件跳过、0失败；全套与发行／安装验收尚待后续记录。

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
