# 页面组合与路由边界

[layout.tsx](layout.tsx) 保留 Providers、键盘辅助、UUID 与提示服务，通过 [WorkspaceRoot](../components/workspace/WorkspaceRoot.tsx) 将 `/notes`、`/chat`、`/inspiration`、`/profile` 放入持久工作区。登录、注册、重置密码和全部 `/admin/**` 不进入工作区主题；不因共享 context 存在而跳过认证检查。

页面组合真实 hooks/services，公共导航与弹层由[工作区](../components/workspace/README.md)协调。产品范围以 [PRODUCT.md](../../../PRODUCT.md) 为准，视觉规则以 [DESIGN.md](../../../DESIGN.md) 为准，业务边界见[现行架构](../../../ARCHITECTURE_DOCUMENTATION.md)。

| 模块 | 维护说明 |
| --- | --- |
| 笔记 | [列表、阅读、显式保存与来源导航](notes/README.md) |
| 对话 | [会话选择、流式提交与来源往返](chat/README.md) |
| 灵感 | [阅读状态、研究请求与定期设置](inspiration/README.md) |
| 个人页 | [画像、账户表单与会话保护](profile/README.md) |

认证页 [auth/page.tsx](auth/page.tsx) 组合登录、注册和重置密码表单。输入框使用关联标签，密码显示按钮说明当前动作；视觉隐藏标签保留辅助技术语义。[auth/page.test.tsx](auth/page.test.tsx) 验证各模式的可访问名称，不能替代真实邮件或读屏验收。

认证页与[运营后台登录页](admin/login/page.tsx) 使用稳定的表单 ID、字段 ID/name，以及 `username`、`current-password`（登录）、`new-password`（注册或重置）和 `one-time-code` 标记，供浏览器密码管理器识别。表单声明 POST，仍通过现有异步请求提交。Chrome 保存提示与再次回填需要在启用密码保存的真实浏览器中验收；组件测试不能验证浏览器原生提示。

品牌图标由根目录的 `icon.svg`、`favicon.ico`、`apple-icon.png` 文件约定统一声明，不在 layout 手动重复配置。认证页与运营后台复用 [BrandIcon](../components/brand/BrandIcon.tsx)，素材生成见 [brand 说明](../../public/brand/README.md)。

认证页品牌组合保持整组居中；深色媒体查询同时为品牌文字与标题设置浅色，避免不可见文字占位造成图形视觉偏移。
