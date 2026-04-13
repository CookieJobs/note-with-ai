# Services

本目录承载后端服务层，负责封装聊天、推荐、笔记摘要、向量检索等业务能力。

## 约定

- `deepseek.ts` 统一封装 DeepSeek 调用入口，使用惰性初始化；禁止在模块加载阶段校验 `DEEPSEEK_API_KEY` 或直接实例化客户端。
- 依赖 DeepSeek 的其他服务应通过 `getDeepSeekClient()` 或 `deepseek.ts` 暴露的能力调用，避免因为导入链导致服务启动期硬失败。
- 调试日志仅允许输出截断后的模型响应，生产环境禁止打印完整模型返回。

## 主要文件

- `chatService.ts`: 会话保存、流式聊天、开场白与相关笔记检索。
- `deepseek.ts`: DeepSeek 聊天、摘要、重排与客户端获取入口。
- `noteService.ts`: 笔记创建、更新、摘要与嵌入协调。
- `recommendService.ts`: 推荐与重排融合逻辑。
- `userAnalysisService.ts`: 用户画像分析与资料更新。
- `vectorStore.ts`: 向量检索封装。
