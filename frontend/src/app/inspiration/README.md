# 灵感页面

`page.tsx` 在持续工作区内呈现最大 800px 的开放文章、为何相关、下一问题、真实编号来源和 recent/saved/dismissed 历史。来源标题、引用编号、站点、链接及检索日期来自真实 DTO；`SourceExcerpt` 继续以安全纯文本展示和展开摘录。检索日期不能称为发布时间。

## 设置的唯一所有者

生产 `WorkspaceShell` 调用一次 `hooks/useInspirationSettings(userId?)`，并通过 `WorkspaceContext.inspirationSettings` 提供 `InspirationSettingsController`。页面仅消费该控制器，以简要真实状态和 `openSettings('inspiration')` 提供入口；`ScheduledDiscoverySettings({ controller })` 在设置中呈现完整披露和开关。只有完全不在 Workspace 中独立渲染时，`StandaloneInspiration` 才挂载 fallback hook。不要在页面或设置再请求一套 GET/PUT，也不要加入本机 consent 门禁。

控制器以当前用户、读取代次和同步保存锁隔离异步结果。GET 不覆盖后续 PUT；切换用户或卸载后，旧请求不得写入当前状态。开关等真实 PUT 成功后才更新；失败保留最后服务端值并允许重试。使用服务端 `nextEligibleAt` 显示“下次可检查”，不计算客户端调度时间或虚构同意状态。完整披露保留近期笔记标题（若有）/短摘要、DeepSeek 受限元数据、Tavily 仅查询、每 24 小时最多一次、结果进入历史及开启不立即研究。

## 请求及选择保护

页面以账户 ID 隔离阅读会话。选择详情、发起研究和整理操作使用选择代次：A 后选 B，A 的详情/已读/整理回包不得替换 B；研究期间选择历史，完成的研究进入历史而不抢占阅读。已读回包只合并 `viewedAt`，不能覆盖之后的收藏或忽略状态。手动研究和整理分别有同步重入锁。定期关闭、加载失败或保存失败均不影响手动研究。

过滤或分页失败保留当前详情；收藏/取消/忽略/恢复采用真实服务返回值。分页继续使用服务端游标，不根据本地历史条数伪造统计。未读数量通过原有 API 和 `inspiration-count-changed` 事件同步。

## 验证

```sh
npm --prefix frontend test -- src/app/inspiration/page.test.tsx src/hooks/useInspirationSettings.test.tsx src/app/inspiration/components/ScheduledDiscoverySettings.test.tsx src/app/inspiration/components/SourceExcerpt.test.tsx src/app/inspiration/utils/sourceExcerpt.test.ts src/services/inspirationService.test.ts
```

本模块样式使用工作区 `--ws-*` tokens；按钮显式使用 `button.类名` 以抵抗工作区 reset，来源链接额外限定在页面内。无全局主题或 100vh 内层滚动容器。真实浏览器布局、原生设置弹层和服务端 AI/调度验收由整合阶段统一执行。
