## 问题原因

通过数据库检查脚本，确认笔记 `692cfcf7aa101ac19cacade6` 的 `embedding` 字段存在但长度为 0。

经过代码审查，发现以下问题链：

1.  **服务调用链路**：
    *   前端调用 `POST /api/notes/:id/embed`。
    *   后端路由 `backend/routes/notes.ts` 调用 `services/deepseek.ts` 中的 `generateEmbedding`。
    *   **关键点**：`backend/routes/notes.ts` 中引用的 `generateEmbedding` 来自 `../services/deepseek`。

2.  **DeepSeek 服务实现问题** (`backend/services/deepseek.ts`)：
    *   `generateEmbedding` 函数尝试通过 DeepSeek 的 Reasoning 模型（对话补全）来“伪造”一个向量。
    *   它发送 prompt 让模型返回一个 1536 维的 JSON 数组。
    *   **失败点**：DeepSeek Chat 模型（尤其是 Reasoning 模式）并不擅长或不被允许生成这种巨大的纯数字数组，或者返回格式不稳定，导致 `JSON.parse` 失败或返回空数组。代码中确实有 `console.warn('嵌入向量格式异常，返回空数组')` 的兜底，这解释了为什么数据库里是空数组。

3.  **正确的 Embedding 服务** (`backend/utils/embedding.ts`)：
    *   项目里其实已经有了基于阿里云 DashScope (Qwen) 的真正 Embedding 实现：`generateQwenEmbedding`。
    *   `findRelatedNotes` 搜索时用的是这个正确的 Qwen 服务。
    *   **错配**：生成向量时用了 DeepSeek 的“聊天伪造版”，而搜索时用了 Qwen 的“正版”，两者的向量空间根本不对齐（即使 DeepSeek 生成成功了也搜不到），更何况 DeepSeek 生成失败了。

## 修复方案

1.  **统一 Embedding 源头**：
    *   修改 `backend/routes/notes.ts`。
    *   不再使用 `../services/deepseek` 里的 `generateEmbedding`。
    *   改为引入 `../utils/embedding` 里的 `generateQwenEmbedding`（或者 `getCachedQwenEmbedding` 以利用缓存）。

2.  **清理无效代码**：
    *   `backend/services/deepseek.ts` 里的 `generateEmbedding` 是一个不可靠的实现，建议标记为废弃或删除，以免未来误用。

## 实施步骤

1.  修改 `backend/routes/notes.ts`：
    *   替换引入：`import { generateQwenEmbedding } from '../utils/embedding';`
    *   更新调用：在 `POST /:id/embed` 路由中，使用 `generateQwenEmbedding(note.content)`。

2.  验证：
    *   再次运行检查脚本，或者新建一条笔记，检查数据库中 `embedding` 字段是否为非空且长度正确（1024 维）。

## 预期结果

*   新笔记创建后，将通过阿里云 Qwen 模型生成真正的 1024 维向量。
*   数据库中的 `embedding` 字段将不再为空。
*   新笔记将能被未来的相关性搜索正确召回。
