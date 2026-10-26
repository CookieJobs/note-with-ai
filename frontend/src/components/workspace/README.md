# 工作区公共层

`WorkspaceRoot` 按普通用户路由隔离新外壳，认证与后台不进入它。`WorkspaceShell` 提供侧栏、账户菜单、真实灵感未读数、上下文设置和唯一的未保存确认弹窗。

`WorkspaceContext` 是模块之间的接口：页面登记当前编辑器的最新状态与保存动作、最近笔记；公共层统一导航保护，不拥有第二套业务草稿。`useWorkspaceNavigation` 负责程序导航、beforeunload、可回退的浏览器历史保护，卸载时移除监听并恢复 history 包装。`WorkspacePopstateBridge` 在路由边界始终挂载，以便登录后才进入工作区时仍先于 Next 的历史恢复收到事件；仅活动工作区订阅处理，认证和后台无订阅、无 history 修改。设置打开不卸载页面。

`useWorkspacePreferences` 校验并恢复本机主题/字号/动效/侧栏偏好。`Workspace.module.scss` 的 tokens 只作用于根容器，旧业务变量在此作用域内桥接新色板；不修改 html/body 的主题。

`useWorkspaceRecentNotes` 保留独立的最近五条链接投影。冷进入非笔记页且没有本账户已登记投影时，通过现有 `/api/notes` 读取首屏并复用 `noteReferenceDisplay` 辨认文字；不加载 useNotes/Tiptap，不填充 React Query `['notes']` 缓存，避免丢失笔记页 hook 自己维护的分页游标。笔记页登记（包含空列表）优先于迟到读取，后续登记可以继续更新；成功投影在同账户路由间复用，不轮询。账户/路由转换及卸载会废弃旧请求，加载、真实空列表和失败分别显示，失败提供重试。

带实色背景的按钮使用 `button.类名` 选择器，保证默认背景不被生产包中后加载的 Tailwind `[type="button"]` 重置覆盖；悬停、禁用与默认状态均须在浏览器核验。

聊天页向工作区登记真实会话及动作，侧栏使用 embedded ChatHistoryPanel；当前页不再重复历史列。登记清理按身份核对，旧effect不清除新登记。灵感定期设置由Shell唯一controller拥有，设置和灵感页共用服务端确认状态；手动研究不受开关门禁。账户弹窗在设置上层唯一挂载，背景页面和设置保持，保存后将同用户的真实返回数据同步到共享身份和既有用户缓存；头像使用原预设/旧URL/失败字母回退。打开中的账户编辑不会被另一次入口替换。工作区内不再绘制旧 TopNavigation，旧组件独立渲染仍保留原行为。

接受资料保存响应前重新读取持久用户身份；若其他标签页已切换账户或清除身份，忽略旧资料响应并将共享身份同步为当前缓存，不覆盖或恢复旧账户。Workspace.test.tsx 以 deferred 响应覆盖这两种场景及正常保存。

设计依据见根目录 DESIGN.md，范围与进度见 docs 中的整体迁移 Spec/计划/恢复记录。

最终审阅 F1/F4：笔记页仅登记查询已成功的列表，未加载/失败不声称确认空库；轻量 hook 继续只接收可信投影，不预填 notes 缓存。聊天历史 section 建立纵向 flex，配合既有 embedded sidebar/list 的 min-height:0，把剩余高度传给内部滚动列表；保留全部历史数据。长历史的可滚动、选择/删除及窄侧栏可达性由 Root 在真实浏览器复验。

F4 窄窗补充：桌面折叠偏好进入 ≤980px 抽屉后，通用 expandedLabel 的 display:revert 会覆盖历史 section 的 flex。已在既有 collapsed + drawer-open 窄窗规则内随后恢复 chatHistory display:flex；桌面折叠仍隐藏历史。该分支由 Root 的真实长历史浏览器复现确认，Sass 编译通过，原生滚动复验仍由 Root 执行。

发布前修复：修改密码入口先经过同一 requestAction 未保存保护，继续编辑或保存失败不会打开密码表单，保存/明确放弃后才进入。资料表单保持上下文行为。改密成功的会话清理由 passwordChangeSession 独立调度，不由弹窗卸载取消，并核对原用户和 token，防止误退出后来的会话。
