# 笔记工作区（S1）

page.tsx 保留真实 useNotes 游标分页与创建时间倒序，列表按创建日期分组，不重排全库或把已加载条数显示为总数。/notes?highlight=<id> 为独立阅读入口；未在列表的来源由 useFocusedSourceNote 单独读取并保持 revision、推荐与删除状态隔离。列表节点持续挂载，阅读返回恢复原滚动和已加载范围。

快速记录和侧栏统一使用 /notes?compose=1；创建状态由该 URL 派生，保存、取消或离开才移除参数。普通侧栏导航回 /notes、历史后退和前进都与实际视图同步，不在路由 effect 重复发起未保存保护。刷新或前进回新建 URL 时通过原 useCreateNote 恢复已有本机草稿。NoteWorkspaceReader、NoteWorkspaceEditor、相关栏独立懒加载；useCreateNote 位于编辑器内，避免列表初始包引入 Tiptap schema。阅读无标题时正文直接开始；列表使用现有 noteReferenceDisplay 生成辨认文字，不写回标题。

NoteWorkspaceEditor 复用真实 useNoteEditor / useCreateNote、Tiptap、标题建议与校验、异步草稿和 revision 冲突保护。标题与正文同事务显式保存，Cmd/Ctrl+Enter 与按钮共用一条保存链。常驻格式栏通过 RichTextEditor 新增的可选 onEditorReady 回调复用同一真实实例；保留原 bubble、slash、图片、链接、表格等能力。回调只增加注册/清理，不影响旧调用方。

useNoteEditor 提供实时 isDirty/isSaving getter；保存仅在确认成功且没有后续修改时返回 true。未改动的字段采用服务端标准版本，后来输入继续保留。工作区保护保存不会自行导航，待执行动作由外壳统一处理。

设置、主题、侧栏开关均由外壳覆盖显示，不卸载编辑器。返回、取消、指定笔记、新建和相关来源替换都经过 workspace.requestAction；未提供工作区 Provider 时保留独立组件可测性。删除使用真实服务确认，失败保留阅读和弹窗，成功才返回列表。相关栏只在主动开启时存在，并保留推荐刷新及独立来源 revision 校验。

NotesWorkspace.module.scss 仅作用笔记页面，消费外壳 --ws-* tokens；主列 800px，关联栏在 1200px 切换。不添加导航占位或额外视口高度。旧 ModernNoteCard 与共享其他页面行为不变。

回归覆盖 page.test.tsx、NoteWorkspaceEditor.test.tsx 和 useNoteEditor.workspace.test.tsx，并运行既有笔记 hooks、富文本与推荐关联测试。完整执行证据见仓库根 .superpowers/workspace-ui-migration/notes-report.md。

历史没有 contentJson 的笔记继续使用既有 viewer 的 Markdown 字符串通道；没有 Markdown 格式的纯文字多行在阅读投影中保留换行，不写回正文。阅读页“和 AI 讨论”通过真实 startNoteConversation 保存 sourceNoteId 与空 messages，得到服务端ID后才进入 /chat?session=ID；提示不写作AI回答。请求同步防重入，失败原地显示且保留来源；离开页面或切换来源后迟到响应不导航。发起和服务返回后均走工作区保护，避免网络等待中产生的草稿丢失。page.discuss.test.tsx 覆盖服务拒绝、双击、真实ID、空标题及二次保护。S1 最终自动检查：新增4文件23测试，笔记相关24文件148测试；整合时完整前端58文件449测试通过。生产构建、预算和最终浏览器验收由公共工作区负责人继续。

讨论请求按来源会话身份归属：A→列表/B→A 或账户切换后返回同一 ID，也不会恢复旧成功/失败响应及旧待确认导航。请求 settled 后只要来源会话未变，等待用户处理未保存保护的导航回调仍然有效；page.discuss.test.tsx 使用 deferred 请求覆盖这些边界。

P2 新建路由同步回归：page.compose-navigation.test.tsx 使用真实工作区导航 hook、真实创建草稿 hook 和 Tiptap，覆盖干净离开、保存离开、放弃离开、取消/刷新恢复和完成的前进后退 URL 投影。具体结果见 notes-report.md 的 P2 补充记录。

阅读菜单的删除项会在菜单关闭前传递“更多笔记操作”按钮的稳定引用；页面删除确认保存该入口，取消、Escape 或点击遮罩关闭时显式恢复焦点。page.delete-focus.test.tsx 使用真实 Reader 菜单与页面弹窗覆盖这三条路径，避免仅 mock 直接删除按钮而漏掉菜单卸载后的焦点丢失。

最终审阅 F1：useNotes 仅透传现有 React Query 的 isSuccess；页面在当前身份存在且查询成功时登记最近五条（确认空库也登记）。未加载/初次失败的默认空数组不覆盖已有投影，也不阻断离开后的轻量读取。page.recent-registration.test.tsx 使用真实 NotesPage、useNotes、WorkspaceRoot 和 QueryClient，覆盖延迟首屏离开、首次失败离开、真实空库不重读、已有投影保留及首屏分页仍可用；轻量读取不预填笔记缓存。

发布前修复：删除请求只在发起用户/来源页面会话仍有效时导航，卸载、换用户、来源离开再返回不能被旧响应抢导航。旧正文优先 contentJson，否则原 content（再 contentText）完整经过既有 Markdown 解析器；Reader 为 Viewer 开启 preserveLineBreaks，Markdown breaks:true 保留软换行，不再用语法子集正则分类，默认 Viewer/编辑器不变。已有笔记无修改保存直接回阅读，不发空写入，新建仍走正常校验保存。
