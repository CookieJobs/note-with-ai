# 工作区公共层

[WorkspaceRoot](WorkspaceRoot.tsx) 只为 `/notes`、`/chat`、`/inspiration`、`/profile` 挂载持久外壳，认证与全部后台路由不进入它。[WorkspaceShell](WorkspaceShell.tsx) 拥有侧栏、账户菜单、灵感未读数、设置、共享账户 dialog 和唯一未保存确认弹窗。全局规则见 [DESIGN.md](../../../../DESIGN.md)、[现行架构](../../../../ARCHITECTURE_DOCUMENTATION.md)。

## 页面接口与导航

[WorkspaceContext](WorkspaceContext.tsx) 是模块接口：页面登记最新编辑状态、保存动作、最近笔记和真实聊天操作，外壳不拥有第二套业务草稿。登记清理核对身份，旧 effect 不能清除后来登记。

[useWorkspaceNavigation](useWorkspaceNavigation.ts) 统一程序导航、`beforeunload` 和浏览器前进后退保护。未保存时允许保存并继续、放弃或继续编辑；保存失败/冲突或保存期间后来输入不得静默跳转。[WorkspacePopstateBridge](WorkspacePopstateBridge.tsx) 在路由边界持续挂载，工作区活动订阅先于 Next 历史恢复处理；退出工作区移除订阅和 history 包装，认证与后台不修改历史行为。

设置覆盖当前任务，不卸载页面。只有最上层弹层处理 Escape、遮罩和焦点循环，关闭恢复触发焦点。退出登录、改密入口同样经过未保存保护；资料表单保留当前任务上下文，打开中的账户编辑不被另一入口替换。表单和改密成功后的会话清理由[个人页模块](../../app/profile/README.md)说明。

## 共享状态与主题

笔记 tab 的侧栏场景区使用完整记录月历替换最近笔记，按需加载 NotesCalendar，保持翻月、真实统计和局部重试。主内容不再包含第二份月历；页面创建 / 删除成功后通过可选 refreshNotesCalendar 通知外壳更新。阅读和编辑仍属于笔记 tab，月历保持挂载与选中月份；侧栏折叠隐藏、窄窗抽屉按既有规则显示。其他 tab 继续使用原有最近笔记 / 聊天历史，最近笔记投影仍由普通列表维护，方便切换后复用。

[useWorkspaceRecentNotes](useWorkspaceRecentNotes.ts) 仅维护最近五条链接投影。冷进入其他工作区页面且没有当前账户可信投影时，从现有 `/api/notes` 读取首屏；不加载 `useNotes`/Tiptap、不填充 React Query 笔记缓存。笔记页成功登记（含确认空库）优先于迟到读取，未加载/失败不冒充空库；成功投影同账户跨路由复用、不轮询，失败可重试。账户、路由或卸载废弃旧请求。

聊天侧栏消费页面登记的真实历史与操作，不另建会话 hook；长历史列表保留内部滚动，桌面折叠与窄窗抽屉分别处理。定期灵感设置由外壳唯一 controller 拥有，页面与设置共用服务端确认值，详见[灵感模块](../../app/inspiration/README.md)。

[useWorkspacePreferences](useWorkspacePreferences.ts) 校验并恢复本机主题、字号、动效和侧栏偏好。[Workspace.module.scss](Workspace.module.scss) 将 tokens 和旧变量桥接限制在根容器及工作区弹层，不给 html/body 设置全局深色。实色按钮使用 `button.类名` 抵抗 Tailwind reset，默认、悬停、禁用和深浅主题均需浏览器检查。

焦点外框使用零优先级的 `:where(.root :focus-visible)` 作为兜底，让输入框、搜索容器、富文本编辑器各自的焦点样式优先生效，避免点击输入时叠加内部蓝框；笔记页复用外壳规则。按钮和链接仍保留键盘焦点提示。修改后须在浏览器检查鼠标点击与 Tab 导航，包含深浅主题。

回归入口：[外壳与账户隔离](Workspace.test.tsx)、[导航保护](useWorkspaceNavigation.test.tsx)、[最近笔记登记](../../app/notes/page.recent-registration.test.tsx)。原生焦点、长历史滚动和断点布局的验收范围属于发布记录，不能用状态测试代替。

侧栏品牌使用 [BrandIcon](../brand/BrandIcon.tsx) 的蓝色折页图形，继续与 NoteWithAI 文字独立排版；保留 29px 图形容器、原间距与折叠交互，不再叠加旧蓝色底板。
