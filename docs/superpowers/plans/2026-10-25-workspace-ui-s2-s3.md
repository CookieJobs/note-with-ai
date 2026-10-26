# NoteWithAI 工作区 S2/S3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. 按任务勾选，不重复执行已记录的完成项。

**Goal:** 在用户已确认的 S1 基础上完成聊天、灵感、个人页面及真实上下文设置，统一视觉并保留现有业务。

**Architecture:** WorkspaceShell 是唯一共享侧栏和账户弹窗/定期设置 controller 的所有者。聊天页向它注册已有会话数据和动作，不新建第二套 session hook。页面复用既有服务/保存/来源/调度合同，只提取需要跨入口复用的 UI/controller。

**Tech Stack:** Next.js 15、React 18、TypeScript、SCSS Modules、React Query、lucide-react、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-24-workspace-ui-migration-design.md`。S1 已于 2026-10-25 获用户确认，用户明确要求继续，不重复申请实施审批。

## Global Constraints

- 主稿 `design-preview/2026-10-23-整体UI-DeepSeek与Codex整合版.html` 保持原样，强调色 `#266FE1`，仅工作区使用新 tokens；排除所有 `/admin/**`、登录/注册/重置密码。
- 保留真实数据和 API，不新增演示模型/模式、消息重生成/反馈/保存为笔记、删除撤销、订阅、邮箱编辑、画像逐条证据或虚构统计。
- 聊天普通进入默认新对话；来源返回按既有用户/标签页隔离、30分钟内一次性恢复。每轮来源读取最新保存版本，回答 sourceSnapshot 对应确切版本，committed 才代表真实保存；保留60秒idle/180秒total及迟到响应保护。
- 定期关闭不阻止手动研究，不复制演示本机同意门禁；设置以服务端 enabled/consentedAt/nextEligibleAt 为准，不能承诺准时执行。
- 邮箱只读；头像只改用户名时省略avatar；画像只显示现有 summary/expertise/范围/时间，不编造来源链接或分数。
- 桌面1440×900主验收，1280×800、1024×768可达；关联栏1200px切换，窄侧栏沿用S1。
- 保留当前脏工作树，分支 `codex/workspace-ui-migration`；不默认commit/push/部署。公共文件由主代理拥有，各代理只改自己清单，禁止同文件并发写；不并发build同一.next。

## Review Focus

1. 切换历史时，原会话的流、错误和服务端ID替换不能污染当前选择；不要丢问题或将未commit内容显示成已保存。
2. 笔记入口必须真实校验/保存绑定后才导航；指定笔记没有专用AI开场接口，不能把本地固定文字保存成AI回答。
3. 资料、密码和设置覆盖当前工作区，背景编辑器/消息流不卸载；脏表单所有关闭路径、保存中关闭及焦点恢复正确。
4. 两入口共享同一真实定期设置 controller；重复动作、迟到GET/PUT、换用户不串状态，手动研究不被它门禁。
5. 灵感详情GET/已读/生成晚响应不得覆盖新选择；分页/收藏失败保留可读内容。统计/画像独立失败、串行轮询和取消合同不变。

## 公共接口（先冻结，主代理实现）

定义于 `components/workspace/WorkspaceContext.tsx`，新增成员可选，以兼容现有独立组件测试/旧调用者；生产Shell全部提供：

```ts
type WorkspaceSettingsTab = 'appearance' | 'inspiration' | 'account';
type WorkspaceAccountDialogKind = 'profile' | 'password';
type WorkspaceChatNavigation = {
  sessions: IChat[]; currentSessionId: string; isClient: boolean;
  onSessionSelect: (id: string) => void;
  onNewSession: () => void | Promise<void>;
  onDeleteSession: (event: React.MouseEvent, id: string) => void;
};
// 新增：
user?: User | null;
openSettings?: (tab?: WorkspaceSettingsTab) => void;
openAccountDialog?: (kind: WorkspaceAccountDialogKind) => void;
registerChatNavigation?: (value: WorkspaceChatNavigation) => () => void;
inspirationSettings?: InspirationSettingsController;
```

`registerChatNavigation` 的清理采用登记身份比较，旧effect清理不能清新登记。聊天代理用稳定回调/useMemo登记，不因context容器更新循环重注册。Shell在chat路由将新建入口改为“新对话”，复用 `ChatHistoryPanel embedded` 放入原最近笔记区域，不再在聊天页重复绘历史列。

灵感代理导出 `hooks/useInspirationSettings.ts`：

```ts
type InspirationSettingsController = {
  settings: InspirationSettings | null; loading: boolean; saving: boolean;
  error: string | null; refetch: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<boolean>;
};
function useInspirationSettings(userId?: string): InspirationSettingsController;
```

生产只由Shell调用一次，并通过context传给设置与灵感页。无Workspace的独立页面分支才挂载fallback controller，不使用两个生产写入者。`app/inspiration/components/ScheduledDiscoverySettings.tsx` 接收 `{controller: InspirationSettingsController}`，在设置中完整呈现披露和真实开关；灵感页可用相同组件或简要状态+打开设置入口。

个人代理导出 `app/profile/components/WorkspaceAccountDialogs.tsx`，props：`{kind: WorkspaceAccountDialogKind|null; user: User|null; onClose:()=>void; onSaved:(user:User)=>void; returnFocus?: RefObject<HTMLElement|null>}`。生产唯一挂载在Shell；个人页无Workspace的独立分支可挂载同组件测试。保存后Shell仅在同一user.id时合并服务端数据到当前user及原localStorage用户记录，个人页从context消费当前身份。

账户子弹窗留在工作区树和设置上方；设置不先关闭，关闭子弹窗回到设置触发按钮。所有关闭来源统一保护未提交输入，保存中阻止关闭/重入；密码不持久化。顶部原生dialog独占Escape/Tab。

## Task 1: 公共接口与 S2/S3 基线（主代理）

**Files:** Modify `WorkspaceContext.tsx`、`WorkspaceShell.tsx`、`WorkspaceSettings.tsx`、`Workspace.module.scss`、`Workspace.test.tsx`、workspace README；保存本阶段源码快照。

- [x] 保存S1当前frontend/src与DESIGN快照/hash，用于增量审阅；不把git HEAD当干净基线。
- [x] 先写登记清理、chat动态新建/历史、打开指定设置分类、设置→账户嵌套保持业务内容的测试，运行对应Vitest确认准确红灯。
- [x] 增加冻结接口、唯一controller/账户弹窗挂载和服务端用户同步；移除S1账户/灵感跳转占位。样式使用新tokens及`button.类名`防生产重置覆盖。
- [x] 设置的账户摘要包含当前用户名/只读邮箱及真实编辑/密码动作；灵感分类挂载共享真实设置组件。设置打开不导航、不重建业务任务。
- [x] 等任务2/3/4导出就绪后运行 `npx vitest run src/components/workspace/Workspace.test.tsx`，确认绿；剩余原生层叠行为交Task6浏览器验证。

## Task 2: 聊天构图、共享侧栏与真实来源意图（聊天代理）

**Own files:** `app/chat/page.tsx`、`chat.module.scss`、page tests、chat README；`components/ChatHistoryPanel.tsx/.module.scss/.test.tsx`、`ChatMainContent.tsx`、`ChatMessage.tsx/.module.scss/.test.tsx`、`ChatInputArea.tsx/.test.tsx`、`CareAssistantPanel.tsx`、`DeleteConfirmModal.tsx/.test.tsx`；必要的 `hooks/useChatStream.ts`/tests、`useChatSession.ts`/tests、新 `services/noteConversation.ts`/test。不改Workspace、notes或共享components README（交主代理）。

**Interfaces:** 消费Task1的registerChatNavigation；给ChatHistoryPanel添加可选`embedded?:boolean`（默认false），embedded隐藏自身新建头/关闭按钮/独立列宽，保留真实历史/搜索/选中/删除。导出 `startNoteConversation(noteId: string, title?: string): Promise<string>`，通过既有saveChatSessionRemote和本地会话ID工具保存`sourceNoteId`、空messages，只有返回真实ID才resolve。不调用随机robot/intro冒充指定笔记开场。

- [x] 先补回归：工作区生产只一列历史且使用当前session数据；普通进入不选旧会话，显式`/chat?session=<id>`加载对应真实会话，失效ID显示错误不选另一篇；来源返回草稿/位置恢复。
- [x] 增加startNoteConversation测试：服务器拒绝/空ID则reject，接受时payload只有真实sourceNoteId/空messages，不插入assistant固定文本；页面URL消费使用Suspense包裹useSearchParams。
- [x] 迁移为空态820px焦点列、进行中消息与底部输入、1200px/330px关联栏。移除Workspace生产旧第二历史列/旧TopNavigation菜单；独立环境保留fallback，不影响排除页面。
- [x] 笔记绑定但无消息时展示真实来源信息和“围绕这篇笔记提问”的界面提示，不把提示写进消息。旧AI开场首问后收为来源入口；sourceSnapshot与历史消息保持真实。
- [x] 先红测流A→切B：B不显示A的等待/错误，A仍正确更新；ID替换不切换选中的B。最小添加active/error会话身份投影，不重写committed/timeout/SSE。单一流未结束时其他会话不可另启第二流，明确提示，不静默丢提交。
- [x] 先红测删除失败/重试/延迟：确认等待Promise，busy禁重入，失败保留modal/历史；流中原会话删除限制按请求身份判断。
- [x] 运行现有chat、stream、sessionStore、sourceReturn、messages/source、input及新增相关测试；定向lint/typecheck。报告准确结果、文件及未验证项；不build、不改后端、不提交。

## Task 3: 灵感页面与唯一真实定期设置（灵感代理）

**Own files:** `app/inspiration/page.tsx`、`inspiration.module.scss`、page tests、所属README；新 `hooks/useInspirationSettings.ts`/test、`ScheduledDiscoverySettings.tsx`/test。services API和Workspace不改。

- [x] 先写共享controller红测：延迟PUT前不翻转、立即重入不重复提交、失败保留值、迟到GET不覆盖PUT、换user不污染；实现按user隔离的读取/写入代次与真实服务结果。
- [x] 用Task1唯一controller，抽共享设置组件。披露保留DeepSeek接标题/短摘要、Tavily仅查询、24h最多一次、开启不立即研究；nextEligibleAt显示“下次可检查”，不伪造时间或同意状态。
- [x] 先补deferred测试：选择A后选B、A迟到GET/markViewed、生成后又选历史，都不能覆盖当前详情；最小修正当前页面请求代次，不重写服务。
- [x] 按主稿迁移800px开放文章、页首唯一研究动作、浅底下一问题、真实来源编号/展开、三种历史过滤与分页；保留全部错误/no_result理由、已读徽标及收藏/忽略/恢复真实返回。
- [x] 回归定期关闭/设置失败时手动研究仍可用，分页/收藏失败不清当前内容。保持SourceExcerpt安全文本、来源对应及检索日期语义。
- [x] 运行相关页面/controller/service/SourceExcerpt回归和定向lint/typecheck；不build、不改公共文件、不提交。

## Task 4: 个人页面与共享账户表单（个人代理）

**Own files:** `app/profile/page.tsx`、`profile.module.scss`、page tests、所属README、`AvatarPicker.module.scss`；新 `app/profile/components/WorkspaceAccountDialogs.tsx`/test/SCSS。既有user/profile API与Workspace不改。

- [x] 将现有资料/密码逻辑提取到冻结props的唯一组件，先补所有关闭入口脏保护、保存中禁关闭/重入、失败保留输入、迟到响应不污染新user的红测；native dialog留在工作区继承主题。
- [x] 保留用户名20字符/非空、邮箱只读、现有头像预设与旧URL回退；未改头像时不发avatar。密码至少8位含字母数字且两次一致，成功沿用原登出与/auth跳转，不持久化密码。
- [x] 个人页接共享user/actions，去重复生产弹窗；独立页面fallback复用同一实现。按主稿改为身份头、真实两统计、开放账户行、克制画像表面与文字技能等级。
- [x] 保留统计/画像独立错误重试、12秒服务超时、4秒串行轮询最多15次及取消/恢复；失败保留旧画像，recent_up_to_20和unknown准确显示。旧测试按职责迁移，不能删除可靠性断言。
- [x] 运行profile页面/服务/头像及新表单专项、定向lint/typecheck；不build、不改公共文件、不提交。

## Task 5: 笔记→对话与跨入口整合（主代理）

**Files:** notes page/Reader/tests/README；共享components README；Task1公共层与必要测试。

- [x] 在Reader加入“和AI讨论”真实入口，调用Task2函数；登记保护后等待服务端接受，忙时防重复，失败原地显示/不导航。成功进入`/chat?session=<serverId>`，不发送未保存草稿或虚构消息。
- [x] 先红测服务失败/双击、来源ID真实、无标题不强填、成功URL与保存后最新版本；复核来源往返不破坏列表位置/编辑保护。
- [x] 整合共享动态侧栏、设置真实分类与唯一账户弹层，检查注册清理、user同步和两个设置入口的controller身份；不在临时编译缺文件阶段声称检查失败是最终结果。
- [x] 为各任务生成相对本阶段快照的增量包，独立审阅Spec符合性及质量，确认后关闭问题。不得以实施代理自评代替审阅。

## Task 6: 完整验证与整站视觉验收（主代理 + 独立审阅）

- [x] 完整test/typecheck/lint；独立生产副本build与route budgets，记录当前真实输出，不与dev共用.next。
- [x] 浏览器实际检查聊天空态/历史/首问流/来源往返、设置不打断任务、灵感来源/过滤/分页/定期开关、个人资料/头像与画像状态；密码成功会改变凭据，按浏览器规则留人工真实提交，其他验证自动化覆盖。
- [x] 1440/1280/1024、深浅主题、常驻和抽屉关联区，主稿对照截图；排除页面hash/实际登录页面回归。真实服务限制记未验，不用模拟截图冒充真实API验收。
- [x] 最终独立增量审阅，保存截图/运行方法/验证报告，交给用户整体验收。进入等待人工验收前停用自动接续，不保留静默小时轮询。

## 执行与接续裁定

- 用户明确要求继续，计划落盘后直接执行；S1检查点已解除，不另加计划审批检查点。
- 聊天、灵感、个人模块文件互不相交，可与主代理公共整合并行；这按用户授权和明确文件边界执行，避免机械串行拖延。实现者不自行再派代理，共享文件仅主代理写。
- 不默认提交；审阅以本阶段源码快照与精确文件包区分已有改动，保留S1和用户工作。
- 自动接续ID `notewithai`，单次北京时间2026-10-25 05:15:08（当前五小时恢复05:13:08后两分钟）。每次接续在实际工作前读取最新resetsAt并更新下一次单次任务，不按固定五小时猜T2；同时受五小时/周限制时等待所有阻塞窗口恢复。额度可用就继续，不消耗重置权益。
- 完成/取消/需要人工确认或验收时立即停用任务且不再续约。账户额度和本机调度会变化，实际运行仍取决于应用运行与额度可用，不能声称无条件准时执行。


## 最终交付状态

实施、代码复审、67文件564测试、typecheck、lint0errors/10warnings、独立生产build/notes预算和真实浏览器检查完成。全部检查证据及人工边界见 ../reviews/2026-10-25-workspace-ui-s2-s3-verification.md。密码真实成功提交由用户本人最终验证，未等待24h调度；未穷尽所有服务故障端到端场景，不把勾选当作这些未执行项已实测。用户已于2026-10-25确认整体验证无问题，本轮计划收口，不自动实施更多页面或功能。保持分支及未提交改动，无合并/部署。
