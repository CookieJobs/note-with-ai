## 产品目标
- 基于用户历史笔记自动从网络检索相关公开文章，融合现有 AI 关怀助手，共同提升信息获取与行动建议。
- 关注可用性（稳定返回、清晰解释“为什么推荐”）、性能（缓存与限流）、合规（来源与版权遵循）。

## 数据来源与策略
- 外网公开文章：对接搜索 API（首选 Bing Web Search 或 SerpAPI，支持中文），返回 `title/url/snippet/source/publishedAt`。
- 关键词与语义：
  - 关键词提取：沿用 `extractSearchKeywords`（backend/services/deepseek.ts），或回退规则词典。
  - 语义相似：使用笔记 `embedding` 与文章 `snippet/title` 的向量余弦相似度（无向量时仅关键词匹配）。
- 融合排序：综合 `semantic`、`keywordHit`、`recency`、`sourceQuality`，并用 MMR 控制多样性。

## 后端方案
- 路由扩展：`backend/routes/for-me.ts`
  - 扩展 `GET /api/for-me` 支持来源筛选：`?source=web`（仅外网）、`?limit=...`、`?categories=...`。
  - 新增 Provider 抽象：`services/webSearchProvider.ts`
    - `searchArticlesForKeywords(keywords, { limit, lang })` 返回统一 `SearchResult[]`。
    - 适配器：`bingProvider`、`serpApiProvider`，读取密钥自环境变量；失败回退到现有模拟 `search.ts`。
  - 文章增强：`id(repeat-safe) / relevanceScore / category / readingTime / recommendationReason`，复用当前增强逻辑（backend/routes/for-me.ts）。
  - 缓存与限流：
    - 缓存键：`userId + noteId + keywordsHash`；TTL 4–12h，命中则直接返回。
    - 速率限制：每用户每小时刷新上限；错误降级到模拟源或返回空。
- 集成点参考：
  - 关键词提取：`backend/services/deepseek.ts`
  - 现有路由：`backend/routes/for-me.ts`（追加 `source` 分支与 Provider 调用）
  - 统一响应：`backend/utils/errorHandler.ts:206-244` 的 `ResponseHandler.success`

## 前端方案
- 页面：`frontend/src/app/for-me/page.tsx`
  - 拉取数据：`authFetch('/api/for-me?source=web')`，统一解包 `json.data ?? json`。
  - UI 扩展：
    - 来源切换：`全部 / 外网 / 公开笔记`（先实现“外网”单选）。
    - 过滤/排序：`分类、相关度/发布时间/评分、仅收藏`（沿用现有控件）。
    - 文章卡片：来源、时间、阅读时长、相关度、推荐理由、收藏与评分（沿用现有样式模块）。
  - 刷新交互：支持按笔记刷新（已存在 `POST /api/for-me/refresh/:noteId`），外网来源走同样流程与 loading 集合。

## 排序与质量
- 综合评分：`score = 0.5*semantic + 0.3*keyword + 0.15*recency + 0.05*sourceQuality - diversityPenalty`
- 多样性：MMR 或同域降权，避免同站刷屏；黑白名单维护域名质量。
- 解释性：“为什么推荐”：展示命中关键词与语义简述，提升透明度。

## 隐私与合规
- 仅保存最小必要信息（标题/链接/摘要/来源/时间）；不镜像全文；遵循各搜索 API 的 ToS。
- 过滤低质或不当内容；保留举报/屏蔽入口（后续）。

## 性能与观测
- 缓存命中率、外部 API 失败率与退回模拟源比例、平均响应时间。
- 用户侧：点击率、收藏率、评分均值、阅读完成率。

## 里程碑
- P0（本次实现）：
  - 后端：Provider 抽象 + Bing/SerpAPI 适配 + 参数化 `source=web`，缓存与限流基础版。
  - 前端：接入 `source=web` 的拉取与展示，复用文章卡片，完善解包与错误提示。
- P1：
  - 融合排序（语义+关键词）、MMR 多样性、解释性文案与 UI。
- P2：
  - 公开笔记来源融合、黑白名单治理、观测面板、A/B 权重调优。