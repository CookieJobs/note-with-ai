# P15：手动研究一条有来源的外部灵感

## 目标与范围

P15 是一个由用户手动发起的、小型“研究代理”：它从用户近期笔记中识别一个可能值得继续了解的主题，检索公开网页，再把可追溯的来源整理为一份与该用户相关的短灵感。

它的交付物不是一串搜索链接，而是一张研究结果卡：包含结论、与近期记录的关联、可继续思考的问题，以及文中引用和底部来源。链接可以出现，但只能作为实际来源的证据。

本期只实现一次点击对应一次手动研究。它不实现定时任务、通知、自动推送、收藏、忽略、历史筛选、把灵感转成笔记，或“禁止某篇笔记参与 AI”的控制。这些分别属于 P17、P16、P06；P06 目前明确延后，因此本期所有笔记都有可能参与主题选择。

## 用户流程

1. 用户在新“灵感”页看到数据说明，主动点击“为我研究一条灵感”。这一点击是本次将有限笔记元数据用于 AI 处理的明确操作。
2. 服务端从该用户按 `updatedAt` 排序的最近 5 篇笔记中，提取受限的上下文：标题（每篇最多 80 字）、最多 3 个关键词、已有短摘要（每篇最多 120 字）。无标题、关键词和摘要的笔记跳过。
3. DeepSeek 的**规划调用**只接收这些受限字段，返回严格 JSON：一个不超过 160 字的搜索查询和一个面向用户的主题标签。它不得输出研究结论，也不得拿到笔记正文。
4. 服务端只把规划出的 `query` 发送给 Tavily Search；Tavily 不会收到笔记标题、关键词、摘要、用户 ID 或任何笔记正文。搜索最多取 5 个来源，关闭原始网页内容返回（`include_raw_content: false`）。
5. 服务端筛掉没有安全 `http`/`https` URL、标题或摘要的结果，并排除该用户已经展示过的来源 URL。若至少有一个合格来源，最多将 3 条来源摘要交给 DeepSeek 的**整理调用**。
6. DeepSeek 返回严格 JSON：`headline`、`brief`、`whyRelevant`、`nextQuestion` 和 `sourceIds`。模型只能用输入中的来源编号引用资料；服务端会校验每个编号确实对应 Tavily 返回的来源后才保存和展示。
7. 页面展示生成结果，文中的 `【1】` 等引用和底部“参考来源”都可打开对应原始网页。用户可随时再次发起一次新的手动研究。

同一用户同一时刻只能有一条请求在进行中：前端禁用按钮，后端也按用户加短时互斥保护。请求采用有限超时的同步响应；P15 不引入后台调度或定时器。若浏览器或服务请求中断，用户可以重新发起，不会把半成品写入数据库。

## 隐私与数据边界

| 接收方 | 可以收到 | 绝不收到 |
| --- | --- | --- |
| DeepSeek | 最多 5 篇笔记的受限标题、关键词、短摘要；Tavily 返回的来源标题、URL、摘要 | 笔记正文、完整附件、用户 ID、账号信息 |
| Tavily | 仅 DeepSeek 规划出的单条搜索查询 | 任何笔记字段、用户 ID、DeepSeek 提示词、笔记正文 |
| 浏览器 | 已验证、保存后的研究结果和来源 | 内部查询、其他用户记录、供应商密钥 |

服务端不会向日志写入笔记上下文、搜索查询、供应商完整响应或密钥；只记录受控错误码、供应商类别与 HTTP 状态。Tavily 只取得摘要型搜索结果，不请求网页全文。DeepSeek 的“相关性”是基于受限笔记元数据的推断，页面不得把它表述为读取、理解或验证了完整笔记。

## 真实性与失败处理

生成的内容是“基于公开来源整理的启发”，不是事实保证。为降低把模型想象当成资料的风险：

- 提示词要求每项外部事实都引用至少一个传入的 `sourceId`，不得编造 URL、出版物或来源编号。
- 服务端拒绝未知来源编号、缺少来源、无效 JSON，或没有任何可验证引用的模型输出；这些结果不保存。
- 页面显示来源标题、域名和 Tavily 返回的摘要，用户可以直接核对原网页。
- 系统不声称读过网页全文，也不把 Tavily 摘要或模型生成文字包装成权威结论。

稳定的用户可见状态：

- `SEARCH_PROVIDER_UNAVAILABLE`：未配置 Tavily 密钥。
- `AI_PROVIDER_UNAVAILABLE`：未配置 DeepSeek 密钥。
- `SEARCH_PROVIDER_FAILED`：Tavily 超时、限流或返回非成功响应。
- `NO_RESULT`：没有合格、未重复的来源。
- `INSPIRATION_SYNTHESIS_FAILED`：DeepSeek 未能返回可验证的整理结果。
- `INSPIRATION_IN_PROGRESS`：该用户已有一条尚未完成的手动请求。

错误提示不回显查询、笔记片段、供应商响应或密钥，并提供“重试”入口。不会以模板文字冒充已完成的研究结果。

## 外部服务与配置

### Tavily Search

使用 Tavily 的 `POST https://api.tavily.com/search`。请求使用 Bearer 认证，设为 `search_depth: 'basic'`、`max_results: 5`、`include_answer: false`、`include_raw_content: false`；仅消费返回结果的 `title`、`url`、`content` 和可选发布时间。Tavily 官方 API 文档确认这些参数和返回结构。[Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)

### DeepSeek

沿用项目现有的服务端 `DEEPSEEK_API_KEY` 和 `llmService` 客户端，不在前端再创建 AI 客户端。P15 增加受限的规划和整理方法，并接入现有 AI 使用量遥测；不依赖 DeepSeek 的内建联网能力，实际网页检索始终由 Tavily 完成。

部署环境只增加下列服务端变量：

- `TAVILY_API_KEY`：Tavily Search 的密钥。
- `TAVILY_SEARCH_TIMEOUT_MS`：可选，默认 8 秒。
- `TAVILY_SEARCH_LANGUAGE`：可选，默认按产品界面语言配置。

`DEEPSEEK_API_KEY` 已是项目现有服务端变量。两个密钥都不得进入前端代码、提交记录、浏览器构建产物、日志或 API 响应。

### 获取、保存与轮换 API Key

#### Tavily

1. 打开 [Tavily Platform](https://app.tavily.com)，注册或登录。
2. 在 Dashboard 的 API Keys 区域创建或复制一个专用于本项目的密钥，例如标记为 `noteWithAI-production`。Tavily 的官方快速开始说明从 Dashboard 复制密钥；其当前免费额度与计费条件以控制台当日显示为准。[Tavily Quickstart](https://docs.tavily.com/documentation/quickstart)
3. 将密钥只保存到团队密码管理器和生产服务器的后端环境配置中，变量名为 `TAVILY_API_KEY`。不要发送到聊天、邮件、GitHub Issue、截图或提交记录。
4. 重启后端服务使配置生效。不要写入根目录/前端公开环境变量，也不要使用 `NEXT_PUBLIC_` 前缀。
5. 以已登录测试用户点击一次“为我研究一条灵感”验证；成功时只应显示整理结果和来源，失败时不得回显密钥或查询。
6. 怀疑泄露时，在 Tavily Dashboard 撤销旧密钥，创建替代密钥，更新服务器环境变量并重启后端；不要在代码中保留备用明文密钥。

#### DeepSeek

1. 由项目负责人登录现有 DeepSeek 平台账户，在 API Key 管理页创建一个仅供此环境使用的密钥；如已有安全保存的生产密钥，无需重复创建。
2. 将密钥以 `DEEPSEEK_API_KEY` 写入生产后端环境变量。项目已通过服务端配置读取它，P15 不增加浏览器侧配置。
3. 按与 Tavily 相同的原则保存在密码管理器中，并在泄露时先撤销、再创建替代密钥、更新环境变量并重启服务。

## 数据、服务与接口边界

新增 `InspirationItem`，仅保存已经验证和展示所需的结果：

- `userId`
- `relatedNotes`：`noteId`、请求时 `revision` 与受控主题标签；不保存笔记正文或发送给模型的完整上下文
- `topicLabel`
- `headline`、`brief`、`whyRelevant`、`nextQuestion`
- `sources[]`：`sourceId`、`canonicalUrl`、`title`、`publisher`、`snippet`、`retrievedAt`
- `createdAt`、`updatedAt`

另设只服务于去重的 `InspirationSource` 注册表：`userId`、`canonicalUrl`、`inspirationId`、`createdAt`，并在 `{ userId, canonicalUrl }` 建立唯一索引。新研究应优先使用未展示过的来源；若并发请求竞争同一来源，注册表的唯一约束与冲突处理返回已有结果或 `NO_RESULT`，而不是重复写入。保存记录和来源注册表是刷新后仍能看到最近结果和去重所需的最小基础，不增加 P16 的保存、忽略、列表或历史状态。

新增模块各自只做一件事：

- `tavilySearchProvider`：配置校验、超时、请求和将 Tavily 响应收敛为安全来源字段。
- `inspirationPlanner`：通过现有 `llmService` 用受限笔记元数据生成查询和主题。
- `inspirationSynthesis`：将编号来源整理为受引结果，并校验 `sourceIds`。
- `inspirationService`：选择笔记、并发保护、去重、持久化和稳定状态映射。
- `inspirationController/routes`：认证、参数边界和标准响应信封。

接口：

- `POST /api/inspirations`：执行一次手动研究，返回 `{ status: 'created', item }`、`{ status: 'no_result' }` 或稳定错误码。
- `GET /api/inspirations/latest`：仅返回当前用户最近的一条安全结果，或 `null`；不返回内部查询、笔记上下文、密钥或其他用户记录。

## 前端

新增 `/inspiration` 页面，并在现有主导航增加“灵感”入口。沿用已有导航、页面和卡片视觉，不进行主题、全局布局或运营后台改造。

页面包含：

- 明确的数据说明：“本次只会使用近期笔记的标题、关键词和短摘要；不会发送笔记正文。”
- 主按钮“为我研究一条灵感”，以及不可重复提交的加载状态“正在检索并整理来源…”。
- 空结果和各类可重试错误状态。
- 成功卡片：研究标题、短结论、为什么与你有关、一个后续问题；文中编号引用和底部“参考来源”。
- 每个来源显示标题、域名和摘要，外链使用 `target="_blank"` 与 `rel="noreferrer"`。

P15 页面不出现“保存”“不感兴趣”“历史记录”“定时推送”等 P16/P17 操作。

## 测试与验收

后端测试：

- 规划调用最多使用 5 篇笔记受限字段；`content`、正文、附件、用户 ID、邮箱、URL 等不会进入 P15 的 DeepSeek 提示词。
- Tavily 适配器只接收查询，且请求固定关闭 `include_raw_content`；不会获得笔记字段。
- 未配置、超时/限流、无结果、来源字段缺失、重复来源、并发请求和模型无效 JSON 各自得到正确且不泄露细节的状态。
- 只能引用 Tavily 实际返回的 `sourceId`；未知编号或无来源的模型结果不会写入。
- 同一用户的来源去重、不同用户隔离，以及 `latest` 的最小安全字段均被覆盖。

前端测试：

- 数据说明、加载、空结果、错误和研究卡片准确显示。
- 请求中无法重复提交；失败后可重试。
- 引用、来源清单和外链安全属性正确；页面不把链接列表替代为研究结果，也不出现 P16/P17 控件。

人工验收：

1. 在部署环境设置 `TAVILY_API_KEY` 和已有的 `DEEPSEEK_API_KEY`，以包含标题、关键词或短摘要的近期笔记点击请求。
2. 结果首先是与近期主题有关的短研究内容，每一条来源可打开并与底部来源条目一致。
3. 在浏览器网络、应用日志和供应商请求模拟中确认：Tavily 仅接收查询；笔记正文没有离开服务端。
4. 验证未配密钥、无结果、Tavily 失败和 DeepSeek 整理失败时的真实提示；不会产生伪造结果。
5. 换用另一用户确认无法看到第一位用户的灵感、相关笔记或来源记录。

## 非目标与后续

- P06：以后引入排除控制时，`inspirationService` 在选择笔记前读取排除名单。
- P16：在 `InspirationItem` 上增加保存、忽略和历史管理；本期结果结构会为此保留基础，但不提前实现交互。
- P17：仅在 P15、P16 稳定后增加用户明确同意、频率限制、通知与可恢复后台调度；不得将 P15 的同步手动请求改造成进程内定时任务。
