# NoteWithAI 改进备忘录

> 由架构评审生成，2026-02-22。按优先级分组，逐步推进。
> ✅ = 已完成 | 🔲 = 待处理

---

## ✅ 已完成（紧急修复）

- ✅ JWT Secret 统一为 `config.JWT_SECRET`，消除硬编码回退值
- ✅ CORS 限制为 `ALLOWED_ORIGINS` 白名单
- ✅ `GET /api/recommend` 添加鉴权 + 用户数据隔离
- ✅ `express.json({ limit: '5mb' })` 防止超大 payload

---

## 🟠 短期改进（建议 1-2 周内）

### 安全加固

- 🔲 **添加速率限制**：使用 `express-rate-limit`，重点保护 `/api/auth/login`、`/api/auth/register` 和 AI 相关接口
- 🔲 **聊天消息条数/长度限制**：`streamChat` 中限制 `messages` 数组长度（如最多 50 条）和单条消息字符数，防止 Token 恶意消耗

### 性能优化

- 🔲 **减少冗余 DB 查询**：`UserValidator.authenticateUser()` 每次请求都执行 `User.findById()`，建议只在需要完整用户对象时查库，其他场景直接用 JWT payload 中的 `userId`
- 🔲 **笔记列表分页**：`noteService.getNotes()` 一次返回所有笔记，需添加 `skip/limit` 分页
- 🔲 **替换缓存哈希函数**：`embedding.ts` 的 `hashText` 使用 32 位整数哈希，碰撞率高，改用 `crypto.createHash('sha256')`

### 代码质量

- 🔲 **`simpleChat` 复用 API 客户端单例**：`noteService.ts` 每次调用 `new DeepSeekApiClient()`，应复用 `deepseek.ts` 中的现有实例
- 🔲 **`Chat` 模型防重复注册**：`Chat.ts` 使用 `mongoose.model()` 而不是 `mongoose.models.Chat || mongoose.model()`

---

## 🟡 中期改进（建议 1-2 月内）

### 架构改进

- 🔲 **Embedding 迁出 Note 文档**：1024 维向量嵌入 Note 文档会膨胀文档大小并阻碍向量索引。建议迁移到独立集合或向量数据库（MongoDB Atlas Vector Search / Qdrant / Pinecone）
- 🔲 **重构 `recommend.ts`**：300+ 行业务逻辑应拆分为 `recommendController` + `recommendService`
- 🔲 **统一 config 模块使用**：确保所有文件通过 `config` 模块读取环境变量，杜绝直接 `process.env` 读取

### 安全提升

- 🔲 **Token 改用 HttpOnly Cookie + Refresh Token**：当前 JWT 存 `localStorage`，存在 XSS 窃取风险
- 🔲 **密码强度增强**：要求包含特殊字符

### 可靠性

- 🔲 **MongoDB 连接池配置 + 重试策略**：`mongoose.connect()` 需配置 `maxPoolSize`、`serverSelectionTimeoutMS` 等
- 🔲 **Embedding 生成失败应抛错而非返回空数组**：下游无法区分"空内容"和"API 故障"

### 测试与质量

- 🔲 **建立基础自动化测试**：至少覆盖认证、鉴权、笔记 CRUD 的单元/集成测试
- 🔲 **引入结构化日志**：用 `pino` 或 `winston` 替代 `console.log`，支持日志级别和 JSON 格式化

---

## 🔵 长期优化

- 🔲 **AI API 调用并发控制 + 队列**：防止高负载触发 API 限频
- 🔲 **`setInterval` 定时器改为可管理方式**：当前在模块加载时注册且不可取消，Serverless 环境下无效
- 🔲 **生产/开发环境配置严格分离**
- 🔲 **CI/CD pipeline 集成安全扫描**
- 🔲 **减少 `as any` / `as unknown as` 类型断言**：补全 TypeScript 类型定义
- 🔲 **清理临时测试文件**：`test-deepseek.ts`、`test-stream.js` 不应在生产目录中
