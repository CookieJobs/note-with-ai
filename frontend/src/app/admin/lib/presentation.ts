const operationLabels: Record<string, string> = {
  chat: 'AI 对话',
  chat_title: '对话标题',
  note_concepts: '笔记概念提取',
  rerank: '检索重排',
  care_intro: '关怀开场',
  embedding: '向量生成',
  meta: '笔记摘要与标签',
  recommendations: '关联推荐',
  note_meta: '笔记摘要与标签',
  note_recommendations: '关联推荐',
};

const actionLabels: Record<string, string> = {
  'admin.login': '管理员登录',
  'admin.logout': '管理员退出',
  'admin.permission_denied': '权限校验拒绝',
  'user.status_changed': '修改用户状态',
  'feedback.updated': '更新反馈',
  'ai.artifact_retry': '重试 AI 处理',
};

export const operationLabel = (value: string): string => Object.hasOwn(operationLabels, value) ? operationLabels[value] : value;
export const actionLabel = (value: string): string => Object.hasOwn(actionLabels, value) ? actionLabels[value] : value;

export const feedbackStatusLabels = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
};

export const feedbackCategoryLabels = {
  bug: '功能故障',
  experience: '使用体验',
  feature: '功能建议',
  billing: '费用问题',
  other: '其他',
};

export const auditStatusLabels = {
  pending: '待确认',
  succeeded: '已成功',
  failed: '已失败',
};

export const retryStatusLabels = {
  saved: '处理完成，已保存',
  failed: '处理失败',
  stale: '笔记已更新，本次结果未保存',
};

export function formatDateTime(value: string | null): string {
  if (!value) return '暂无记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间不可用';
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时 ${minutes} 分钟`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  if (minutes > 0) return `${minutes} 分钟 ${total % 60} 秒`;
  return `${total} 秒`;
}
