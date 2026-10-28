# 个人页与账户表单

[page.tsx](page.tsx) 使用[工作区](../../components/workspace/README.md)的共享身份、账户弹窗和设置入口。生产与独立渲染都检查真实认证状态；共享 `user` 尚未初始化不等于未登录，有效登录等待外壳初始化身份。独立环境复用同一表单。

## 账户表单

[WorkspaceAccountDialogs](components/WorkspaceAccountDialogs.tsx) 是共享资料/密码原生 dialog，由外壳唯一挂载。`kind + user.id` 定义表单会话，触发入口可传 `returnFocus`。取消、关闭、Escape 和遮罩保护脏输入，明确放弃才关闭；保存中禁关闭和重入，失败保留输入。卸载或换账户后的资料响应不能写回。

资料只改用户名时省略 avatar，邮箱只读；头像复用既有稳定预设、旧 URL 和失败字母回退。外壳接受成功响应前再次核对持久用户身份，跨标签页换账户或退出后不恢复旧账户。

改密入口先处理后台脏笔记。密码仅存于表单内存；真实改密成功后由 [passwordChangeSession](../../utils/passwordChangeSession.ts) 安排既有 1,500ms 退出，即使表单卸载也完成。清理前核对请求发起时的用户和 token，不能退出后来登录的账户，密码不进入本地存储或定时器闭包。

## 统计与画像

统计和画像独立加载、失败重试；画像沿用服务层 12 秒超时、4 秒串行轮询、最多 15 次检查，以及卸载/换用户取消、历史画像和恢复分析。只展示真实 summary/expertise、输入范围和时间；技能级别属于 AI 归纳，不虚构分数、能力条或逐条来源证据。话题目录已退役。

回归入口：[页面身份与画像](page.test.tsx)、[账户 dialog](components/WorkspaceAccountDialogs.test.tsx)、[头像](AvatarPicker.test.tsx)、[画像服务](../../services/profileService.test.ts)。原生嵌套焦点和深浅色布局仍需浏览器验证，jsdom dialog stub 仅验证状态。
