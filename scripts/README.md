# 笔记 Embedding 定时任务

## 概述

这个定时任务系统用于批量处理笔记的 embedding 生成，替代了之前在用户创建笔记时立即生成 embedding 的方式。

## 主要优势

- **成本控制**: 集中处理，避免频繁的 API 调用
- **用户体验**: 笔记保存更快，不会因为 embedding 生成而延迟
- **运维友好**: 统一的任务调度和监控
- **资源优化**: 在服务器低峰期执行，减少对正常服务的影响

## 使用方法

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 启动定时任务服务

```bash
# 启动定时任务（每天凌晨2点执行）
npm run cron
```

### 3. 手动执行任务

```bash
# 立即执行一次 embedding 维护任务
npm run cron:manual
```

## 任务配置

- **执行时间**: 每天凌晨 2:00
- **批处理大小**: 每批处理 50 个笔记
- **重试机制**: 失败的笔记会重试 3 次
- **错误处理**: 记录详细的错误日志

## 监控和日志

任务执行时会输出详细的统计信息：

```
🚀 开始执行每日 embedding 维护任务...
📊 任务前统计: {
  totalNotes: 150,
  embeddedNotes: 120,
  coverage: "80%",
  pendingCount: 30
}
✅ 每日 embedding 维护任务完成
📈 任务后统计: {
  totalNotes: 150,
  embeddedNotes: 150,
  coverage: "100%",
  processed: 30,
  failed: 0
}
```

## 文件结构

- `../backend/scripts/embeddingCronJob.ts`: 主要的定时任务脚本
- `../backend/services/noteEmbedding.ts`: Embedding 处理服务
- `../backend/package.json`: 包含相关的 npm 脚本

## 注意事项

1. 确保环境变量正确配置（数据库连接、OpenAI API Key 等）
2. 定时任务需要在服务器上持续运行
3. 建议在生产环境中使用 PM2 或类似工具管理进程
4. 定期检查任务执行日志，确保正常运行