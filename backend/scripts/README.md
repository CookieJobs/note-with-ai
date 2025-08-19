# 笔记嵌入脚本使用指南

本文档详细介绍了笔记嵌入系统的安装、配置和使用方法。该系统通过定时任务自动为用户笔记生成向量嵌入，以支持智能搜索和相关笔记推荐功能。

## 📋 目录

- [系统概述](#系统概述)
- [功能特性](#功能特性)
- [环境要求](#环境要求)
- [安装步骤](#安装步骤)
- [配置指南](#配置指南)
- [运行脚本](#运行脚本)
- [监控和维护](#监控和维护)
- [故障排除](#故障排除)
- [API说明](#api说明)

## 🎯 系统概述

笔记嵌入系统包含以下核心组件：

- **embeddingCronJob.ts**: 主要的定时任务脚本，负责维护笔记嵌入
- **noteEmbedding.ts**: 嵌入生成服务，提供批量处理和统计功能
- **toggleEmbeddingMode.js**: 模式切换工具，支持测试模式和生产模式
- **embedding.ts**: 配置文件，包含所有相关参数设置

## ✨ 功能特性

- 🔄 **自动化处理**: 通过cron定时任务自动维护笔记嵌入
- 📊 **批量处理**: 支持大量笔记的批量嵌入生成
- 🔧 **灵活配置**: 支持测试模式和生产模式切换
- 📈 **统计监控**: 提供嵌入生成统计和进度跟踪
- 🛡️ **错误处理**: 完善的重试机制和错误恢复
- ⚡ **性能优化**: 缓存机制和批处理优化

## 🔧 环境要求

### 系统要求
- Node.js >= 16.0.0
- MongoDB >= 4.4
- TypeScript >= 4.5

### 必需的API密钥
- **DASHSCOPE_API_KEY**: 阿里云DashScope API密钥（用于生成嵌入向量）
- **DEEPSEEK_API_KEY**: DeepSeek API密钥（可选，用于其他AI功能）

## 📦 安装步骤

### 1. 克隆项目并安装依赖

```bash
# 进入后端目录
cd backend

# 安装依赖
npm install
```

### 2. 验证依赖安装

确保以下关键依赖已正确安装：
- `mongoose`: MongoDB对象建模工具
- `node-cron`: 定时任务调度器
- `axios`: HTTP客户端
- `ts-node`: TypeScript运行时

## ⚙️ 配置指南

### 1. 环境变量配置

在 `backend` 目录下创建 `.env` 文件：

```bash
# 数据库配置
MONGODB_URI='mongodb://localhost:27017/noteWithAI'

# API密钥配置
DASHSCOPE_API_KEY='your_dashscope_api_key_here'
DEEPSEEK_API_KEY='your_deepseek_api_key_here'

# 服务端口
PORT='3001'

# 嵌入模式配置
EMBEDDING_TEST_MODE='true'  # 测试模式：每分钟执行
# EMBEDDING_TEST_MODE='false'  # 生产模式：每天凌晨2点执行

# 可选配置
EMBEDDING_BATCH_SIZE='50'     # 批处理大小
EMBEDDING_CACHE_SIZE='1000'   # 缓存大小
```

### 2. 获取API密钥

#### DashScope API密钥
1. 访问 [阿里云DashScope控制台](https://dashscope.console.aliyun.com/)
2. 注册并登录账户
3. 创建API密钥
4. 确保账户有足够的调用额度

#### DeepSeek API密钥
1. 访问 [DeepSeek开放平台](https://platform.deepseek.com/)
2. 注册并获取API密钥

### 3. 数据库配置

确保MongoDB服务正在运行：

```bash
# macOS (使用Homebrew)
brew services start mongodb-community

# 验证连接
mongosh --eval "db.runCommand('ping')"
```

## 🚀 运行脚本

### 1. 模式切换

#### 切换到测试模式（每分钟执行）
```bash
npm run cron:test
```

#### 切换到生产模式（每天凌晨2点执行）
```bash
npm run cron:prod
```

### 2. 启动定时任务

#### 启动自动定时任务
```bash
npm run cron
```

#### 手动执行一次嵌入维护
```bash
npm run cron:manual
```

### 3. 直接运行脚本

```bash
# 使用ts-node直接运行
ts-node scripts/embeddingCronJob.ts

# 手动执行模式
ts-node scripts/embeddingCronJob.ts --manual
```

## 📊 监控和维护

### 1. 日志监控

脚本运行时会输出详细的日志信息：

```
🚀 嵌入定时任务已启动
📅 执行模式: 测试模式 (每分钟执行)
⏰ 下次执行时间: 2024-01-01 10:01:00
📊 开始维护笔记嵌入...
✅ 成功处理 25 条笔记
❌ 失败 2 条笔记
📈 总计: 成功 25, 失败 2, 跳过 0
```

### 2. 统计信息查看

脚本会定期输出统计信息：
- 总笔记数量
- 已生成嵌入的笔记数量
- 待处理笔记数量
- 失败记录数量

### 3. 性能监控

在开发模式下，脚本会记录性能指标：
- 批处理耗时
- API调用延迟
- 数据库操作时间

## 🔍 故障排除

### 常见问题

#### 1. 环境变量缺失
```
错误: 缺少必要的环境变量: DASHSCOPE_API_KEY
解决: 检查.env文件中是否正确配置了所有必需的环境变量
```

#### 2. 数据库连接失败
```
错误: MongoDB连接失败
解决: 
- 确保MongoDB服务正在运行
- 检查MONGODB_URI配置是否正确
- 验证数据库访问权限
```

#### 3. API调用失败
```
错误: DashScope API调用失败
解决:
- 检查API密钥是否有效
- 确认账户余额充足
- 检查网络连接
```

#### 4. 内存不足
```
错误: JavaScript heap out of memory
解决: 减少EMBEDDING_BATCH_SIZE的值
```

### 调试模式

启用详细日志输出：

```bash
# 设置环境变量
export NODE_ENV=development

# 运行脚本
npm run cron:manual
```

## 📚 API说明

### 核心函数

#### `maintainAllNoteEmbeddings()`
维护所有笔记的嵌入向量

```typescript
// 返回处理结果统计
interface MaintenanceResult {
  success: number;    // 成功处理数量
  failed: number;     // 失败数量
  skipped: number;    // 跳过数量
}
```

#### `generateNoteEmbedding(noteId: string)`
为指定笔记生成嵌入向量

#### `batchGenerateUserNoteEmbeddings(userId: string)`
批量生成用户所有笔记的嵌入向量

#### `getEmbeddingStats()`
获取嵌入生成统计信息

```typescript
interface EmbeddingStats {
  totalNotes: number;           // 总笔记数
  embeddedNotes: number;        // 已嵌入笔记数
  pendingNotes: number;         // 待处理笔记数
  failedNotes: number;          // 失败笔记数
  lastUpdateTime: Date;         // 最后更新时间
}
```

### 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `EMBEDDING_BATCH_SIZE` | 50 | 每批处理的笔记数量 |
| `EMBEDDING_CACHE_SIZE` | 1000 | 缓存最大条目数 |
| `EMBEDDING_TEST_MODE` | true | 是否启用测试模式 |
| `QWEN_DEFAULT_DIMENSIONS` | 1024 | 向量维度 |
| `QWEN_TIMEOUT_MS` | 30000 | API超时时间(毫秒) |
| `SIMILARITY_THRESHOLD` | 0.7 | 相似度阈值 |

## 📝 使用示例

### 完整的部署流程

```bash
# 1. 安装依赖
cd backend && npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑.env文件，填入正确的API密钥

# 3. 启动MongoDB
brew services start mongodb-community

# 4. 切换到测试模式
npm run cron:test

# 5. 手动执行一次测试
npm run cron:manual

# 6. 启动定时任务
npm run cron

# 7. 切换到生产模式（可选）
npm run cron:prod
```

### 监控脚本运行

```bash
# 查看实时日志
tail -f logs/embedding.log

# 检查进程状态
ps aux | grep embeddingCronJob

# 停止定时任务
pkill -f embeddingCronJob
```

---

## 📞 技术支持

如果在使用过程中遇到问题，请：

1. 查看本文档的故障排除部分
2. 检查日志输出获取详细错误信息
3. 确认所有环境变量和依赖配置正确
4. 验证API密钥和数据库连接

---

**注意**: 请妥善保管API密钥，不要将其提交到版本控制系统中。建议定期轮换API密钥以确保安全性。