# 共享组件

页面构图与色彩以 [DESIGN.md](../../../DESIGN.md) 为准，导航、主题和弹层归[工作区公共层](workspace/README.md)管理。组件复用真实 props 与业务回调，不另建服务状态。

## 回答与来源展示

[ChatMessage](ChatMessage.tsx) 支持 GFM 表格，宽表格放在有名称、可聚焦的横向滚动区域。助手回答的 `sourceSnapshot` 显示为“本次回答依据”，含笔记链接、revision、精确版本时间及可展开的当轮纯文字；有图片时说明尚未识别。用户消息不展示来源，后来笔记更新不能改写历史回答依据。

[ChatMainContent](ChatMainContent.tsx) 透传每条消息的快照和页面提供的来源返回位置。[ChatOpeningNote](ChatOpeningNote.tsx) 为旧历史中的真实开场展示“笔记原文”摘录和 AI 身份，超过 160 字可展开；无标题直接显示正文，不虚构标题。绑定会话首条助手消息没有快照时，可用会话上下文识别开场，但不能借用后来回答的快照。新笔记入口创建空绑定会话，不由组件生成固定 AI 消息。

[ChatInputArea](ChatInputArea.tsx) 支持普通起始页和笔记提问情境，来源错误用可访问的内联提示。`CareAssistantPanel` 兼容真实开场、原文和来源，无来源时不暗示已读取笔记。旧 `relatedNotes` 是讨论线索，不冒充回答依据。

[ReferenceNote](ReferenceNote.tsx) 供笔记/聊天关联区共用，标题完整换行，摘要与日期分开显示。`ChatRelatedNotesPanel` 用于发现其他记录；绑定笔记去重和可见性由聊天页负责。`ChatHistoryPanel` embedded 模式复用真实搜索、选择和删除，隐藏重复工具栏；流式等待/错误与删除确认由页面或工作区控制。

[ChatNotePreview](ChatNotePreview.tsx) 是聊天内的轻量只读原文面板，复用独立来源读取 hook 和按需加载的富文本 viewer，保留无标题、格式与软换行。不提供编辑、关联推荐或新建讨论；阅读完整笔记和关闭是两个常规操作。桌面替换相关栏，窄屏抽屉及焦点由聊天页负责；只有用户主动进入完整笔记页才保存往返上下文。组件读取失败可以重试，过期响应与账号切换沿用来源 hook 的隔离。

工作区内 `TopNavigation` 不再绘制，独立环境保留原行为。页面链接先完成业务来源记录，再进入统一未保存保护。来源展示回归见 [ChatMessage.test.tsx](ChatMessage.test.tsx)，会话恢复见[聊天页说明](../app/chat/README.md)。

[brand/BrandIcon](brand/BrandIcon.tsx) 是统一品牌图形入口，覆盖工作区、独立导航、认证、后台和普通 AI 回答身份。仅替换品牌露出，功能图标沿用原语义；素材与生成说明见 [品牌资源](../../public/brand/README.md)。
