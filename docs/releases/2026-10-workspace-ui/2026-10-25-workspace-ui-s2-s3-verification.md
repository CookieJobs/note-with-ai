# NoteWithAI 工作区 UI 迁移 S2/S3 验收记录

日期：2026-10-25。历史验收：**S2/S3 实施、独立审阅与本机生产浏览器验收已完成，用户已确认整体结果。** 基线为已确认的 S1；当时的 [迁移 Spec](2026-10-24-workspace-ui-migration-design.md) 已收口。后续修复及生产发布见 [版本摘要](../2026-10-workspace-ui.md)。当前规范以根目录 [DESIGN.md](../../../DESIGN.md) 与 [ARCHITECTURE_DOCUMENTATION.md](../../../ARCHITECTURE_DOCUMENTATION.md) 为准。

## 实施与范围

聊天历史迁入同一公共侧栏，输入/消息/来源/关联区域使用统一构图；笔记阅读可真实建立空消息绑定再开始对话。灵感使用开放阅读/真实三类历史和来源，设置与页面共享唯一服务端 controller。个人页面保留真实两统计、画像和账户能力；设置中的资料与密码使用同一原生弹窗，保留背景任务与未提交保护。主题、字阶、输入圆角和强调色统一，DESIGN.md 已随 S1 更新。

认证与后台 34 个文件对原始实施前快照一致，主稿 HTML SHA-256 仍为 `079a21d0269eee41283d6e7bdea3320038388fa74dc92522330f86ff301ffba8`。最终交付前已再次核对。

## 最终自动检查

本阶段在 `frontend` 执行 `npm test`：最终 67 文件 564 测试通过（最后纯 CSS 修改后再次全量通过）；`npm run typecheck` 通过；`npm run lint`：0 errors / 10 warnings。Warnings 包含原图片建议及新增共享头像 img / 测试 helper 依赖建议，没有将其称为零告警。

独立生产副本执行 build 与 `check:route-budgets` 通过，检查时 211 个源文件与工作区哈希一致。预算只代表已配置 notes 路由上限，不扩写为全站性能保证。

最终独立静态审阅提出的四项 Important 已修正并独立复审关闭。初始空登记补真实状态合同，删除显式会话同步URL，profile保留认证守卫；长历史增加flex并补齐折叠窄抽屉的级联。最后一处纯CSS后Sass、生产build及notes预算重新通过，未声称零lint告警。

## 已完成的真实浏览器操作

浏览器访问隔离的本机生产构建副本，通过正常可见登录，仅操作隔离测试笔记、会话、画像和灵感。未用浏览器脚本注入 store/token 或 mock API。截图在 `assets/2026-10-25-workspace-ui-s2-s3/`。

| 情境 | 实际结果 |
| --- | --- |
| 笔记→AI | 阅读隔离测试笔记后点击和 AI 讨论，服务端接受真实会话ID，空绑定无虚构AI消息 |
| 首轮流与设置 | 实际发送提问、流处理中开设置；背景 textarea 仍挂载，关闭后完整回答和来源版本可见，刷新已保存回答仍在 |
| 来源快照 | 本次回答依据版本1、毫秒更新时间、可展开真实原文；点击来源后返回恢复会话和未发送草稿 |
| 灵感研究 | 定期关闭时手动研究成功，真实三参考来源、检索时间、相关理由和下一问题 |
| 灵感整理 | 收藏→已保存过滤→取消→忽略→已忽略读取→恢复→最近读取均真实服务成功；来源摘录可展开/收起 |
| 定期设置 | 页面入口直达设置灵感分类，开启获得真实 nextEligibleAt，页面同步开启；关闭并刷新仍关闭，手动入口可用；最终维持关闭 |
| 资料弹窗 | 取消/继续/Escape/放弃均保留输入或正确退出；子层关闭后设置仍在，焦点回编辑资料 |
| 资料保存 | 通过可见头像选项选择 preset02，真实PUT成功后个人页和公共侧栏同时显示同一SVG |
| 个人画像 | 真实统计8篇/本月8篇，分析中→真实画像完成；显示最近最多20篇/本次8篇、时间、文字技能级别，无伪造逐条证据 |
| 桌面阅读 | 1440/1280/1024实际查看，1280文章宽800，1024文章宽700，document无横向溢出；深浅色实际检查 |
| 长历史反例 | 隔离账号幂等增加32条滚动夹具；33会话时实测被裁切，已列最终修复波，不能记作通过 |

## 最后浏览器闭合与验证边界

- F1–F4代码均独立复审PASS。F1真实notes注册的加载/失败/空库/可信投影由真实Query集成测试覆盖；F2删除成功由回归覆盖，浏览器只执行取消以免永久删除验收数据。
- 长历史33条常态滚到底、末条删除弹窗取消、末条选择实际通过。先桌面折叠再980打开抽屉：section/aside均437，list clientHeight345/scrollHeight1404/scrollTop1059.5，末条可达；关闭后焦点回展开侧栏。浏览器测量记录已核对。
- 显式A→历史主动选B，真实Next URL变为/chat；B输入草稿→读B来源→浏览器返回，仍为B且草稿完整。浏览器往返已核对。A长消息往返保留草稿与约90px阅读位置（实测92→89.5px，小幅布局取整），不声称像素完全不变。
- 真实编辑笔记revision1→保存revision2→原会话提问，回答引用新增句，旧回答仍保留revision1原文与时间，新回答为revision2/毫秒更新时间。截图chat-versions-dark-1280.png，数据来自真实服务。
- 1440/1280/1024及980实际检查，1199/1200关联区实际切换：1200为330px并排栏，1199为fixed dialog抽屉，关闭恢复入口。截图已保存。未登录直接/profile实际跳/auth；认证/后台34文件及主稿hash最终重新核对一致。
- 资料头像真实保存后刷新/重新登录仍保留preset02，公共侧栏与个人页一致；密码空表单实际显示“请输入当前密码”，未输入或提交新凭据。
- 密码成功提交涉及新凭据，留用户本人最终人工验证；自动化已覆盖校验、失败保留、保存锁和成功清理登录。不为验收修改实际凭据。
- 未等待24小时调度，也未穷尽所有后端服务故障的端到端场景；相关失败/迟到/冲突由已有定向测试覆盖，区分于实际浏览器证据。

## 本次迁移的取舍

- 笔记无专属 AI 开场 API，真实保存空消息绑定后由用户提问；没有将主稿中的固定 AI 首问存入业务。
- 最近记录兜底只保留真实首五条链接，不填 notes 查询缓存；冷进其他页面多一次轻量读取，保持原分页状态。
- notes 的 `isSuccess` 区分可信空库与加载/失败；调用者测试替身必须遵守同一合同。
- 最终窄窗历史修复后重新核对增量、生产构建与相关回归；最终结论以前述闭合结果为准。

## 留存截图

- [auth-unchanged](assets/2026-10-25-workspace-ui-s2-s3/auth-unchanged.png)
- [chat-bound-light](assets/2026-10-25-workspace-ui-s2-s3/chat-bound-light.png)
- [chat-delete-dark-980](assets/2026-10-25-workspace-ui-s2-s3/chat-delete-dark-980.png)
- [chat-history-drawer-980](assets/2026-10-25-workspace-ui-s2-s3/chat-history-drawer-980.png)
- [chat-source-dark](assets/2026-10-25-workspace-ui-s2-s3/chat-source-dark.png)
- [chat-versions-dark-1280](assets/2026-10-25-workspace-ui-s2-s3/chat-versions-dark-1280.png)
- [inspiration-dark-1024](assets/2026-10-25-workspace-ui-s2-s3/inspiration-dark-1024.png)
- [inspiration-light](assets/2026-10-25-workspace-ui-s2-s3/inspiration-light.png)
- [notes-light-final](assets/2026-10-25-workspace-ui-s2-s3/notes-light-final.png)
- [profile-light](assets/2026-10-25-workspace-ui-s2-s3/profile-light.png)
- [reading-light-final](assets/2026-10-25-workspace-ui-s2-s3/reading-light-final.png)
- [related-drawer-1199](assets/2026-10-25-workspace-ui-s2-s3/related-drawer-1199.png)
- [related-panel-1200](assets/2026-10-25-workspace-ui-s2-s3/related-panel-1200.png)
- [settings-account-layer](assets/2026-10-25-workspace-ui-s2-s3/settings-account-layer.png)
- [unsaved-dark-final](assets/2026-10-25-workspace-ui-s2-s3/unsaved-dark-final.png)
