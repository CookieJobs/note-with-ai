# 灵感页面

[page.tsx](page.tsx) 在持续工作区内展示正文、为何相关、下一问题、真实编号来源及 recent/saved/dismissed 历史。来源标题、编号、站点、链接和检索日期取自真实 DTO；检索日期不能称作发布时间。[SourceExcerpt](components/SourceExcerpt.tsx) 以安全纯文本展示和展开摘录。

## 定期设置的唯一所有者

[WorkspaceShell](../../components/workspace/WorkspaceShell.tsx) 唯一挂载 [useInspirationSettings](../../hooks/useInspirationSettings.ts)，通过 context 供页面与设置共用。页面提供真实简要状态和 `openSettings('inspiration')` 入口，[ScheduledDiscoverySettings](components/ScheduledDiscoverySettings.tsx) 展示完整说明与开关。只有脱离工作区独立渲染时才挂载 fallback hook，不重复 GET/PUT，不增加本机 consent 门禁。

控制器以用户身份、读取代次和同步保存锁隔离异步响应：旧 GET 不覆盖后续 PUT，旧账户或卸载后的响应不能写回。开关在真实 PUT 成功后更新，失败保留最后服务端值并允许重试；用 `nextEligibleAt` 显示“下次可检查”，不由前端虚构调度时间。

设置披露近期笔记标题（若有）/短摘要、DeepSeek 接收受限元数据、Tavily 仅接收查询、每 24 小时最多一次、结果进入历史以及开启不立即研究。定期关闭或设置失败不阻断手动研究；后台进程与启用条件见[部署指南](../../../../deploy/DEPLOY_GUIDE.md)。

## 阅读与请求隔离

阅读状态按账户隔离，详情、研究和整理按选择代次归属：A 后选 B，A 的迟到结果不能替换 B；研究期间改选历史，研究完成只进入历史，不抢当前阅读。已读响应仅合并 `viewedAt`，不能覆盖之后的收藏/忽略状态。手动研究与整理均同步防重入。

筛选或分页失败保留当前详情；收藏、取消、忽略、恢复用真实服务结果。分页使用服务端游标，不凭本地条数伪造统计。未读数通过既有 API 与 `inspiration-count-changed` 事件同步。

样式消费工作区 tokens，不设置全局主题或嵌套视口高度。回归入口：[页面](page.test.tsx)、[设置控制器](../../hooks/useInspirationSettings.test.tsx)、[设置披露](components/ScheduledDiscoverySettings.test.tsx)；浏览器、AI 与调度验收范围属于发布记录。
