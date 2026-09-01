# 可信扩展设计 Spec：AI 记忆、单篇公开与主动灵感

- 状态：待产品审阅
- 日期：2026-09-01
- 对应审计：`.impeccable/critique/2026-08-29T17-18-59Z__frontend-src.md`
- 执行建议：独立 Session / 独立分支，与核心闭环 Spec 并行

## 1. 决策摘要

本 Spec 定义产品在核心私人记录之外的三项扩展能力：

1. **AI 记忆**：用户能看见 AI 认为自己有哪些持续兴趣、关注点与变化，并能查看依据、纠正、确认或删除。
2. **单篇公开**：用户主动把某一篇笔记的一个快照公开，并能随时更新公开版本或撤销链接。
3. **主动灵感**：产品基于用户明确允许参与 AI 的笔记，低频寻找有出处的外部内容；每条内容都解释“为什么给你看”。

三项能力共享同一原则：

> 产品可以逐渐熟悉用户，但不得偷偷定义用户、替用户公开内容，或用无出处的生成内容假装发现。

它们不是一个社交 feed，也不是提高停留时长的推荐系统。它们服务于“更理解自己、偶尔得到有价值的外部连接”。

## 2. 背景与问题

当前产品已有用户画像、兴趣、背景、个人传记、feed 和外部搜索的雏形，但存在商业化前必须解决的信任问题：

- AI 推断容易被呈现为确定事实，用户看不到来自哪些笔记，也缺少修正和遗忘机制。
- “产品越来越懂你”若没有边界，会迅速从温度变成监视感。
- 社交需求尚处于“偶尔公开一篇笔记”，不应提前演化成关注关系和公共动态流。
- 现有搜索服务包含示例性质的假数据。任何面向用户的主动内容必须有真实来源；供应商不可用时宁可没有结果，也不能伪造 URL、日期或摘要。

本 Spec 用清晰的数据边界和撤销机制，为未来商业化建立可信基础。

## 3. 目标与成功标准

### 3.1 产品目标

- 把“用户画像”改造成用户可治理的“AI 记忆”。
- 每条 AI 记忆均有原文依据、状态和可逆操作。
- 允许用户以最小社交单元公开一篇笔记，而不是默认进入公共空间。
- 公开内容与私人原文解耦；编辑私人笔记不会静默改变已公开内容。
- 用真实、可追溯的网络来源提供低频灵感，并明确其与用户记录的关联。
- 为每篇笔记提供“不参与 AI”的持久偏好数据模型。

### 3.2 关键成功信号

- 用户打开 AI 记忆后，能够回到至少一条来源笔记。
- 用户确认、修正或删除记忆，而不是只能被动接受。
- 公开链接创建成功、撤销可靠，且撤销后旧链接立即不可访问。
- 灵感卡片的来源点击率、保存率和“不感兴趣”反馈；不以无限滚动时长为成功指标。
- 没有来源、来源抓取失败或摘要无法被证据支持时，系统不发布该灵感。

## 4. 非目标

- 关注、好友、粉丝、评论、点赞、转发链和公共时间线。
- 用户公开主页、搜索用户或按热度推荐公开笔记。
- 多人协作编辑与权限组。
- 自动公开任何内容。
- 把人格类型、心理诊断或价值判断作为 AI 记忆。
- 持续后台爬虫、任意网页抓取或绕过站点访问限制。
- 高频推送、红点轰炸和无限滚动的信息流。
- 完整账户导出和账号注销流程；这是商业化前的独立合规 Spec，本期不以半成品替代。
- 全站视觉系统重做；两条并行分支合并后再统一收敛。

## 5. 共同原则与不可破坏约束

1. **私人默认。** 记忆、笔记和灵感默认仅当前用户可见。
2. **公开必须逐篇、主动、可撤销。** 不提供“以后都公开”的默认开关。
3. **推断必须可追溯。** AI 记忆至少关联一条有效来源笔记，并展示摘录。
4. **推断必须可纠正。** 用户确认、修正和删除后的结果优先于模型再次推断。
5. **删除是真正的产品语义。** 已删除记忆不能在下一次分析中原样复活；需要保存最小化的阻止指纹或用户规则，但不保留已删除全文。
6. **外部内容必须有出处。** 标题、域名、URL、发布时间和摘要来源可追踪；禁止示例数据进入生产响应。
7. **没有结果优于假结果。** 搜索或摘要失败时显示可理解的空状态。
8. **解释推荐原因。** 每条灵感都回答“它和我的哪条记录有关”。
9. **不优化成瘾。** 默认有限列表，无自动播放、无限滚动和互动热度排序。

## 6. 信息架构

### 6.1 账户页调整

现有 profile 页面保留账户资料，但不再把模型推断混在静态个人资料中。AI 推断迁移到独立 `/memory` 页面，并从账户页提供入口。

目标导航层级：

- 笔记
- 对话
- 灵感
- 账户
  - AI 记忆
  - 公开内容
  - 数据与隐私（只承载本期已有控制；完整导出/注销后续补充）

### 6.2 灵感页

使用独立 `/inspiration` 页面，不混入私人笔记时间线。首屏只显示有限数量的未处理项目和清楚的生成原因。用户可以手动请求“为我找一条新的灵感”，但需要限流。

### 6.3 公开页

公开链接使用 `/p/:slug`。公开页面是阅读页，不展示站内私密导航、AI 记忆、相关私人笔记或作者的其他内容。

## 7. AI 记忆设计

### 7.1 命名与语言

界面统一使用“AI 记忆”，不用“人格画像”“用户画像”“传记结论”。记忆是产品为了后续对话和发现关系而保存的可编辑理解，不是对用户本质的裁决。

推荐类型限定为：

```ts
type MemoryInsightKind =
  | 'recurring_interest'
  | 'ongoing_question'
  | 'stated_goal'
  | 'preference'
  | 'change_over_time';
```

禁止生成：医疗/心理诊断、政治立场、宗教、性取向、健康状况、精确财务状况等敏感推断，除非未来有单独的明确同意和合规设计。即便用户原文出现，也不应自动提升为长期记忆。

### 7.2 独立数据模型

新增 `MemoryInsight`，不直接继续扩张现有 `UserProfile` 聚合字段：

```ts
interface MemoryInsight {
  id: string;
  userId: string;
  kind: MemoryInsightKind;
  statement: string;
  status: 'proposed' | 'confirmed' | 'corrected';
  evidence: Array<{
    noteId: string;
    noteRevision: number;
    excerpt: string;
    capturedAt: string;
  }>;
  confidence: 'tentative' | 'supported';
  userCorrection?: string;
  fingerprint: string;
  generatedAt: string;
  updatedAt: string;
}
```

同时新增最小化的 `MemorySuppression`：

```ts
interface MemorySuppression {
  userId: string;
  fingerprint: string;
  reason: 'deleted_by_user' | 'superseded_by_correction';
  createdAt: string;
}
```

`fingerprint` 来自规范化语义标识或稳定哈希，不包含可还原的完整 statement。生成新记忆前必须应用 suppression，防止用户删除后原样复活。

### 7.3 来源与证据

- 一条记忆至少有 1 条来源，`supported` 至少有 2 个不同时间点的来源。
- 摘录必须可在对应 revision 的规范文本中验证。
- 来源笔记被删除后，证据立即不可展示；若无剩余证据，该记忆转为不可用并从默认列表移除。
- 来源笔记更新后，旧 excerpt 必须重新验证；不能保留与当前原文不符的引用。
- UI 中每条证据显示日期和“查看原文”。

### 7.4 用户操作

每条记忆提供：

- `这是准确的`：状态变为 `confirmed`。
- `修改`：用户写下更准确的表述，状态变为 `corrected`；原模型 statement 可进入审计字段，但普通 UI 以用户版本为准。
- `删除这条记忆`：删除 insight 正文并写入 suppression；确认文案说明它不会再用于对话或推荐。
- `查看依据`：展开来源笔记和摘录。

操作必须即时反映在后续 AI 上下文构建中。用户修正内容拥有最高优先级，模型不能自动覆盖；后续变化应创建新的 `change_over_time` 提议，由用户判断是否替换。

### 7.5 笔记级 AI 参与控制

为避免修改核心 Note schema，新增独立 `NoteAiPreference`：

```ts
interface NoteAiPreference {
  userId: string;
  noteId: string;
  included: boolean;
  updatedAt: string;
}
```

默认 `included: true`。用户可将单篇笔记设为“不参与 AI”；它仍可正常保存和阅读，但不得用于：

- 新的 AI 记忆；
- 主动灵感查询与摘要；
- 两份分支合并后生成的新关系和聊天长期上下文。

关闭后，已有由该笔记支持的记忆需要重新评估；若没有其他证据则移除。已有公开快照不自动撤销，因为公开是另一项用户主动行为，但界面应明确区分二者。

### 7.6 API

```http
GET    /api/memory-insights
POST   /api/memory-insights/:id/confirm
PATCH  /api/memory-insights/:id/correction
DELETE /api/memory-insights/:id

GET    /api/note-ai-preferences/:noteId
PUT    /api/note-ai-preferences/:noteId
```

修正请求只接受必要字段，做长度和内容校验。所有接口从认证上下文确定用户，并校验来源笔记所有权。

## 8. 单篇公开设计

### 8.1 发布语义：公开快照

发布不是给 Note 增加一个随编辑自动变化的 `public` 布尔值，而是创建独立、可审计的 `PublishedNote` 快照：

```ts
interface PublishedNote {
  id: string;
  ownerUserId: string;
  sourceNoteId: string;
  sourceRevision: number;
  slug: string;
  title?: string;
  contentSnapshot: SanitizedRichText;
  authorDisplayName?: string;
  status: 'active' | 'revoked';
  publishedAt: string;
  updatedAt: string;
  revokedAt?: string;
}
```

关键规则：

- 创建发布时对内容做服务端清洗并保存快照。
- 私人原文后续编辑不自动更新公开页面。
- 当源 revision 更新，管理页显示“公开版本不是最新”，用户可主动“更新公开版本”。
- 更新公开版本保留 slug，但生成新的已清洗快照和 revision。
- 撤销后 slug 统一返回 404，公开内容不再从应用缓存或 CDN 返回。
- 重新公开默认生成新 slug，避免旧链接意外复活。

### 8.2 发布流程

1. 用户从笔记操作中选择“公开这一篇”。
2. 进入确认页，预览将公开的标题、正文和展示名。
3. 明确提示不会公开：其他笔记、关系、AI 记忆、标签诊断、聊天记录。
4. 用户确认后创建链接，可复制或调用系统分享面板。
5. “公开内容”管理页可查看、更新快照和撤销。

不提供批量发布或默认公开。

### 8.3 公开页面

- 只渲染已清洗快照和必要作者信息。
- 默认设置 `noindex, nofollow`，第一阶段不进入搜索引擎；未来若开放索引必须逐篇明示同意。
- 不显示阅读数、点赞、评论或“更多来自作者”。
- 不加载会泄露私人身份或内部 note ID 的资源。
- 页面包含“由 Note with AI 分享”一类低干扰品牌标识，但不伪装用户背书。
- 撤销页不透露标题、作者或曾经的内容。

### 8.4 API

```http
POST   /api/publications
GET    /api/publications/mine
PATCH  /api/publications/:id/snapshot
DELETE /api/publications/:id
GET    /api/publications/public/:slug
```

创建和管理接口需要登录；public GET 不需要登录。slug 使用高熵随机值，不使用可枚举自增 ID。服务端必须验证来源笔记所有权与 revision。

## 9. 主动灵感设计

### 9.1 产品形态

灵感不是新闻 feed。它是数量有限、来源明确的“外部连接”：

> 因为你最近几次都在思考“会议里为什么不敢反驳”，这里有一篇关于异议表达的文章，或许能提供另一个视角。

每张卡必须包含：

- 标题、来源站点、真实 URL；
- 可获得时显示原始发布时间；
- 基于来源内容的短摘要；
- “为什么给我看”，关联到 1–3 条允许参与 AI 的笔记；
- `查看来源`、`保存`、`不感兴趣`；
- 若摘要只基于搜索摘要而非全文，明确标记“根据搜索摘要整理”。

### 9.2 数据模型

```ts
interface InspirationItem {
  id: string;
  userId: string;
  relatedNotes: Array<{
    noteId: string;
    noteRevision: number;
    reason: string;
  }>;
  source: {
    canonicalUrl: string;
    title: string;
    publisher: string;
    publishedAt?: string;
    retrievedAt: string;
    evidenceType: 'provider_snippet' | 'fetched_content';
  };
  summary: string;
  whyThis: string;
  status: 'unread' | 'read' | 'saved' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}
```

对 `(userId, canonicalUrl)` 做合理时间窗口内的去重。来源 note revision 变化或 AI 参与关闭后，旧卡可以留在历史中，但打开“为什么给我看”时不得泄露已不允许使用的笔记内容；默认列表应重新评估并移除失去全部依据的项目。

### 9.3 真实搜索供应商适配层

重写现有示例搜索实现为供应商无关接口：

```ts
interface SearchProvider {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}

interface SearchResult {
  url: string;
  title: string;
  publisher?: string;
  snippet?: string;
  publishedAt?: string;
}
```

约束：

- 供应商凭证只在服务端环境变量中配置。
- 未配置供应商时返回明确的 `SEARCH_PROVIDER_UNAVAILABLE`，绝不返回 mock 数据。
- provider 响应先经过 URL、scheme、重复项和字段长度校验。
- 不允许 `file:`、`data:`、本地地址、私网 IP、metadata endpoint 或非 HTTP(S) URL。
- 本阶段只使用供应商返回的结构化结果与 snippet，不由应用直接抓取任意网页全文。
- 数据模型保留 `fetched_content` 取值只为未来兼容；本阶段生产数据只能写入 `provider_snippet`。未来启用全文前必须单独实现并审阅安全 fetcher：DNS/IP 检查、重定向次数限制、响应大小限制、内容类型白名单、超时和 robots/服务条款评估。

### 9.4 查询与摘要生成

1. 从用户允许参与 AI 的近期笔记和已确认/修正记忆中选取一个明确主题。
2. 生成短查询，不发送整篇私人笔记给搜索供应商。
3. 搜索、校验与去重。
4. 使用检索到的标题、snippet 或安全获取的正文生成摘要和推荐原因。
5. 服务端做 groundedness 校验：摘要中的关键主张必须能对应来源材料；无法验证则丢弃。
6. 保存来源证据类型和检索时间。

不得把用户姓名、具体公司内部事项、联系人姓名或长段原文发送到外部搜索查询。查询生成前需做基本实体最小化处理。

### 9.5 频率与触发

本期支持两种触发：

- 用户手动请求一条新灵感；
- 低频服务端任务，每位已明确开启“允许主动寻找灵感”的用户每 24 小时最多运行一次。

默认关闭主动任务。通知推送不在本期范围；有新灵感时只在灵感入口显示克制状态，不使用不断累积的红色未读压力。

### 9.6 API

```http
GET   /api/inspirations
POST  /api/inspirations/generate
GET   /api/inspirations/jobs/:jobId
PATCH /api/inspirations/:id/status
GET   /api/inspiration-settings
PUT   /api/inspiration-settings
```

生成接口按用户、IP 和时间窗口限流；同一用户同一时刻只允许一个生成任务。接口返回 `202 Accepted` 和 job ID，新增 `GET /api/inspirations/jobs/:jobId` 查询 `queued | running | completed | no_result | failed`。前端使用有上限、可取消的轮询，不在请求中无限等待模型和搜索。

## 10. 状态、错误与降级

| 场景 | 用户看到什么 | 系统行为 |
|---|---|---|
| 暂无 AI 记忆 | “记录多起来后，这里会出现带依据的理解” | 不生成空泛人格标签 |
| 来源笔记已删除 | 该证据不再显示 | 重新评估 insight，无证据则移除 |
| 修正保存失败 | 保留编辑内容并可重试 | 不覆盖原状态 |
| 删除记忆 | 明确成功反馈 | 删除正文并建立 suppression |
| 发布内容含危险标记 | 安全清洗后的预览或阻止发布 | 服务端不保存未清洗快照 |
| 私人原文已更新 | “公开版本不是最新” | 不自动改公开内容 |
| 公开链接已撤销 | 通用不可用页面 | 返回 404，不泄露历史信息 |
| 搜索未配置 | “目前无法寻找新灵感” | 返回稳定错误码，不返回示例数据 |
| 搜索无结果 | “这次没有找到值得推荐的内容” | 不调用模型编造内容 |
| 摘要校验失败 | 不创建卡片 | 记录内部失败原因 |
| 来源链接后来失效 | 标记来源可能不可用 | 保留已记录出处，不复制整篇内容 |

## 11. 安全、隐私与内容完整性

### 11.1 鉴权与越权

- 所有私有接口从 session/token 解析用户身份。
- `MemoryInsight`、`NoteAiPreference`、`PublishedNote` 管理接口和 `InspirationItem` 每次查询都带 `userId` 条件。
- public GET 只按 active slug 返回已清洗快照，不能通过 slug 推导用户 ID 或源 note ID。
- 所有对象级越权场景必须有集成测试。

### 11.2 富文本与公开渲染

- 服务端使用明确 allowlist 清洗标签、属性和 URL scheme。
- 去除脚本、事件处理器、iframe、表单、追踪像素和危险样式。
- 外链使用适当的 `rel` 属性；如支持图片代理，必须有 SSRF 防护。
- Content Security Policy 与缓存策略覆盖公开页。

### 11.3 外部供应商数据最小化

- 搜索查询不包含完整笔记或可直接识别个人的信息。
- 模型和搜索日志不保存私人原文。
- 环境变量缺失、供应商超时和配额耗尽均安全失败。
- 在隐私说明中列出主动灵感会把最小化查询发送给外部搜索服务；主动模式启用前获得明确同意。

### 11.4 撤销与缓存

- 撤销 publication 时清除服务端缓存；响应使用可控缓存头。
- 若未来引入 CDN，必须提供 purge 路径并纳入撤销事务。
- 应用不能承诺互联网上已被第三方复制的内容可被追回；确认发布时用平实语言说明这一限制。

## 12. 无障碍与响应式

- 以 WCAG 2.2 AA 为目标。
- 记忆状态、发布状态、灵感状态不能只靠颜色表达。
- 公开确认和删除记忆的对话框具有正确标题、描述、初始焦点和焦点返回。
- 来源链接有清晰名称，并提示会离开产品。
- 卡片操作可通过键盘完成；触控目标至少 44px。
- 公开阅读页在窄屏、放大 200% 和系统深色模式下保持可读。
- 减少动态效果设置下关闭卡片进入和状态动画。

## 13. 产品事件与质量指标

只记录对象 ID 和行为，不记录记忆全文、笔记正文、搜索 query 全文或用户修正文案。

- `memory_viewed`
- `memory_evidence_opened`
- `memory_confirmed`
- `memory_corrected`
- `memory_deleted`
- `note_ai_preference_changed`
- `publication_created`
- `publication_snapshot_updated`
- `publication_revoked`
- `public_note_viewed`（仅隐私允许的聚合计数）
- `inspiration_requested`
- `inspiration_generated`
- `inspiration_generation_failed`
- `inspiration_source_opened`
- `inspiration_saved`
- `inspiration_dismissed`

质量看板必须同时关注：记忆修正/删除率、灵感生成失败率、无结果率、来源失效率与越权/清洗安全测试；不能只看点击。

## 14. 文件所有权与并行边界

本 Session 可以修改：

- `frontend/src/app/profile/**`
- 新建 `frontend/src/app/memory/**`
- 新建 `frontend/src/app/inspiration/**`
- 新建 `frontend/src/app/publish/**`
- 新建 `frontend/src/app/p/**`
- `frontend/src/components/TopNavigation.tsx`
- 上述领域专属的 services、types 和测试
- `backend/models/UserProfile.ts`（仅迁移/兼容现有画像读取所需）
- 新建 MemoryInsight、MemorySuppression、NoteAiPreference、PublishedNote、InspirationItem、InspirationSettings 模型
- 新建对应 routes/controllers/services/tests
- `backend/services/search.ts`
- `backend/controllers/feedController.ts`（将旧 feed 迁移或退役为 inspiration 所需）
- `backend/index.ts`（挂载本 Spec 的新顶层路由）

本 Session 不得修改：

- `frontend/src/app/notes/**`
- `frontend/src/app/chat/**`
- `frontend/src/components/ChatRelatedNotesPanel.tsx`
- `backend/services/recommendService.ts`
- `backend/routes/recommend.ts`
- `backend/services/noteEnrichmentWorker.ts`
- `backend/services/NoteUpdateOrchestrator.ts`
- `backend/models/Note.ts`
- 第一份 Spec 新建的 relationship/feedback 模块

领域类型放在各自模块，不共同编辑全局类型文件。第二份分支可以完整实现 API、管理页、公开页和灵感页；笔记卡片上的入口与 AI 排除对关系召回的影响，明确留到合并接缝处理。

## 15. 两份并行分支的合并接缝

这是两份 Spec 都完成后必须执行的一次小型整合，不属于任一分支并行期间的文件所有权：

1. 在第一份 Spec 改造后的笔记卡片动作区增加：
   - `公开这一篇`，进入 `/publish/:noteId`；
   - `不参与 AI`，调用 NoteAiPreference API。
2. 让 `recommendService` 和关系解释层过滤 `included: false` 的笔记。
3. 让聊天 relationship 上下文同样检查 NoteAiPreference；用户临时显式选择某笔记时是否允许一次性使用，应另行做清楚确认，不在合并时猜测。
4. 核对 `TopNavigation` 与第一份 Spec 页面入口，确保移动端不重复、不错位。
5. 统一两边各自的产品事件适配层；若尚无统一分析平台，继续输出相同 envelope 的结构化日志。
6. 执行一次完整前后端回归、公开页安全检查和移动端主路径验收。

整合工作不得顺手扩大成全站重构。视觉系统收敛在两个功能分支稳定后单独进行。

## 16. 测试策略

### 16.1 AI 记忆

- 没有证据的模型输出不入库。
- evidence excerpt 与 note revision 一致并可验证。
- 用户确认、修正和删除的状态转换正确且幂等。
- 删除后同 fingerprint 不会再次生成。
- 来源删除、更新或关闭 AI 参与后正确重评。
- 敏感推断类型被拒绝。
- 跨用户读取或修改全部拒绝。
- 构建聊天/灵感上下文时以用户修正内容为准。

### 16.2 单篇公开

- 创建的是清洗快照，不是私人 Note 的直接公开视图。
- 修改私人原文不会静默改变公开快照。
- 更新快照保留 active slug 和正确 revision。
- 撤销后 public GET 不再返回内容，缓存不返回旧正文。
- 重新公开生成新 slug。
- XSS payload、危险 URL、事件属性和追踪资源被清除。
- slug 不可枚举，响应不泄露 ownerUserId/sourceNoteId。
- 公开页包含 noindex 指令。

### 16.3 主动灵感

- 无 provider 配置时稳定失败且绝无 mock 结果。
- provider 超时、配额错误、非法字段和重复 URL 的降级。
- 私网、本地、非 HTTP(S) 和危险重定向被阻止。
- 摘要只基于保存的来源材料；groundedness 失败不入库。
- 关闭 AI 参与的笔记不会进入查询和推荐原因。
- 同一用户并发生成被合并或拒绝，限流有效。
- 状态更新与跨用户访问隔离。
- 搜索 query 和日志不含完整笔记正文。

### 16.4 前端与无障碍

- 记忆证据、修正、删除完整键盘流程。
- 发布预览、确认、复制链接、更新、撤销完整流程。
- public 页窄屏、200% 缩放和屏幕阅读器基础语义。
- 灵感的 loading、无结果、provider 不可用、成功与失效来源状态。
- 所有 destructive action 的确认、焦点管理和错误恢复。

### 16.5 回归

- 原有登录、账户资料和私人笔记访问不受影响。
- 未开启主动灵感的用户不会触发后台外部搜索。
- 旧 UserProfile 数据可读取或安全迁移，不把旧无来源标签直接标成 confirmed。
- 原有 feed 示例结果不再能进入生产 UI。

## 17. 验收标准

全部满足才视为本 Spec 完成：

1. 用户可以查看 AI 记忆及每条记忆的来源笔记和证据。
2. 用户可以确认、修正和删除记忆，且三种操作立即影响后续 AI 上下文。
3. 删除后的同义记忆不会在下一次分析中原样复活。
4. 用户可以持久关闭单篇笔记的 AI 参与；AI 记忆和灵感生成遵守该设置。
5. 用户可以预览并公开单篇笔记的清洗快照。
6. 私人原文编辑不会自动改变公开内容，用户可主动更新公开版本。
7. 撤销后旧链接不再展示任何历史内容或身份信息。
8. 公开页面没有评论、点赞、关注或私人关系信息，并默认 noindex。
9. 灵感仅来自真实 provider 结果，每条都有可打开来源和明确推荐原因。
10. provider 未配置、失败或无结果时，产品不返回任何虚构标题、URL、日期或摘要。
11. 外部查询经过数据最小化，URL 获取具备 SSRF 与响应限制保护。
12. 默认不开启主动搜索；用户明确开启后仍有低频和并发限制。
13. 对象级鉴权、XSS 清洗、撤销缓存和错误降级有自动化测试。
14. 现有前后端测试、类型检查与本 Spec 新增测试全部通过。
15. 两份分支的修改范围符合文件所有权约束；需跨界的入口只通过第 15 节合并接缝完成。

## 18. 上线与迁移建议

- 先在个人账户和小范围测试用户中开启功能标志。
- 旧 UserProfile 中没有来源的兴趣和背景只作为迁移候选，状态必须为 `proposed`，且明确标为“过去的 AI 推断”；无法补证据时不要迁移。
- 生产环境如果没有真实 search provider，隐藏“寻找新灵感”动作并展示功能尚未配置，而不是使用示例服务。
- 公开功能先保持 noindex，观察撤销可靠性和内容清洗告警后再讨论索引。
- 主动灵感的后台任务默认关闭；手动生成质量稳定后再邀请用户 opt in。
- 功能标志至少分别控制 `memory_insights`、`publications`、`inspirations`，便于独立回滚。

## 19. 明确留给后续的事项

- 完整数据导出、账号注销、数据保留期和第三方子处理者披露。
- 语音记录的授权、转写供应商和音频删除策略。
- 是否允许用户选择公开页被搜索引擎收录。
- 社交互动是否真的能强化“记录与回望”；在验证单篇公开前不做关注或 feed。
- 推送通知和主动聊天的频率、安静时段及撤销设置。
- 两份 Spec 合并稳定后的设计系统与全站文案统一。
