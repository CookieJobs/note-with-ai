# 持久化模型

[现行架构](../../ARCHITECTURE_DOCUMENTATION.md)说明系统边界；[业务服务](../services/README.md)说明写入入口。本目录定义存储格式，不作为客户端可写字段清单。

- [Note.ts](Note.ts) 保存正文、可选标题、正整数 `revision`、派生任务状态与 embedding metadata。`contentText` 由服务端正文规范化推导；摘要、概念、向量和推荐的状态对应源 revision。普通 Note DTO 由服务层投影，不直接返回向量和内部任务字段。
- [Chat.ts](Chat.ts) 保存显式 `sourceNoteId` 绑定和每条回答的 `sourceSnapshot`（原文、revision、版本时间和图片限制）。快照记录该轮实际送入模型的文字，不随后来笔记更新而变化；客户端不能提交受信任快照。
- `UserNoteTopicIndex`、`UserNoteTopicWorkerLease`、`UserNoteTopicBackfill` 及 Note 的 `topicIndex*` 字段是已退役话题功能的遗留结构。保留模型不代表仍开放标签写入、话题查询或自动索引；不要据此重新启用 worker。退役响应见 [profileController.ts](../controllers/profileController.ts)。
