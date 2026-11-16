# 全组件体检中的 Context Mode 整改

最终帮助入口复核补充：.4 实际写入与升级入口已经拒绝绕过 Lifecycle，但主帮助和 setup／doctor／upgrade 子帮助仍保留原生写入、npm 升级与 doctor 交互修复描述。继续在同一 HA13／21 范围修正所有帮助，明确只读与 owner_required，真实构建 CLI 的四个帮助入口新增语义反例并更新原生输出快照；不得只让旧 golden 继续自证。最终补丁发行 .5，双机必须通过新公开载荷更新及真实 repair，真实模型预算不重复使用。

再次完整gate还发现HA41的保留原生GP11消费者仍断言止损信息必须推荐无scope npm命令。此用例会git clone当前已提交HEAD，所以原先在修改尚未提交时运行通过不能证明新止损分支的组合：.4提交后本次首次准确失败。修正该E2E为明确Lifecycle路由并拒绝原生npm建议，保留真实1.0.169包、旧树不被覆盖和隔离新载荷安装的断言；没有放宽止损或把失败删掉。

根任务workflow-health-remediation-release-deploy已获整体实施批准，绑定前置方案revision `40ef9f74eea199e3eefbf9269dff342374ab556d73590785b4a68cf3b234fccf`。本仓沿main和既有beta发行，不另建分支／工作树，不修改用户安装、秘密或运行数据库。最终在根统一完成测试、提交推送、发布、本地先行、目标部署与原生重装。

## 范围与最小修改

HA03/13/21/22/23/24/41：不可读PATH候选不中断查找；成功stderr与超时／取消已捕获诊断保留；stdout/stderr共享16MiB采集上限，超限停止受管子进程并明确不完整；doctor副作用及严格只读入口准确，所有更新提示回Lifecycle；resume在装载前有界，清理限制不冒充活跃数据库上限；v1止损保持失败退出及旧安装不被覆盖。

先修改sandbox/runtimes、spawn、contracts常量／错误及execute/batch/run-wrapper调用方，复用现有错误、索引和来源指针。结果保持原始退出与停止原因区分，输出限额不静默报成功，UTF-8截断不制造伪字符。后续doctor／resume及文档在同一任务记录。原生支持能力、数据库schema和工具输入不为局部修复重构。

## 验证与交付

使用现有prd9-sandbox隔离项目与数据库fixture，补成功stderr、超时诊断检索、输出超限／进程退出、UTF-8边界和坏PATH正反例；覆盖所有RunResult消费者。先定向测试，再typecheck及owner完整gate／发行载荷。真实服务／模型预算属于根任务，当前未使用。

发布前通过原生版本工具设置未占用发行身份、登记本任务精确路径到tracked-tree白名单；不放宽任意文件准入。源码、测试、构建、公开载荷与实际安装分别记录，不把本任务计划当作已通过。

## 当前验证

执行／诊断／恢复／v1四文件570项，568通过、2项Windows条件跳过、0失败；typecheck通过。原先的无限洪流超时夹具会先撞上新增16MiB限额，已降低输出速率使它继续专门验证timeout，独立共享限额测试验证另一停止原因，没有放宽原超时断言。

默认resume在数据库中分组选择原候选并保留全历史计数，候选／渲染函数继续拥有打分和总上限。1855行合成历史只返回363行，输出与原全量计算一致；旧未解决错误不会因最近成功尾部被漏掉，seq原文读取保留，另验证并发追加不混入先前快照。查询限制行数，不声称限制SQLite扫描成本、单条body或数据库物理大小。

MCPdoctor保留原生自愈能力与readOnly=false，但源Skill／工具提示／文档明确副作用，严格只读使用原生CLI，不自动执行Fix。host更新建议改为Lifecycle，v1失败指引不再推荐无scope原生包；generated prompt经原生build --generated-only生成。

最终 `node scripts/gate.mjs --all --quick` 退出0：单元2975项中2930通过、45项既有条件跳过，ci-checks、M7端到端、prompt-lint、check-removed均通过；live明确跳过，部署后按根预算验证。新增公共输出限额黑盒通过；500MiB索引限额仍经32个低于采集上限的子命令实测，没有降低索引负载或放宽断言。CLI六份doctor Skill快照、工具描述长度和stderr快照均由实际原生输出更新，其他描述保持。通过原生setVersions设置候选2.1.10-pennix.4，远端tag及npm该版本未占用；发行与真实安装仍待根W08—W11。
