# 新设备部署中的 Codex Hook 幂等核验

根任务11-15-fresh-device-lifecycle-deployment已授权相关组件真实缺口在实现阶段修复、测试、提交推送与发布，先在home验收，再部署PennixLaptop。Context Mode沿既有main和beta发行，不改上游仓库。

Lifecycle检查已通过，但Context Mode原生doctor对Codex判not set up。当前Hook由Lifecycle按原生计划合并，保留AOE等外来Hook与Codex真实信任索引。Context Mode的mergeOwn用JSON.stringify比较对象，将键顺序不同但语义相同的自身Hook删除后追加，造成SessionStart顺序及trust索引变化。

最小修复位于src/setup/engine.ts的自有项比较，使用Node标准深度相等保持JSON对象语义。回归在tests/0020-hooks-all.test.mjs构造键顺序变化、后置外来Hook及独立信任；要求doctor无变更、无文件写入、外来信任不变。版本身份、构建载荷与发布流程按现有owner推进。源码不改用户配置、Hook注册或信任；运行态不复制进Git。

验证：同一反例修复前失败，修复后通过；typecheck通过。完整源码测试2969项，其中2924通过、45按既有条件跳过、0失败。版本清单由原生setVersions统一写入2.1.10-pennix.2。实际tarball、本地安装和公开发布证据在根任务记录，真实模型与检索预算未使用。
