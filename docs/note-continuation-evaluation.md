# 自动发现：评估与运行边界

更新：2026-11-21。固定合成集位于 `backend/tests/fixtures/noteContinuation/cases.ts`：三类正例各四组，十二组反例覆盖伪关联、反证、结束、重复、稀疏、图片、注入、跨账户、修订、删除、额度、故障。

## 已能验证什么

```sh
cd backend
NOTE_DISCOVERY_TEST_MONGO_URI=mongodb://127.0.0.1:27028/nwai_discovery_test_eval npx tsx --test tests/noteContinuationEvaluation.test.ts tests/noteDiscoveryMetrics.test.ts
```

测试调用实际 `NoteContinuationAgent`，替换 provider transport；验证真实工具、完整正文读取、发布、精确引用位置、预算拒绝、发送未知、修订/删除失效、单次去重及硬上限。正例输出是固定结构模板，只验证契约；语义反例的 no_result 也是脚本安排，不能证明模型能识别它们。跨运行去重、反馈撤销、预算结算及租约恢复须同时执行现有 `noteDiscoveryService`、`noteDiscoveryBudgetService`、`noteDiscoveryWorkerStore`、`noteDiscoveryWorker` 测试。缺少隔离 Mongo 时这些数据库测试会 skip，skip 不等于通过。

## 真实模型评估

[第四轮验收](verification/2026-11-21-note-continuation-native-acceptance.md)通过固定合成集，11/12 个正例达标，6 个语义反例均正常无结果，20 条引用逐字匹配。此前的[基线](verification/2026-11-21-note-continuation-live-baseline.md)和[第二轮](verification/2026-11-21-note-continuation-live-retest.md)分别为 3/12 和 5/12。四轮沿用同一个 ¥2.10 批次，累计保守计费 ¥0.695690。更换模型或主要提示时应复跑同一套验收。

费用使用已获批准的批次上限，密钥只能通过已有受控环境注入。2026-11-21 对照 [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 核实 deepseek-flash 高峰缓存未命中输入为 ¥2/百万 tokens，输出为 ¥8/百万 tokens。执行前复核，测试单价不可用于运行。首轮上限 ¥2.10，进程级配置未写入 `.env` 或生产环境。配置须包含匹配的模型、单价，以及用户、全局和单次预留限额；未知保持关闭。

`backend/scripts/evaluate_note_continuation.ts` 每次仅接收一个固定 case ID，调用同一个真实 worker/runner/provider；仅禁用启动全库扫描及自动到期扫描，确保一次只评估指定的手动任务，授权、租约、工具、结算及发布链不替换。它只连接固定专用 `mongodb://127.0.0.1:27028/nwai_discovery_test_live_evaluation`，拒绝其他合法测试后缀，仅植入合成正文。首次运行在固定数据库写入不可变批准记录（审批标识、价格核实日期、模型、价格、限额、执行上限及密钥指纹，不含明文密钥），后续参数改变即拒绝；不得更换数据库或删除批准/账本重置费用。禁止同时启动其他 worker。必须显式设置 `NOTE_DISCOVERY_EVAL_ALLOW_PAID=yes`、`NOTE_DISCOVERY_EVAL_MAX_CNY_MICROS`（批准上限，至多 2100000，即 2.1 元，绝非预计价格）、`NOTE_DISCOVERY_EVAL_APPROVAL_ID`、`NOTE_DISCOVERY_EVAL_PRICE_VERIFIED_AT=YYYY-MM-DD` 和完整显式已核实配置（包括 DeepSeek key、模型、所有单价及限额、embedding provider/model）。配置导入前逐项核验，评估进程设置 `NOTE_DISCOVERY_EVAL_PROCESS_ONLY=true` 跳过项目根 `.env`；无关认证/邮件配置使用固定合成占位值，不读取真实凭据。每次执行前检查累计账本及最坏累计输入/输出费用及三次向上取整保护，运行中仍由生产预算服务逐次预留和结算。若批准的上限不足，停止并重新评估计划，不能修改上限绕过批准。

```sh
# 仅在上述授权及受控环境配置齐备后，逐条执行；不要把密钥写在命令里
cd backend
npx tsx scripts/evaluate_note_continuation.ts connection-queue
```

人工先看原始 case，再看输出；逐条记录 grounded / not-restatement / continuation-value 三项是或否及简短理由。每条正例三项全是才通过，无结果计未通过；至少 9/12 正例通过。反例不得出现无依据结论，所有引用逐字逐位置可核对，跨账户泄漏零。生命周期、跨账户、额度、故障六类带 attack 的案例由自动契约套件验证，live 脚本拒绝用自然语言模拟这些存储边界；语义反例逐条跑真实模型。失败时改检索、筛选或提示，再以相同集重评，不增加输出数量掩盖。每条结果核对成本、usage 和终态后才跑下一条；发送未知、未结算/保留额非零、未知 usage 或账本 blocked 会以安全错误码及费用摘要终止，下一次调用跨合成账户和日期仍拒绝，不自动重试。完成态只输出当前 generation 发现，包含 kind 和 quality rationale。笔记标题为中性“记录 N”，不向模型透露 case ID/rubric。

保留合成结果用于人工评审，但普通运行日志不得记录标题、正文、引用或提示。异常退出可能留下 `noteContinuationEvaluationLock` 锁；确认没有进程、无在途请求并完成账本/租约核对后才人工删除锁。不得删库重置已用预算；完成评审后记录总额再按批准清理 scratch 数据库。

## 观测

`npx tsx scripts/report_note_discovery_metrics.ts <ISO起始日期>` 是只读元数据报告，需有目标环境读取授权；本轮未读取生产库。按 createdAt 定义 cohort，最多一万 runs，输出成功/无结果率、p95 执行延迟、已知均价及未知费用次数、同账户重复观察比例、曝光后的继续讨论/保存/否定比例。会话建立计“继续”，并非实际对话轮数。重复指标是发布结果重复率，不能冒充模型候选去重拒绝率。反馈按仍有效且未撤销的唯一 discovery 计数。

目前反馈 enum 没有“认可”动作，因此认可率返回 null；没有否定不能推断认可。需要产品批准新增认可事件后才能真实衡量该项。价格未知绝不按零统计；账本保守结算额与已知 usage 成本分别查看。报告只投影元数据，不收集私人正文；小样本聚合不应作为公开用户统计。

## 架构与上线限制

执行链为 `NoteDiscoveryScheduleService → NoteDiscoveryWorkerStore → NoteDiscoveryWorker → NoteContinuationAgent → tools/provider → publishDiscoveryRun`。Agent 通过 DeepSeek 原生函数调用使用服务端提供的只读工具。检索目前以用户隔离的文字匹配为主。结构、来源及重复约束由服务端校验，语义关联和下一步价值通过固定样本逐例核对。

运行关闭、恢复、删除及生产发布规则见部署指南；任何本地测试通过均不授权推送、部署或启用收费开关。
