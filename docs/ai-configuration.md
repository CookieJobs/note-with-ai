# AI 与向量配置

更新：2026-10-27。配置字段以 [后端配置校验](../backend/config/index.ts) 为准，示例见 [后端环境模板](../backend/.env.example) 和[Compose](../docker-compose.yml)。不要在文档或前端中存放真实密钥。

## 能力与供应商

| 能力 | 主要配置 | 当前代码默认/边界 |
| --- | --- | --- |
| 对话、拟标题、画像等文字能力 | `DEEPSEEK_API_KEY` | 服务端调用，具体提示和参数由对应服务定义 |
| 语义向量 | `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION` | `openrouter`、`nvidia/llama-nemotron-embed-vl-1b-v2:free`、2048 |
| OpenRouter 连接 | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` | 默认 base URL 为 `https://openrouter.ai/api/v1` |
| 兼容 DashScope | `DASHSCOPE_API_KEY`, `EMBEDDING_PROVIDER=dashscope` | 仅明确配置时使用；不因保留兼容代码就假设线上使用它 |
| 灵感研究检索 | `TAVILY_API_KEY` | Tavily 检索配合文字模型；有超时、语言和配额约束 |

这是源码默认，不是供应商可用性、价格或当前生产密钥的保证。供应商支持的模型、维度和用途参数需要在变更前核实。

## 向量用途参数

`EMBEDDING_MODALITY` 控制模式；当前产品主要读取文字。`EMBEDDING_QUERY_INPUT_TYPE` 与 `EMBEDDING_DOCUMENT_INPUT_TYPE` 必须符合所选模型。

配置模块的用途默认值是 `search_query` / `search_document`；根 `.env.example` 为当前 OpenRouter 示例显式写成 `query` / `passage`，后端模板仍保留前者。不要把不同模板的用途值混合照抄，应按具体 provider/model 配对配置。这里只说明差异，不在文档整理时改动运行配置。

模型、provider、dimension 或用途改变后，旧 embedding 可能不兼容。`noteEmbeddingService.ts` 管理 metadata 与当前配置匹配状态；先备份、检查 `/api/health` 的 embedding 覆盖与配置统计，再在隔离环境验证。修复脚本为 `backend/scripts/repair_embeddings.ts`，运行前先读源码，不能在文档整理或普通读取中自动执行全库重算。

## 本地与生产

本地环境文件读取及 `/api` 代理见 [项目说明](../README.md#本地开发)。生产 Compose 注入明确列出的变量；没有列入 Compose 的配置项，不会因为写进根 `.env` 就自动进入容器。变更需要同时核对 Compose 与服务实际环境。

`EMBEDDING_TEST_MODE` 在开发模板里可能为 true；它不是实际生产任务已启用的证据。自动灵感需要用户开关与独立 worker；启动/停用和费用控制见 [部署指南](../deploy/DEPLOY_GUIDE.md)。
