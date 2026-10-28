# NoteWithAI 架构与数据契约

更新：2026-10-27；依据工作区版本 `72dc316` 的代码整理。本文替代旧生成式架构快照；产品范围见 [PRODUCT.md](PRODUCT.md)，视觉见 [DESIGN.md](DESIGN.md)，运维见 [部署指南](deploy/DEPLOY_GUIDE.md)。

## 运行结构

```text
浏览器 → Next.js /api rewrite → Express → MongoDB
                                      → Redis
                                      → DeepSeek / OpenRouter / Tavily
独立 inspiration-worker → MongoDB 与外部研究服务
```

Next.js 15/React 18 承载网页，Tiptap 编辑富文本；Express 5/Mongoose 访问 MongoDB。Redis 用于相关服务缓存和协调，生产 Compose 通过服务名连接。`frontend/next.config.js` 使用 `BACKEND_URL`，浏览器不用知道后台地址或持有供应商密钥。可选 worker 由 Compose `inspiration` profile 单独运行，普通后端进程不代表该 worker 已启用。

- [页面组合与认证边界](frontend/src/app/README.md)
- [共享组件](frontend/src/components/README.md)
- [持久工作区](frontend/src/components/workspace/README.md)
- [后端服务](backend/services/README.md)与[模型](backend/models/README.md)
- [AI 配置](docs/ai-configuration.md)

## 笔记写入与派生结果

`backend/services/NoteUpdateOrchestrator.ts` 是创建、更新笔记核心字段的边界；`noteService.ts` 承担列表、删除和维护入口。请求必须按用户隔离，客户端不能通过笔记 ID 绕过所有权。

- 标题可为空，不从首行或 AI 自动写回。拟标题是用户主动调用的独立操作，有请求期限和配额；迟到响应不能覆盖之后的用户编辑。含旧结构化 `keywords` 的写入明确拒绝。
- 新笔记从有效 revision 开始；更新用 revision CAS 检测竞争。冲突保留用户草稿，不自动覆盖服务端或跳走。
- `noteContentNormalizer.ts` 从富文本结构推导可信 `contentText`。客户端传入的语义纯文不能替代服务端规范化结果；历史 Markdown 与旧正文保留兼容阅读。
- 异步 meta、embedding、recommendation 必须匹配产生任务时的版本，不能把旧任务结果写到新正文上。派生更新不冒充用户修改，不改变核心 revision 或用户更新时间。
- 普通列表/单篇 DTO 不携带原始 embedding。列表分页以真实服务结果为准，未加载部分不能被前端局部排序假装成全库结果。
- revision 回填属于部署前的条件性维护：先只读检查，只有缺失或无效时才在备份后运行，不能接入 GET 或启动流程写库。

一次用户保存对应一次核心写入，标题与正文一起提交。服务端 canonical 响应完整替换共享快照，包括以 null 清除失效派生字段；409 更新服务端快照但保留本地编辑。乐观失败只能撤销自己创建的临时记录。跨账户/请求的迟到响应须由身份与请求版本共同隔离，旧 finally 不能解除新请求的锁。

标题建议只进入编辑草稿，不直接更新 Note、revision 或 updatedAt；保存期间继续输入不能被旧保存结果清除。仅标题变动不应重算正文向量。建议请求遵守整体期限、供应商尝试次数与共享配额租约，释放必须匹配 owner；切换笔记、修改或保存后，旧建议失效。

用户标签和个人话题已退役。`UserNoteTopicIndex`、租约和旧 worker 文件仍可能存在，不构成运行时能力；个人话题接口返回 410，不重新挂载旧自动标题/标签/话题写入链路。

## 对话绑定、来源与流式提交

`Chat` 的 `sourceNoteId` 由服务端校验并持久化。显式绑定入口创建真实会话，不用随机开场假装来自指定笔记。已有会话的绑定和历史不是浏览器可以随意替换的字段。

`chatNoteContextService.ts` 每轮按当前用户读取绑定笔记最新保存的文字；服务端选择 `contentText`，再兼容富文本和旧正文。未保存草稿不送入模型。不可访问、空正文、纯图片或超过预算时明确报错，不静默截断。现有预算为单篇 12,000 Unicode 字符、模型消息合计 24,000 字符。

正文是资料而非系统指令。静态系统说明、JSON 资料消息和经过角色校验的历史分别构造；图片不向文字模型传入原始图片或 base64，并明确未识别限制。

`chatTurnCommitService` 将回答和当轮 `sourceSnapshot` 保存成功后，才发出 `committed` 确认。快照保留原文、revision 与版本时间，不通过 populate 替换成最新笔记；同一会话旧回答与新回答可以引用不同版本。公开保存请求不能伪造可信快照。附属命名/相关检索共享有限等待预算，超时不产生迟到写回。

流式收到正文不等于已保存；客户端以服务端 `committed` 为准，并让错误/等待状态归属其所属会话。取消、删除或切换之后的迟到结果不能抢导航。来源往返保留对话位置和草稿，相关栏排除正在绑定的同一篇笔记。[聊天模块](frontend/src/app/chat/README.md)定义具体前端职责。

## 工作区与账户保护

`WorkspaceRoot` 只对 `/notes`、`/chat`、`/inspiration`、`/profile` 挂载持久外壳。主题、弹层与导航保护限制在工作区；认证与 `/admin/**` 不套用工作区样式。

未保存离开提供保存并继续、放弃、继续编辑。保存失败、竞争或保存中的新增输入不能静默丢稿；后退/前进及应用导航进入同一保护。刷新离站使用原生提示。改密导致退出属于有副作用操作，须先处理脏笔记，并防止已发出的改密请求在卸载后被误取消；成功后再清理普通用户身份。

## 灵感与个人分析

`inspirationService`、catalog 与路由负责用户主动研究、历史、查看和状态更新。来源和收藏/忽略由真实服务返回，不用本机模拟状态替代保存。独立 `inspirationWorker` 按用户开关、频率、配额、租约和并发限制领取任务；不补跑停机期间每一天。开启用户开关与启动生产 worker 是两项独立操作。

主动研究只使用当前用户最近 5 条笔记的受限标题/摘要上下文，Tavily 只接收检索 query；不得把原始正文、账号或完整模型响应扩入对外参数/日志。来源 ID 与安全 URL 校验通过才保存；按用户和 URL 去重，忽略不释放去重登记。收藏更新灵感状态，不自动创建笔记。

定期发现默认关闭，需显式同意。开启不立即外呼，从 24 小时后开始；手动研究向后顺延下一次自动机会。持久 claim、租约、唯一周期键及 owner fencing 防止并发重复，每次 provider 调用前复核开关。已经进入 provider 阶段的过期任务在该周期标为失败，不重新领取外呼；只读历史、收藏和文档整理不触发研究。

个人画像有明确的笔记样本范围、时间和失败状态；不用记录频次虚构能力分数，不恢复话题目录。数据变化时须按分析协调器的失效/刷新约定处理。[个人模块](frontend/src/app/profile/README.md)与[灵感模块](frontend/src/app/inspiration/README.md)保留前端规则。

## 安全与可观测性

普通用户与管理员使用分离的认证边界。管理员 JWT secret 独立，TOTP 密钥加密存储；本机密码简化仅可用于 development，生产和 test 不得绕过第二因素。生产启动校验必要环境变量，不能用开发默认值替代。

管理员身份使用 Secure、HttpOnly、SameSite=Strict cookie，写操作校验 Origin；RBAC、审计与隐私投影由服务端执行，不能只靠前端隐藏按钮。首次 owner 初始化与 TOTP 交付属于受控运维流程，凭据不进入 Git 或运行日志。

浏览器不能接收 AI 密钥或原始内部对象。生产日志保留请求、阶段、错误分类和耗时，避免完整正文、模型响应和凭据。公开文档只使用示例环境和脱敏证据，运行账本及备份存放在受限位置。

## 验证与发布

测试命令见 [README](README.md#检查与构建)，已完成工作区发布及验证边界见 [版本记录](docs/releases/2026-10-workspace-ui.md)。测试数是特定提交的历史证据，不是以后每次修改都自动通过的保证。前后端涉及绑定/写入契约时须成套发布；回退代码不能通过恢复旧数据库抹去发布后的用户数据。
