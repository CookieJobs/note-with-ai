# 个人页与账户表单

`page.tsx` 在工作区消费 `WorkspaceContext.user/openAccountDialog/openSettings`；生产弹窗由 WorkspaceShell 唯一挂载。无工作区的隔离渲染保留原身份检查，并复用相同表单作为 fallback。

`components/WorkspaceAccountDialogs.tsx` 默认导出共享资料/密码原生 dialog，props 见具名 `WorkspaceAccountDialogsProps`。`kind` 与 `user.id` 定义一次表单会话；Root 可用 `returnFocus` 传回设置中触发按钮。取消、关闭、Escape 和遮罩统一保护脏输入，明确放弃才关闭，保存中禁关闭/重入。请求失败保留输入，卸载/换用户后的迟到响应被忽略。资料只改用户名时省略 avatar；邮箱只读，旧头像与稳定预设继续由 AvatarPicker 处理。密码只保存在组件内存，服务端成功后调用既有 `logout()`。

统计/画像继续独立加载、失败重试；画像保留服务层 12 秒超时、4 秒串行轮询与最多 15 次检查、卸载/换用户取消、历史画像和恢复分析。展示仅使用现有 summary/expertise、输入范围与真实时间；技能级别是 AI 归纳，不添加分数、技能条或来源证据。

专项检查：

```sh
npx vitest run src/app/profile/page.test.tsx src/app/profile/components/WorkspaceAccountDialogs.test.tsx src/app/profile/AvatarPicker.test.tsx src/services/profileService.test.ts
npx eslint src/app/profile/page.tsx src/app/profile/page.test.tsx src/app/profile/components/WorkspaceAccountDialogs.tsx src/app/profile/components/WorkspaceAccountDialogs.test.tsx
```

原生顶层焦点约束、嵌套设置与深浅色布局由整合后的浏览器检查验证；jsdom 的 dialog stub 只用于状态测试。

Task 6 尺度收口：桌面个人页姓名标题由 27px 调整为设计规范的 26px，其余个人页样式和行为不变。

最终审阅 F3：生产 Workspace 分支也先检查真实认证状态；未认证直接引导 /auth，不因存在共享 context 跳过守卫。共享 user 初始 null 不作为未认证证据，有效登录等待 Shell 初始化身份。page.test.tsx 通过真实 Providers/WorkspaceRoot 覆盖未登录入口和有效用户初始化，保留已有账户切换/迟到响应隔离回归。

发布前修复：资料迟到响应继续忽略；改密成功后的会话清理属于业务后续，交给 utils/passwordChangeSession，表单卸载也会完成原 1500ms 退出。请求前捕获的用户/token 必须仍相同才退出，不能清除之后登录的账户。工作区入口先处理后台脏笔记，密码不进入本地存储或定时器闭包。
