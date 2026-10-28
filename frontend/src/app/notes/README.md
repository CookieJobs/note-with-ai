# 笔记页面

[page.tsx](page.tsx) 使用真实 `useNotes` 游标分页与创建时间倒序，按创建日期分组，不将已加载条数冒充总数。`?highlight=<id>` 是独立阅读入口；不在列表内的来源单独读取，revision、推荐和删除状态与列表隔离。列表保持挂载，阅读返回恢复滚动和已加载范围。

## 创建、编辑与保存

快速记录与侧栏统一使用 `/notes?compose=1`，URL 决定创建状态。保存、取消或离开才移除参数；刷新、前进后退与实际视图同步，通过 [useCreateNote](hooks/useCreateNote.ts) 恢复既有本机草稿。阅读器、编辑器和相关栏独立懒加载，不让列表首屏引入 Tiptap schema。

标题可选，无标题阅读直接从正文开始；列表和侧栏用 `noteReferenceDisplay` 生成辨认文字，不写回标题。标签与话题目录已退役。编辑复用真实 Tiptap 与 [useNoteEditor](hooks/useNoteEditor.ts)，保留拟标题保护、格式、图片、链接、表格和 revision 冲突校验。标题与正文同事务显式保存，Cmd/Ctrl+Enter 与按钮共用保存链；未改动的既有笔记直接回阅读，不发空写入。

保存只有在服务端成功且没有后来输入时才结束当前编辑。失败或冲突保留内容，未改动字段使用服务端标准版本，保存中的新输入不能清除。历史无 `contentJson` 的正文走既有 Markdown viewer，阅读保留软换行，不写回原文或改变编辑器默认行为。

## 导航与来源

返回、取消、换笔记、新建和关联来源替换经过[工作区未保存保护](../../components/workspace/README.md)，保存动作本身不导航。设置、主题和侧栏切换不卸载编辑器。删除只在真实服务成功且原用户/来源页面会话仍有效时导航，失败保留阅读和确认弹窗；取消、Escape 或遮罩关闭后恢复“更多笔记操作”入口焦点。

“和 AI 讨论”调用 [startNoteConversation](../../services/noteConversation.ts)，保存真实空绑定会话后才进入 `/chat?session=ID`。同步防重入；发起与响应后的导航都经过未保存保护。卸载、换用户或离开来源后返回同一 ID，旧响应也不能抢导航；错误原地显示，保留来源和草稿。

页面只在当前用户的列表查询成功后登记最近五条，确认空库也登记；初次加载或失败的默认空数组不覆盖可信投影。相关栏按主动开启显示，保留推荐刷新与独立来源 revision 校验。

总规则见 [DESIGN.md](../../../../DESIGN.md)、[现行架构](../../../../ARCHITECTURE_DOCUMENTATION.md)。回归入口为 `page*.test.tsx`、[编辑器保存保护](hooks/useNoteEditor.workspace.test.tsx)和 [useCreateNote.test.tsx](hooks/useCreateNote.test.tsx)；执行结果属于发布记录。
