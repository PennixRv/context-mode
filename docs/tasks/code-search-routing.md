# 代码检索路由与项目外读取

根协调任务：`codex-workflow-optimization/.trellis/tasks/10-21-code-search-routing-convergence`。用户已明确批准该四 owner 完整方案并要求持续到唯一停止点；本仓库只维护 Context Mode 共享路由、文件工具说明、既有测试及正式发行，分支 main，基线 d68acdf90b98be359a88792f060214bc98ab28f0。

最小行为差异：Read 指引不再把项目外指令推向受限文件入口；执行／批量和内容回查不冒充专用检索来源或原生 MCP 调度。目标为 hooks/core/routing.mjs、hooks/routing-block.mjs、src/server.ts 及对应既有领域测试。复用现有 containment 判断，外部 Read 透传只是停止无效建议，不授予读取权限；普通数据的显式 allow／deny 保持原合同。

先补失败回归，再修共享入口；完成完整测试、typecheck、build／bundle／drift、版本 manifest 与正式 npm beta 制品检查。基线 1.0.169-pennix.11，新版本按远端实际占用确定，不覆盖 tag。根通过 Lifecycle 原生更新，必要 repair 后验证真实六 Hook／MCP；不手改缓存或强杀进程。身份、留存、取消、超时和既有修复保持原状。

唯一完成停止点沿根设计，源码绿色、发布、安装或等待重连都不是独立完成点。失败记录首个结果、当前阶段及唯一续点；根负责跨组件集成、全局模板、归档和最终 gitlink。本文件继续记录本 owner 动态实施证据。

## 本地实施证据

候选版本 1.0.169-pennix.12 经远端 tag／registry 不占用检查后由 npm version 和 version-sync 更新。共享 Read 分流先以两个边界回归证明失败，再复用安全模块的 containment 判断修复；外部原生读取仅停止错误建议，不改变授权。项目内读取和既有 allow／deny 由原合同继续检验。

定向路由／节流 151 项通过。首次完整测试继承 Codex 宿主标识，出现原生 threadId 等 74 项失败；按前序隔离合同仅从测试子进程移除宿主标识，并修正旧测试的项目外虚构路径及不再成立的网页转交预期。产品身份验证未修改。完整 npm test 最终 4506 通过、30 跳过、0 失败；typecheck、原生 build／bundle／drift 断言通过。

原生 npm pack 的同一本地 tarball 经 verify-tarball 验证通过：独立 HOME／prefix 安装、版本、bin 归属、现有主机文件保持、真实隔离 Codex CLI／app-server MCP 身份及恢复均通过。npm JSON 解析临时脚本最初按数组处理包名键控对象失败；核对实际输出后继续验证唯一生成的 tarball，未改变产品。正式发布、registry 制品及当前真实宿主验收仍待执行，不能以隔离宿主替代。

源码提交 e81da3b817c7d5e368eafc545fd88c00aa098096 已推送 main。官方 CI 39525583329 与 tag v1.0.169-pennix.12 的 publish 39525599810 均 success，发布流水线再次验证其实际 tarball 的隔离 Codex 原生入口。registry 初次 E404 经原发行传播后解除，没有重发；正式包 SHA-256 83aebabeb6609df37164999f09827cef63b39cc648f5fd3b1e53cb8622f7aae2，与官方日志完全一致，SHA-512 SRI 为 sha512-ASBEGivwQPLyjTh4RC08Ssdrvm2rcNyYOUO2ivBSZ7l1yXPbe5LMiyg2AgPaVap0n+f+qHCAafXCGJmi0YRXrg==。目标共享 Hook、两个 bundle、六 Hook manifest 与 package.json 逐字节等于验收源码；src/server.ts 按既有 files 声明不发源码，核验其实际编译／bundle 交付。原生安装与当前真实宿主验收仍由根继续，owner 尚未收尾。

根已通过 Pennix Lifecycle 原生更新到 `1.0.169-pennix.12`，更新候选 SHA-256 与上述正式 npm 包一致；安装后 CLI 自报 `.12`，Lifecycle `repair context-mode` 返回原生修复成功。Context Mode doctor、服务端测试及 Lifecycle check 均通过，但当前驻留 MCP 自报 `.11`，表明活动宿主尚未加载新包。npm 12 阻止无授权的 `postinstall` 执行；该脚本只作版本提示，CLI 本身可运行，未修改 npm 脚本信任设置。真实驻留 MCP/Hook 验收由根在宿主重载后续做。
