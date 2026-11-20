# 自动发现：评估与运行边界

更新：2026-11-21。固定合成集位于 `backend/tests/fixtures/noteContinuation/cases.ts`：三类正例各四组，十二组反例覆盖伪关联、反证、结束、重复、稀疏、图片、注入、跨账户、修订、删除、额度、故障。

## 已能验证什么

```sh
cd backend
NOTE_DISCOVERY_TEST_MONGO_URI=mongodb://127.0.0.1:27028/nwai_discovery_test_eval npx tsx --test tests/noteContinuationEvaluation.test.ts tests/noteDiscoveryMetrics.test.ts
```

测试调用实际 `NoteContinuationAgent`，替换 provider transport；验证真实工具、完整正文读取、发布、精确引用位置、预算拒绝、发送未知、修订/删除失效、单次去重及硬上限。正例输出是固定结构模板，只验证契约；语义反例的 no_result 也是脚本安排，不能证明模型能识别它们。跨运行去重、反馈撤销、预算结算及租约恢复须同时执行现有 `noteDiscoveryService`、`noteDiscoveryBudgetService`、`noteDiscoveryWorkerStore`、`noteDiscoveryWorker` 测试。缺少隔离 Mongo 时这些数据库测试会 skip，skip 不等于通过。

## 真实模型评估（待另行执行）

本轮未运行付费请求，尚无真实模型通过率或“有继续价值”的结论。后续需明确批准具体模型、核实日期、供应商价格依据及合计人民币预算；密钥只能通过已有受控环境注入。官方价格入口为 [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，需执行前重新核实，不能把 test fixture 的虚构单价用于运行配置。2026-11-21 已对照官方中文价格表核实 deepseek-flash 峰时 cache-miss 输入为 ¥2/百万 tokens，输出为 ¥8/百万 tokens；这只是带日期的参考，不设置默认值，执行前需重新核对。24 组各用满累计 24000 输入/4000 输出的最坏合计为 ¥1.92（未计微元逐次取整）；可在明确批准后使用至多 ¥2.1 的保守批次上限。当前本地日限额配置尚缺，不能执行付费评估。只在单次受控进程中注入核实的价格和批准的用户/全局/预留限额，不改持久 .env 或生产配置。配置须包含精确 priced model、输入/输出单价、匹配的 embedding provider/model/单价、用户/全局日上限及单次预留上限；未知保持关闭。

`backend/scripts/evaluate_note_continuation.ts` 每次仅接收一个固定 case ID，调用同一个真实 worker/runner/provider；仅禁用启动全库扫描及自动到期扫描，确保一次只评估指定的手动任务，授权、租约、工具、结算及发布链不替换。它只连接 `127.0.0.1:27028/nwai_discovery_test_*`，仅植入合成正文。使用专属、固定 batch 数据库，保留其账本；禁止同时启动其他 worker。必须显式设置 `NOTE_DISCOVERY_EVAL_ALLOW_PAID=yes`、`NOTE_DISCOVERY_EVAL_MAX_CNY_MICROS`（批准上限，至多 2100000，即 2.1 元，绝非预计价格）和完整已核实配置。每次执行前检查累计账本及最坏累计输入/输出费用及三次向上取整保护，运行中仍由生产预算服务逐次预留和结算。若批准的上限不足，停止并重新评估计划，不能修改上限绕过批准。

```sh
# 仅在上述授权及受控环境配置齐备后，逐条执行；不要把密钥写在命令里
cd backend
npx tsx scripts/evaluate_note_continuation.ts connection-queue
```

人工先看原始 case，再看输出；逐条记录 grounded / not-restatement / continuation-value 三项是或否及简短理由。每条正例三项全是才通过，无结果计未通过；至少 9/12 正例通过。反例不得出现无依据结论，所有引用逐字逐位置可核对，跨账户泄漏零。生命周期、跨账户、额度、故障六类带 attack 的案例由自动契约套件验证，live 脚本拒绝用自然语言模拟这些存储边界；语义反例逐条跑真实模型。失败时改检索、筛选或提示，再以相同集重评，不增加输出数量掩盖。每条结果核对成本、usage 和终态后才跑下一条；发送未知或账本 blocked 立即停止，不自动重试。

保留合成结果用于人工评审，但普通运行日志不得记录标题、正文、引用或提示。异常退出可能留下 `noteContinuationEvaluationLock` 锁；确认没有进程、无在途请求并完成账本/租约核对后才人工删除锁。不得删库重置已用预算；完成评审后记录总额再按批准清理 scratch 数据库。

## 观测

`npx tsx scripts/report_note_discovery_metrics.ts <ISO起始日期>` 是只读元数据报告，需有目标环境读取授权；本轮未读取生产库。按 createdAt 定义 cohort，最多一万 runs，输出成功/无结果率、p95 执行延迟、已知均价及未知费用次数、同账户重复观察比例、曝光后的继续讨论/保存/否定比例。会话建立计“继续”，并非实际对话轮数。重复指标是发布结果重复率，不能冒充模型候选去重拒绝率。反馈按仍有效且未撤销的唯一 discovery 计数。

目前反馈 enum 没有“认可”动作，因此认可率返回 null；没有否定不能推断认可。需要产品批准新增认可事件后才能真实衡量该项。价格未知绝不按零统计；账本保守结算额与已知 usage 成本分别查看。报告只投影元数据，不收集私人正文；小样本聚合不应作为公开用户统计。

## 架构与上线限制

这是一段自管工具循环：`NoteDiscoveryScheduleService → NoteDiscoveryWorkerStore → NoteDiscoveryWorker → NoteContinuationAgent → tools/provider → publishDiscoveryRun`，不是已接入供应商托管 Agent 框架的证明。工具检索目前是按用户隔离的字面搜索；schema 和启发式验证提供结构、来源和重复约束，无法证明语义关联、反例处理及增量价值正确。真实模型人工验收及托管框架产品表述仍待决定。

运行关闭、恢复、删除及生产发布规则见部署指南；任何本地测试通过均不授权推送、部署或启用收费开关。
