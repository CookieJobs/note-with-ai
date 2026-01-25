# 笔记导入工具使用说明

本指南说明如何使用自动化脚本将 HTML 格式的笔记导入到 NoteWithAI 系统中。

## 1. 脚本功能

脚本位置: `backend/scripts/import_notes.ts`

该脚本执行以下操作：
- 读取 `/Users/liujin/Documents/noteWithAI/我的记忆宫殿的笔记.html` 文件。
- 解析 HTML 内容，提取每条笔记的时间和正文。
- 将笔记导入到 MongoDB 数据库中，归属于用户 `liujin`。
- 自动去重：如果检测到相同时间戳的笔记已存在，则跳过。

## 2. 运行环境要求

- Node.js 环境
- MongoDB 数据库已启动
- 项目依赖已安装（特别是 `cheerio`）

如果尚未安装依赖，请在 `backend` 目录下运行：
```bash
npm install cheerio
npm install --save-dev @types/cheerio
```

## 3. 执行导入

在 `backend` 目录下运行以下命令：

```bash
cd backend
npx ts-node scripts/import_notes.ts
```

### 输出示例
```
✅ Connected to MongoDB
✅ Found user: liujin (688f662ea738058204aa83ae)
Found 232 memos to process...
Processed 50/232...
...
🎉 Import Completed!
Total: 232
✅ Success: 232
⏭️ Skipped (Duplicate): 0
❌ Failed: 0
```

## 4. 后续步骤：生成 Embeddings

导入的笔记暂时没有 AI 向量数据（Embedding），这意味着它们无法被语义搜索或 AI 联想功能找到。

**请务必在导入后运行以下命令来修复 Embeddings：**

```bash
cd backend
npm run repair:embeddings
```

该命令会扫描所有缺失 Embedding 的笔记并调用 AI 接口生成向量。

## 5. 故障排除

- **找不到用户**: 确保数据库中存在用户名为 `liujin` 的用户。
- **找不到文件**: 确认 HTML 文件路径是否正确。
- **依赖错误**: 确保已运行 `npm install`。
