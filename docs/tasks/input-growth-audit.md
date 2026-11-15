# 输入增长与 Context Mode 定向修复

根协调任务：`11-14-workflow-input-growth-context-mode-audit`。用户已批准实施至正式发布、Lifecycle 部署重装、新版本进程验收和根集成收尾。当前组件沿已有 main 维护，不建立分支或工作树。

基线为 `9e75d43d8d0da015c9b1dffc214b962a595c4f38`；普通合并固定上游 v2.1.10（`4bffb4283bf2198b959062192882a8f33655c8d0`）。保留 scoped 发行、Lifecycle 唯一配置 owner、Codex 线程核验、submodule 边界和未知结果不冒充成功等 Pennix 不变量。

本轮修改 batch 逐项状态与 journal 未知语义、具名来源无命中的显式位置回退，以及工具说明的首次输入和总输出预算。工具输入与数据库 schema 不变，不引入依赖。正常非零退出继续执行，非零的业务含义仍由调用者判断；部分批次和混合结果不能解除先前错误。

验证覆盖逐项退出/中止/未执行、状态预算和全文恢复、真实命中/回退/未知来源及分页、journal/恢复、上游原生修复和 Pennix 不变量。运行类型检查、单元测试与静态门禁，绑定同一 tarball 的原生 Codex 本地确定性 fixture 和 Lifecycle 临时 home 验证。正式制品发布后回读核验并通过 Lifecycle 更新当前安装；不调用公网模型收集费用样本。

实际提交、冲突处置、制品和验证结果沿本文件及根任务 execution.md 续记，不能用计划代替完成事实。

## 验证与集成说明

完整单元门禁已取得 2964 项中 2919 通过、45 项按环境或既有平台限制跳过、0 失败；跳过项不代表平台支持。当前主机实际 Codex 0.169.0 的 CLI、app-server、原生输出保留、压缩后 resume 检索在本地确定性 fixture 通过。prompt lint 与静态门禁通过，原生 gate 的测试入口改为与 CI 相同的 glob，以兼容 Node 24。

Lifecycle 临时 HOME（含中文与空格）首次拒绝上游新增的计划 env，因为原生 owner 已独立注入 CODEX_HOME/PATH。修复仅位于本包 `setup --print codex` 的只读计划边界，保留原计划字段；上游 registry 与独立 engine 的 env 修复保留。新增自定义 HOME 原文/路径及不写文件的回归通过。相同候选 tarball 的 Lifecycle install、四 Hook 的真实 trust、no-op、外来配置保留、unconfigure 和 uninstall 全部通过；最终正式制品仍须重新绑定摘要验收。

独立 Pennix Skills 的现有来源/载体路由足以覆盖本轮，未增加重复说明或修改安装集合。本轮没有 Lifecycle 源码、数据库 schema、工具输入或依赖变化。已知上游生成插件与来件夹具包含原有空白告警，不修改生成代码中的字符串空白；本轮自定义源码差异的 whitespace 检查通过。

CI 的 D5 假成功进一步暴露进程退出后 EOF 宽限计时器与待处理 pipe I/O 的竞态。可控调度回归在修复前实际取得空 stdout，修复后保留 `queued final bytes`：计时器先让出一轮 I/O poll，期间新数据会使旧 idle 判定失效；两条流都已 EOF 时直接完成，不误标 held。原 250 毫秒空闲宽限、2000 毫秒最大 drain 与取消上限均保留。52 项定向检查同时覆盖正常尾部、后台后代、超时/取消、D5 原生 deny 和附加探针成功/失败。D5 不再丢弃附加探针 RunResult，空输出只有在成功且传输完整时才代表透传；不存在以忽略传输状态换取 PASS 的回退。
