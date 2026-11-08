# 笔记页面

[page.tsx](page.tsx) 使用真实 `useNotes` 游标分页与创建时间倒序，以正文卡片瀑布流展示，不将已加载条数冒充总数。`?highlight=<id>` 是独立阅读入口；不在列表内的来源单独读取，revision、推荐和删除状态与列表隔离。列表保持挂载，阅读返回恢复滚动和已加载范围。

## 列表、搜索与月历

[NotesFeed](components/NotesFeed.tsx) 按返回数据顺序逐张放入当前最短列，DOM 与键盘顺序保持创建时间倒序。ResizeObserver 仅测量列表内卡片，返回阅读时保持已加载范围、搜索条件、滚动与焦点；阅读和编辑仍使用现有窄内容列。首图复用 noteReferenceDisplay，资源失败降级；不引入列表富文本编辑器。

[useNoteSearch](hooks/useNoteSearch.ts) 为独立只读查询，不改变 useNotes 的普通列表、mutation、revision、临时笔记或富化轮询机制。关键词 300ms 防抖、输入法组字结束后查询，GET `/api/notes?q=...` 全库字面量匹配；普通列表、各关键词分页及滚动位置独立保留。缓存限定当前挂载页面和账号，切换账号清空；请求带取消信号且校验当前查询版本，迟到响应不能回填。新建、编辑或删除成功后更新只读查询版本；重新验证先前已加载的搜索页数，不把不匹配笔记塞入搜索，也不污染侧栏最近笔记。

[NotesCalendar](components/NotesCalendar.tsx) 和 [useNoteCalendar](hooks/useNoteCalendar.ts) 展示真实月份、笔记数和记录天数。数据来自 `/api/notes/calendar?month=YYYY-MM`，固定北京时间，按创建日期统计当前仍存在的笔记；搜索不改变统计，日期不可点击筛选。月历由工作区外壳在笔记 tab 的侧栏渲染，替换最近笔记，不占卡片区宽度；笔记阅读和编辑时仍保留，折叠 / 抽屉沿用侧栏行为。页面在创建 / 删除成功后通过 refreshNotesCalendar 通知外壳刷新。创建 / 删除成功刷新统计，编辑正文不刷新；切月和账号切换阻止旧数据回填。错误局部重试，不以 0 代替失败。

## 创建、编辑与保存

快速记录与侧栏统一使用 `/notes?compose=1`，URL 决定创建状态。保存、取消或离开才移除参数；刷新、前进后退与实际视图同步，通过 [useCreateNote](hooks/useCreateNote.ts) 恢复既有本机草稿。阅读器、编辑器和相关栏独立懒加载，不让列表首屏引入 Tiptap schema。

标题可选，无标题阅读直接从正文开始；列表和侧栏用 `noteReferenceDisplay` 生成辨认文字，不写回标题。标签与话题目录已退役。编辑复用真实 Tiptap 与 [useNoteEditor](hooks/useNoteEditor.ts)，保留拟标题保护、格式、图片、链接、表格和 revision 冲突校验。标题与正文同事务显式保存，Cmd/Ctrl+Enter 与按钮共用保存链；未改动的既有笔记直接回阅读，不发空写入。

保存只有在服务端成功且没有后来输入时才结束当前编辑。失败或冲突保留内容，未改动字段使用服务端标准版本，保存中的新输入不能清除。历史无 `contentJson` 的正文走既有 Markdown viewer，阅读保留软换行，不写回原文或改变编辑器默认行为。

## 导航与来源

返回、取消、换笔记、新建和关联来源替换经过[工作区未保存保护](../../components/workspace/README.md)，保存动作本身不导航。设置、主题和侧栏切换不卸载编辑器。删除只在真实服务成功且原用户/来源页面会话仍有效时导航，失败保留阅读和确认弹窗；取消、Escape 或遮罩关闭后恢复“更多笔记操作”入口焦点。

从聊天打开的笔记使用 `?highlight=<noteId>&fromChat=<sessionId>`。当前账号在本标签页内有匹配且未过期的来源快照时，阅读和编辑顶部固定显示“返回刚才的对话”及原会话标题；相关笔记跳转继续携带同一标记，刷新可恢复入口。读取笔记不会消费聊天草稿/位置快照；返回通过工作区未保存保护进入 `/chat?session=<sessionId>`，由聊天页恢复。普通笔记入口、列表、新建、缺失或过期快照及账号不匹配时不显示返回栏。

“和 AI 讨论”调用 [startNoteConversation](../../services/noteConversation.ts)，保存真实空绑定会话后才进入 `/chat?session=ID`。同步防重入；发起与响应后的导航都经过未保存保护。卸载、换用户或离开来源后返回同一 ID，旧响应也不能抢导航；错误原地显示，保留来源和草稿。

页面只在当前用户的列表查询成功后登记最近五条，确认空库也登记；初次加载或失败的默认空数组不覆盖可信投影。相关栏按主动开启显示，保留推荐刷新与独立来源 revision 校验。

总规则见 [DESIGN.md](../../../../DESIGN.md)、[现行架构](../../../../ARCHITECTURE_DOCUMENTATION.md)。回归入口为 `page*.test.tsx`、[编辑器保存保护](hooks/useNoteEditor.workspace.test.tsx)和 [useCreateNote.test.tsx](hooks/useCreateNote.test.tsx)；执行结果属于版本记录。列表新增验证入口为 `page.feed.test.tsx`、`useNoteSearch.test.tsx`、`useNoteCalendar.test.tsx` 与 `noteFeed.test.ts`；侧栏位置及刷新验证见 `Workspace.notes-calendar.test.tsx`。
