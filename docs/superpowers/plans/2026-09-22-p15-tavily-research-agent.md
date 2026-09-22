# P15 Tavily 研究灵感 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 为已登录用户提供一次手动触发、由 DeepSeek 规划与整理、由 Tavily 检索并且每个结论可追溯至真实网页来源的“研究一条灵感”能力。

**Architecture:** 服务端从最近五篇笔记提取严格最小化的标题、关键词与短摘要，先由 DeepSeek 规划检索词，再单独交给 Tavily 搜索。Tavily 来源摘要由第二次 DeepSeek 调用整理为带来源编号的研究卡；InspirationItem 保存结果，InspirationSource 以用户范围唯一索引避免重复来源。

**Tech Stack:** Next.js App Router、React、Sass modules、Express、TypeScript、Mongoose、Node fetch、现有 DeepSeek llmService、Tavily Search REST API、node:test、Vitest。

**Spec:** docs/superpowers/specs/2026-09-21-p15-source-inspiration-design.md

## Global Constraints

- 不新增 npm 依赖；Tavily 使用 Node 内置 fetch 请求 POST https://api.tavily.com/search。
- 只增加服务端变量 TAVILY_API_KEY、TAVILY_SEARCH_TIMEOUT_MS、TAVILY_SEARCH_LANGUAGE；不得使用 NEXT_PUBLIC 前缀。
- DeepSeek 最多接收五篇笔记的标题（80 字）、最多三个关键词、短摘要（120 字）；不得接收 content、contentText、contentJson、附件、用户 ID 或账号信息。
- Tavily 只接收单条 query；请求固定 include_raw_content: false、include_answer: false、max_results: 5、search_depth: basic。
- brief 中所有外部事实必须以 【sourceId】 引用 Tavily 实际来源；不合规模型结果不得保存或展示。
- P15 是同步、手动请求；不得实现任务轮询、定时器、通知、保存/忽略/历史、P06 排除开关或任何运营后台改动。
- 新页面沿用白色导航与克制的卡片视觉；不得改变笔记、聊天、全局主题或分页。
- 密钥、搜索查询、笔记上下文、完整供应商响应均不得写日志或返回浏览器。

## Review Focus

- 笔记元数据中含邮箱、URL、@/# 标记或提示词注入时，进入 DeepSeek 前必须清洗及截断；Task 2 测试固定。
- Tavily 返回 javascript URL、带凭据 URL、空字段或跟踪 URL 时，只有规范化安全来源可进入后续流程；Task 1 测试固定。
- 两个并发点击竞争相同来源时，不得让同一用户看到两条重复结果；Task 3 测试固定。
- DeepSeek 返回未知引用、没有引用、重复引用或非 JSON 时，不得产生可读取结果；Task 3 测试固定。
- 未登录、跨用户、无密钥、Tavily 限流与研究进行中必须有稳定且不泄露内容的 HTTP/UI 行为；Task 4、6 测试固定。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| backend/config/index.ts | 解析受限 Tavily 服务端配置。 |
| backend/.env.example、.env.example | 变量名占位；绝不放真实密钥。 |
| backend/models/InspirationItem.ts | 保存一条成功研究的展示内容和受控笔记引用。 |
| backend/models/InspirationSource.ts | 在用户范围登记已展示的规范化来源。 |
| backend/services/inspirationTypes.ts | P15 输入、来源、DTO、错误码契约。 |
| backend/services/tavilySearchProvider.ts | Tavily HTTP 边界与来源净化。 |
| backend/services/inspirationLlm.ts | DeepSeek 规划、整理、引用校验。 |
| backend/services/inspirationService.ts | 笔记最小化、串联、去重与存取。 |
| backend/routes/inspirations.ts | 认证后的 HTTP 边界。 |
| frontend/src/services/inspirationService.ts | 浏览器端类型化 API 调用。 |
| frontend/src/app/inspiration/page.tsx | 手动研究页的登录守卫和状态机。 |
| frontend/src/app/inspiration/inspiration.module.scss | 灵感页局部样式。 |
| frontend/src/components/TopNavigation.* | 三项主导航。 |

### Task 1: 配置、模型与 Tavily 安全适配器

**Files:**
- Modify: backend/config/index.ts
- Modify: backend/.env.example
- Modify: .env.example
- Create: backend/models/InspirationItem.ts
- Create: backend/models/InspirationSource.ts
- Create: backend/services/inspirationTypes.ts
- Create: backend/services/tavilySearchProvider.ts
- Test: backend/tests/tavilySearchProvider.test.ts

**Interfaces:**
- Produces: createTavilySearchProvider(options).search(query), canonicalizeSourceUrl(value), ResearchSource 和 InspirationErrorCode。
- Consumes: Node fetch 与 Tavily results 数组；不消费笔记对象。

- [ ] **Step 1: 写失败的适配器测试**

~~~typescript
it('sends only a query and disables raw content', async () => {
  const calls: RequestInit[] = [];
  const provider = createTavilySearchProvider({
    apiKey: 'tvly-test', language: 'zh', timeoutMs: 500,
    fetchImpl: async (_url, init) => {
      calls.push(init as RequestInit);
      return new Response(JSON.stringify({ results: [{
        title: '可信来源', url: 'https://example.com/a?utm_source=x#part', content: '来源摘要',
      }] }), { status: 200 });
    },
    now: () => new Date('2026-09-22T00:00:00.000Z'),
  });
  assert.deepEqual(await provider.search('测试查询'), [{
    sourceId: '1', canonicalUrl: 'https://example.com/a', title: '可信来源',
    publisher: 'example.com', snippet: '来源摘要', retrievedAt: '2026-09-22T00:00:00.000Z',
  }]);
  assert.deepEqual(JSON.parse(String(calls[0].body)), {
    query: '测试查询', search_depth: 'basic', max_results: 5,
    include_answer: false, include_raw_content: false, language: 'zh',
  });
});

it('drops javascript, credential URLs and blank fields and maps 401/429 to SEARCH_PROVIDER_FAILED', async () => {
  // Feed unsafe candidates and non-200 responses; assert [] or error.details.code only.
});
~~~

- [ ] **Step 2: 运行并确认红灯**

Run: npm --prefix backend test -- tests/tavilySearchProvider.test.ts

Expected: FAIL，因为模块与类型尚不存在。

- [ ] **Step 3: 添加配置、共享类型和模型**

在 envSchema 的 DeepSeek 设置后新增：

~~~typescript
TAVILY_API_KEY: z.string().min(1).optional(),
TAVILY_SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(20_000).default(8_000),
TAVILY_SEARCH_LANGUAGE: z.string().trim().min(2).max(20).default('zh'),
~~~

两个环境示例均新增：

~~~dotenv
# Tavily Web Search（仅后端；不要填写或提交真实密钥）
TAVILY_API_KEY=your-tavily-api-key
TAVILY_SEARCH_TIMEOUT_MS=8000
TAVILY_SEARCH_LANGUAGE=zh
~~~

定义共享契约：

~~~typescript
export type InspirationErrorCode =
  | 'SEARCH_PROVIDER_UNAVAILABLE' | 'AI_PROVIDER_UNAVAILABLE'
  | 'SEARCH_PROVIDER_FAILED' | 'NO_RESULT'
  | 'INSPIRATION_SYNTHESIS_FAILED' | 'INSPIRATION_IN_PROGRESS';

export type LimitedNoteContext = {
  noteId: string; revision: number; title: string; keywords: string[]; summary: string;
};
export type ResearchPlan = { query: string; topicLabel: string };
export type ResearchSource = {
  sourceId: string; canonicalUrl: string; title: string; publisher: string;
  snippet: string; retrievedAt: string;
};
export type ResearchDraft = {
  headline: string; brief: string; whyRelevant: string; nextQuestion: string; sourceIds: string[];
};
export type InspirationDto = {
  id: string; topicLabel: string; headline: string; brief: string; whyRelevant: string;
  nextQuestion: string; sources: ResearchSource[]; createdAt: string;
};
~~~

InspirationItem 仅允许内部状态 draft 或 completed，并限制展示字段的长度。InspirationSource 包含 userId、canonicalUrl、inspirationId、createdAt，并建立：

~~~typescript
InspirationSourceSchema.index({ userId: 1, canonicalUrl: 1 }, { unique: true });
InspirationSourceSchema.index({ inspirationId: 1 });
~~~

- [ ] **Step 4: 实现提供商边界**

canonicalizeSourceUrl 必须拒绝非 http/https、凭据 URL、超过 2048 字符的 URL；删除 hash、utm_*、gclid、fbclid。请求实现固定为：

~~~typescript
const response = await fetchImpl('https://api.tavily.com/search', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query, search_depth: 'basic', max_results: 5,
    include_answer: false, include_raw_content: false, language,
  }),
  signal: AbortSignal.timeout(timeoutMs),
});
~~~

非成功、超时与网络错误只抛出 details.code 为 SEARCH_PROVIDER_FAILED 的 AppError。只从 results 读取 title、url、content 和 published_date；规范化后按 1 至 5 赋 sourceId，标题最多 300 字、摘要最多 1000 字。

- [ ] **Step 5: 验证并提交**

Run: npm --prefix backend test -- tests/tavilySearchProvider.test.ts && npm --prefix backend run typecheck

~~~bash
git add backend/config/index.ts backend/.env.example .env.example   backend/models/InspirationItem.ts backend/models/InspirationSource.ts   backend/services/inspirationTypes.ts backend/services/tavilySearchProvider.ts   backend/tests/tavilySearchProvider.test.ts
git commit -m "feat(inspiration): add Tavily source boundary"
~~~

Expected: PASS；请求中没有笔记字段及网页原文。

### Task 2: DeepSeek 规划、整理与引用验证

**Files:**
- Modify: backend/models/AiUsageEvent.ts
- Modify: backend/services/llmService.ts
- Create: backend/services/inspirationLlm.ts
- Test: backend/tests/inspirationLlm.test.ts
- Test: backend/tests/aiUsageTelemetry.test.ts

**Interfaces:**
- Consumes: Task 1 的 LimitedNoteContext、ResearchPlan、ResearchSource、ResearchDraft。
- Produces: buildPlanningMessages, buildSynthesisMessages, planResearch, synthesizeResearch, validateResearchDraft；Task 3 调用后两个函数。

- [ ] **Step 1: 写失败的元数据与引用测试**

~~~typescript
it('removes body-like secrets before planning', () => {
  const messages = buildPlanningMessages([{
    noteId: 'n1', revision: 4, title: '项目 https://private.example @alice',
    keywords: ['增长', 'a@b.com', '#内部'], summary: '短摘要 https://secret.example',
  }]);
  const serialized = JSON.stringify(messages);
  assert.match(serialized, /项目/);
  assert.doesNotMatch(serialized, /private\.example|secret\.example|a@b\.com|@alice|#内部/);
  assert.doesNotMatch(serialized, /contentText|contentJson|userId/);
});

it('rejects unknown or absent citations', () => {
  const source = { sourceId: '1' } as ResearchSource;
  assert.throws(() => validateResearchDraft({
    headline: '标题', brief: '没有引用', whyRelevant: '相关', nextQuestion: '下一步？', sourceIds: ['1'],
  }, [source]), { code: 'INSPIRATION_SYNTHESIS_FAILED' });
  assert.throws(() => validateResearchDraft({
    headline: '标题', brief: '错误【9】', whyRelevant: '相关', nextQuestion: '下一步？', sourceIds: ['9'],
  }, [source]), { code: 'INSPIRATION_SYNTHESIS_FAILED' });
});
~~~

- [ ] **Step 2: 运行并确认红灯**

Run: npm --prefix backend test -- tests/inspirationLlm.test.ts

Expected: FAIL，因为构造器和校验器不存在。

- [ ] **Step 3: 加入最小化消息与遥测**

在 AI_USAGE_OPERATIONS 增加 inspiration_plan 和 inspiration_synthesis。将下列薄封装加到 llmService，复用既有客户端和遥测：

~~~typescript
export async function chatWithDeepSeekJson(messages, telemetry, maxTokens) {
  return getDeepSeekClient().chatCompletion(messages, {
    temperature: 0.1, max_tokens: maxTokens, response_format: { type: 'json_object' },
  }, telemetry);
}
~~~

inspirationLlm 的 sanitizeMetadata 删除邮箱、http URL、@token、#token，压缩空白并截断。规划消息只能序列化 title、最多三个净化关键词、summary；系统提示只允许 JSON query 与 topicLabel，查询最多 160 字。

整理消息只输入净化后的 topic、同一受限笔记数组和最多三条 sourceId/title/canonicalUrl/publisher/snippet。系统提示要求 JSON：

~~~json
{
  "headline": "最多40字",
  "brief": "最多500字；外部事实使用【1】来源编号",
  "whyRelevant": "最多180字；仅解释与笔记元数据的联系",
  "nextQuestion": "最多120字的开放问题",
  "sourceIds": ["1"]
}
~~~

- [ ] **Step 4: 实现严格解析与校验**

planResearch 以 AiUsageService.newContext('inspiration_plan', userId) 调用 JSON 客户端；synthesizeResearch 用 inspiration_synthesis。两者都不记录模型原文。

validateResearchDraft 必须检查：

1. headline、brief、whyRelevant、nextQuestion 非空且在各自长度内；
2. brief 至少一个 【数字】；
3. brief 的引用去重集合与 sourceIds 去重集合完全相等；
4. 每个编号都存在于本次来源；
5. 任一 JSON 或格式错误均抛出 INSPIRATION_SYNTHESIS_FAILED，不能返回部分文本。

- [ ] **Step 5: 验证并提交**

Run: npm --prefix backend test -- tests/inspirationLlm.test.ts tests/aiUsageTelemetry.test.ts && npm --prefix backend run typecheck

~~~bash
git add backend/models/AiUsageEvent.ts backend/services/llmService.ts   backend/services/inspirationLlm.ts backend/tests/inspirationLlm.test.ts   backend/tests/aiUsageTelemetry.test.ts
git commit -m "feat(inspiration): add cited research synthesis"
~~~

Expected: PASS；笔记正文无法进入提示词，未知来源不能通过。

### Task 3: 手动研究编排、去重和持久化

**Files:**
- Create: backend/services/inspirationService.ts
- Test: backend/tests/inspirationService.test.ts

**Interfaces:**
- Consumes: Tasks 1、2 的提供商、模型和函数。
- Produces: inspirationService.request(userId) 与 inspirationService.latest(userId)，供 Task 4 调用。

- [ ] **Step 1: 写失败的服务测试**

~~~typescript
it('selects only five newest metadata fields and never note bodies', async () => {
  const query = {
    sort: (value) => { assert.deepEqual(value, { updatedAt: -1 }); return query; },
    limit: (value) => { assert.equal(value, 5); return query; },
    select: (value) => { assert.equal(value, '_id revision title keywords summary updatedAt'); return query; },
    lean: async () => [noteFixture],
  };
  mock.method(Note, 'find', () => query as never);
  await inspirationService.request('user-1');
});

it('deletes an incomplete item when source registration loses a duplicate race', async () => {
  // Planner, Tavily and synthesis yield one valid result. InspirationSource.insertMany throws { code: 11000 }.
  // Assert the created draft is deleted and result is { status: 'no_result' }.
});

it('blocks only the same user while research is running', async () => {
  // Hold one planner promise; same user gets INSPIRATION_IN_PROGRESS, other user can proceed.
});
~~~

- [ ] **Step 2: 运行并确认红灯**

Run: npm --prefix backend test -- tests/inspirationService.test.ts

Expected: FAIL，因为服务不存在。

- [ ] **Step 3: 实现顺序、互斥与完成写入**

loadLimitedNotes 必须是唯一笔记查询：

~~~typescript
Note.find({ userId })
  .sort({ updatedAt: -1 })
  .limit(5)
  .select('_id revision title keywords summary updatedAt')
  .lean();
~~~

将结果映射为受限类型；没有有效字段直接返回 no_result，不调用任何供应商。用 Map<string, Promise<unknown>> 作为进程内用户互斥，并在 finally 删除键；同一用户抛 HTTP 409、code 为 INSPIRATION_IN_PROGRESS。

完整顺序固定为：

~~~typescript
const plan = await planResearch(notes, userId);
const candidates = await tavilySearchProvider.search(plan.query);
const used = await InspirationSource.find({
  userId, canonicalUrl: { $in: candidates.map((source) => source.canonicalUrl) },
}).select('canonicalUrl').lean();
const sources = candidates.filter((source) => !usedUrls.has(source.canonicalUrl)).slice(0, 3);
if (!sources.length) return { status: 'no_result' };
const research = await synthesizeResearch(plan, notes, sources, userId);
~~~

仅合成校验成功后创建 status 为 draft 的 InspirationItem。接着 insertMany 注册全部来源，发生 11000 时删除该 item 以及该 inspirationId 已注册行后返回 no_result。全部成功后才将 item 改为 completed。latest 只能按 userId 与 completed 查询一条，DTO 不得返回 userId、relatedNotes、查询或内部状态。

- [ ] **Step 4: 补齐异常与隔离测试**

覆盖无有效笔记、全部来源已用、无 Tavily/DeepSeek 密钥、Tavily 失败、合成失败、注册冲突和跨用户 latest。每个外部错误只验证 message、status 与 details.code；不得断言或输出查询、提示词、供应商响应。

- [ ] **Step 5: 验证并提交**

Run: npm --prefix backend test -- tests/inspirationService.test.ts && npm --prefix backend test && npm --prefix backend run typecheck

~~~bash
git add backend/services/inspirationService.ts backend/tests/inspirationService.test.ts
git commit -m "feat(inspiration): orchestrate manual research"
~~~

Expected: PASS；没有 completed 半成品、重复来源或跨用户泄露。

### Task 4: 认证路由与 HTTP 契约

**Files:**
- Create: backend/routes/inspirations.ts
- Modify: backend/index.ts
- Test: backend/tests/inspirationHttpContract.test.ts

**Interfaces:**
- Consumes: Task 3 服务、authenticateToken、UserValidator.authenticateUser、ResponseHandler。
- Produces: POST /api/inspirations 与 GET /api/inspirations/latest，供 Task 5 使用。

- [ ] **Step 1: 写失败的契约测试**

~~~typescript
it('wraps a completed research result in data.item', async () => {
  mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
  mock.method(inspirationService, 'request', async () => ({ status: 'created', item: itemFixture }));
  const error = await invokeRoute(postHandler, { body: {} }, response);
  assert.equal(error, undefined);
  assert.deepEqual(response.body, {
    success: true, message: '研究灵感已生成', data: { status: 'created', item: itemFixture },
  });
});

it('returns a stable in-progress error without query or note data', async () => {
  mock.method(inspirationService, 'request', async () => { throw inspirationError('INSPIRATION_IN_PROGRESS', 409); });
  const error = await invokeRoute(postHandler, {}, response);
  globalErrorHandler(error as never, request as never, response as never, noop);
  assert.equal((response.body as any).code, 'INSPIRATION_IN_PROGRESS');
  assert.doesNotMatch(JSON.stringify(response.body), /query|content|summary/);
});
~~~

- [ ] **Step 2: 运行并确认红灯**

Run: npm --prefix backend test -- tests/inspirationHttpContract.test.ts

Expected: FAIL，因为路由与挂载不存在。

- [ ] **Step 3: 实现窄认证路由**

~~~typescript
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  const user = await UserValidator.authenticateUser(req);
  const result = await inspirationService.request(user._id.toString());
  ResponseHandler.success(res, result, result.status === 'created' ? '研究灵感已生成' : '这次没有找到新灵感');
}));

router.get('/latest', authenticateToken, asyncHandler(async (req, res) => {
  const user = await UserValidator.authenticateUser(req);
  ResponseHandler.success(res, { item: await inspirationService.latest(user._id.toString()) }, '获取最新灵感成功');
}));
~~~

在 backend/index.ts 导入 inspirationRoutes 并挂载 app.use('/api/inspirations', inspirationRoutes)。不读取请求 body，也不加入管理路由。

- [ ] **Step 4: 覆盖认证和错误码**

断言路由的第一层包含 authenticateToken；latest 无结果返回 data.item 为 null；SEARCH_PROVIDER_UNAVAILABLE 为 503；另一用户 ID 只能传给自己的 latest。

- [ ] **Step 5: 验证并提交**

Run: npm --prefix backend test -- tests/inspirationHttpContract.test.ts && npm --prefix backend test && npm --prefix backend run typecheck

~~~bash
git add backend/routes/inspirations.ts backend/index.ts backend/tests/inspirationHttpContract.test.ts
git commit -m "feat(inspiration): expose manual research API"
~~~

Expected: PASS；浏览器没有可控笔记、查询或来源输入。

### Task 5: 浏览器 API 客户端和三项导航

**Files:**
- Create: frontend/src/services/inspirationService.ts
- Modify: frontend/src/components/TopNavigation.tsx
- Modify: frontend/src/components/TopNavigation.module.scss
- Modify: frontend/src/components/TopNavigation.test.tsx
- Test: frontend/src/services/inspirationService.test.ts

**Interfaces:**
- Consumes: Task 4 API 与现有 authFetch。
- Produces: getLatestInspiration、requestInspiration、InspirationApiError 和灵感导航入口。

- [ ] **Step 1: 写失败的服务及导航测试**

~~~tsx
it('preserves only stable backend errors', async () => {
  mockAuthFetch.mockResolvedValue(new Response(JSON.stringify({
    success: false, error: '目前无法进行研究', code: 'SEARCH_PROVIDER_UNAVAILABLE',
  }), { status: 503 }));
  await expect(requestInspiration()).rejects.toMatchObject({
    code: 'SEARCH_PROVIDER_UNAVAILABLE', message: '目前无法进行研究', status: 503,
  });
  expect(mockAuthFetch).toHaveBeenCalledWith('/api/inspirations', { method: 'POST' });
});

it('marks inspiration current and keeps notes and chat navigable', () => {
  mockUsePathname.mockReturnValue('/inspiration');
  render(<TopNavigation />);
  expect(screen.getByText('灵感')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: '笔记' })).toHaveAttribute('href', '/notes');
  expect(screen.getByRole('link', { name: '聊天' })).toHaveAttribute('href', '/chat');
});
~~~

- [ ] **Step 2: 运行并确认红灯**

Run: npm --prefix frontend test -- src/services/inspirationService.test.ts src/components/TopNavigation.test.tsx

Expected: FAIL，因为客户端与第三项导航不存在。

- [ ] **Step 3: 实现只含安全 DTO 的 API 客户端**

~~~typescript
export class InspirationApiError extends Error {
  constructor(public readonly code: string | undefined, public readonly status: number, message: string) {
    super(message);
  }
}
export async function requestInspiration(): Promise<RequestInspirationResult> {
  return readInspirationResponse(await authFetch('/api/inspirations', { method: 'POST' }), '暂时无法研究新灵感');
}
export async function getLatestInspiration(): Promise<InspirationItem | null> {
  const data = await readInspirationResponse<{ item: InspirationItem | null }>(
    await authFetch('/api/inspirations/latest'), '暂时无法加载灵感',
  );
  return data.item;
}
~~~

readInspirationResponse 只能读取 error、message、code 与 data；JSON 无法解析时使用 fallback，绝不回显未知响应体。

- [ ] **Step 4: 将导航推广为三项**

menuItems 固定为 笔记 /notes、聊天 /chat、灵感 /inspiration。activeIndex 取第一个 pathname 相等或子路由匹配项。

Sass 改为：

~~~scss
.nav { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.navHoverPill { width: calc((100% - 16px) / 3); }
.nav[data-active-index="0"] { --nav-active: 0; --nav-target: 0; }
.nav[data-active-index="1"] { --nav-active: 1; --nav-target: 1; }
.nav[data-active-index="2"] { --nav-active: 2; --nav-target: 2; }
.nav:has(.navItem:nth-child(2):hover) { --nav-target: 0; }
.nav:has(.navItem:nth-child(3):hover) { --nav-target: 1; }
.nav:has(.navItem:nth-child(4):hover) { --nav-target: 2; }
~~~

- [ ] **Step 5: 验证并提交**

Run: npm --prefix frontend test -- src/services/inspirationService.test.ts src/components/TopNavigation.test.tsx && npm --prefix frontend run typecheck

~~~bash
git add frontend/src/services/inspirationService.ts frontend/src/services/inspirationService.test.ts   frontend/src/components/TopNavigation.tsx frontend/src/components/TopNavigation.module.scss   frontend/src/components/TopNavigation.test.tsx
git commit -m "feat(inspiration): add client API and navigation"
~~~

Expected: PASS；三项导航滑块位置正确，错误码未丢失。

### Task 6: 灵感页面、状态交互与完整验证

**Files:**
- Create: frontend/src/app/inspiration/page.tsx
- Create: frontend/src/app/inspiration/inspiration.module.scss
- Create: frontend/src/app/inspiration/page.test.tsx

**Interfaces:**
- Consumes: Task 5 客户端、现有 notes useAuthGuard 与 TopNavigation。
- Produces: 仅登录用户可访问的 /inspiration 页面。

- [ ] **Step 1: 写失败的页面状态测试**

~~~tsx
it('shows a cited research card before its source list and discloses the data boundary', async () => {
  mockGetLatestInspiration.mockResolvedValue({
    id: 'i1', topicLabel: '知识管理', headline: '把零散记录转成可检验的问题',
    brief: '先把想法变成可验证假设【1】。', whyRelevant: '你近期多次记录了知识整理。',
    nextQuestion: '哪条笔记最值得先验证？', createdAt: '2026-09-22T00:00:00.000Z',
    sources: [{ sourceId: '1', canonicalUrl: 'https://example.com/source', title: '来源标题',
      publisher: 'example.com', snippet: '来源摘要', retrievedAt: '2026-09-22T00:00:00.000Z' }],
  });
  render(<InspirationPage />);
  expect(await screen.findByText('把零散记录转成可检验的问题')).toBeInTheDocument();
  expect(screen.getByText(/不会发送笔记正文/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '来源标题' })).toHaveAttribute('rel', 'noreferrer');
});

it('disables duplicate requests and restores retry after provider failure', async () => {
  mockRequestInspiration.mockRejectedValue(new InspirationApiError(
    'SEARCH_PROVIDER_FAILED', 502, '检索服务暂时不可用',
  ));
  render(<InspirationPage />);
  fireEvent.click(await screen.findByRole('button', { name: '为我研究一条灵感' }));
  expect(screen.getByRole('button', { name: '正在检索并整理来源…' })).toBeDisabled();
  await screen.findByText('检索服务暂时不可用，请重试。');
  expect(screen.getByRole('button', { name: '为我研究一条灵感' })).toBeEnabled();
});
~~~

- [ ] **Step 2: 运行并确认红灯**

Run: npm --prefix frontend test -- src/app/inspiration/page.test.tsx

Expected: FAIL，因为页面与样式不存在。

- [ ] **Step 3: 实现登录守卫和状态机**

只在现有 useAuthGuard 返回 user 后加载 latest。页面状态固定为：

~~~typescript
const [item, setItem] = useState<InspirationItem | null>(null);
const [loading, setLoading] = useState(true);
const [requesting, setRequesting] = useState(false);
const [message, setMessage] = useState<{ kind: 'error' | 'empty'; text: string } | null>(null);
~~~

点击函数必须在 finally 复原按钮：

~~~typescript
const handleResearch = async () => {
  if (requesting) return;
  setRequesting(true); setMessage(null);
  try {
    const result = await requestInspiration();
    if (result.status === 'no_result') {
      setMessage({ kind: 'empty', text: '这次没有找到可展示的新来源。' });
      return;
    }
    setItem(result.item);
  } catch (error) {
    setMessage({ kind: 'error', text: messageForInspirationError(error) });
  } finally {
    setRequesting(false);
  }
};
~~~

messageForInspirationError 对六个稳定错误码给出硬编码中文文案，默认是“暂时无法完成这次研究，请重试。”；禁止显示 stack、未知响应文本、查询或笔记内容。

- [ ] **Step 4: 实现克制的研究卡**

顺序必须是：页面标题及说明、隐私说明、主按钮、状态、成功时的主题标签/headline/brief/whyRelevant/nextQuestion，最后才是“参考来源”。隐私说明固定为“本次只会使用近期笔记的标题、关键词和短摘要；不会发送笔记正文。”

局部 Sass 采用浅灰页面、最大 760px 内容宽、白色圆角卡、深灰正文、细边框和窄屏单列；不得复用笔记页深色变量。外链固定为：

~~~tsx
<a href={source.canonicalUrl} target="_blank" rel="noreferrer" className={styles.sourceLink}>
  <span>{source.title}</span><small>{source.publisher}</small>
</a>
~~~

不渲染保存、忽略、历史、定时或通知控件。

- [ ] **Step 5: 完整验证和提交**

Run: npm --prefix frontend test -- src/app/inspiration/page.test.tsx && npm --prefix frontend test && npm --prefix frontend run typecheck && npm --prefix frontend run build

人工验收：确认浏览器请求不含正文或查询；Tavily 模拟仅收到 query；成功卡先展示研究、来源在底部打开；缺少密钥、429、无效 DeepSeek JSON、无有效笔记分别显示真实状态；另一用户看不到第一位用户结果。

~~~bash
git add frontend/src/app/inspiration/page.tsx frontend/src/app/inspiration/inspiration.module.scss   frontend/src/app/inspiration/page.test.tsx
git commit -m "feat(inspiration): add manual research page"
~~~

Expected: PASS；P15 不夹带 P06、P16、P17 或运营后台代码。

## Final Verification

- [ ] Run: npm run verify
- [ ] Run: npm --prefix frontend run build
- [ ] Run: git diff origin/main...HEAD --check
- [ ] Inspect: git log --oneline origin/main..HEAD
- [ ] 人工验证 Task 6 的五项条件，确认任何源代码、测试夹具、截图、终端输出和提交中都没有生产密钥。

## Self-Review

- **Spec coverage:** Tasks 1 至 3 覆盖最小化、Tavily 搜索、两阶段 DeepSeek、引用验证、来源去重与持久化；Task 4 覆盖认证和稳定错误；Tasks 5 至 6 覆盖手动 UX、数据说明、可追溯来源和页面状态。P06、P16、P17 和运营后台明确未进入任务。
- **Placeholder scan:** 没有 TBD、TODO 或“类似前一任务”；每项实现任务都给出接口、测试、行为、命令和提交目标。
- **Type consistency:** ResearchSource、ResearchPlan、ResearchDraft、InspirationDto 先在 Task 1 定义；sourceId 始终是字符串，引用格式始终为 【sourceId】。
- **Review focus:** 五项高风险输入或失败条件均在 Tasks 1、2、3、4、6 有对应测试。
