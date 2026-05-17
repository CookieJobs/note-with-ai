# Auth Flow Redesign — Spec

**Date**: 2026-05-17
**Status**: Approved

## Overview

补足 noteWithAI 的用户注册流程，从「邮箱+密码一步注册」升级为完整的「邮箱验证码」认证体系，覆盖注册、登录、密码重置三大流程。

## Decisions

| 决策 | 选择 |
|---|---|
| 验证方式 | 邮箱 + 6 位数字验证码 |
| 页面结构 | 单页表单，三 Tab 切换 |
| 表单字段（注册） | 邮箱、密码、验证码（去 username） |
| 密码重置 | 与注册一致的验证码模式 |
| 邮件服务 | QQ SMTP（smtp.qq.com:465） |
| 频率限制 | Redis |
| Token | 保持单 JWT 7 天 |
| 架构 | 新建独立 Auth 模块 |

## Complete Flows

### 注册
填邮箱+密码 → 点发送验证码 → 收到邮件 → 填 6 位码 → 注册成功（自动登录）

### 登录（不变）
填邮箱+密码 → 登录成功

### 密码重置
输入注册邮箱 → 收到验证码 → 填验证码 + 新密码 → 重置成功（自动登录）

## Backend Architecture

新建独立模块，与现有代码隔离：

```
backend/src/services/auth/
  EmailService.ts              # QQ SMTP 邮件发送
  VerificationCodeService.ts   # 验证码生成、校验、频率检查
  AuthService.ts               # 注册/登录/重置的编排层

backend/src/controllers/auth/
  registerController.ts        # POST /api/auth/register
  loginController.ts           # POST /api/auth/login (保持)
  verifyController.ts          # POST /api/auth/send-verify-code
  resetController.ts           # POST /api/auth/reset-password

backend/src/routes/auth.ts     # 路由 + Zod validate 中间件
backend/src/models/VerificationCode.ts
```

### User Model Changes

- `username` 改为 `required: false`（存量用户保留，新用户不再填写）
- 新增 `isVerified: Boolean`（默认 false，验证后为 true）
- 注册时以邮箱为唯一标识，不再要求用户名

现有 `register` 逻辑改为：创建未验证用户 → 发验证码 → 验证通过后置 `isVerified=true`。
未验证用户若 24 小时内未完成验证，可通过再次注册覆盖（避免死账号占用邮箱）。

### VerificationCode Model

```typescript
{
  email: string,
  code: string,        // 6 位数字
  purpose: 'register' | 'reset',
  expiresAt: Date,     // 5 分钟
  attempts: number,    // 默认 0，最多 5 次
  used: boolean        // 默认 false
}
// TTL 索引: expiresAt
```

## API Design

### POST /api/auth/send-verify-code
```
Body: { email: string, purpose: "register" | "reset" }
→ 200 { message: "验证码已发送" }
→ 429 频率超限
→ 400 邮箱已注册（register）/ 邮箱未注册（reset）
```
Rate limit: 每邮箱 60s，每 IP 10 次/小时。

### POST /api/auth/register
```
Body: { email: string, password: string, code: string }
→ 200 { token, user }
→ 400 验证码错误/过期
→ 409 邮箱已注册
```
Rate limit: 每 IP 5 次/分钟。

### POST /api/auth/login（保持）
```
Body: { email: string, password: string }
→ 200 { token, user }
→ 401 邮箱或密码错误
```
Rate limit: 每邮箱 5 次/5 分钟，超限锁定 15 分钟。

### POST /api/auth/reset-password
```
Body: { email: string, code: string, newPassword: string }
→ 200 { token, user }
→ 400 验证码错误/过期
→ 404 邮箱未注册
```

### GET /api/auth/me（保持）

## Rate Limiting (Redis)

| 端点 | Key | 限制 |
|---|---|---|
| send-verify-code | `ratelimit:sendcode:{email}` | 60s 一次 |
| send-verify-code | `ratelimit:sendcode:{ip}` | 10 次/小时 |
| register | `ratelimit:register:{ip}` | 5 次/分钟 |
| login | `ratelimit:login:{email}` | 5 次/5 分钟，超限锁定 15 分钟 |
| reset-password | `ratelimit:reset:{email}` | 60s 一次 |

验证码自体保护：5 分钟过期，最多 5 次错误尝试，用后即删。

## Frontend

当前 `/auth` 页面从 Login/Register 两模式改为三 Tab：

- **注册**：邮箱 + 密码 + 验证码 + 发送按钮（60s 倒计时）
- **登录**：邮箱 + 密码 + "忘记密码"链接（可用）+ 注册链接
- **重置密码**：邮箱 + 验证码 + 新密码

交互细节：
- 发送验证码按钮点击后变灰 + 60s 倒计时
- 保留密码可见切换（眼睛图标）
- 内联校验：邮箱格式、密码强度（>=8 位 + 字母 + 数字）、验证码 6 位数字
- 错误提示在表单顶部，不弹窗
- 去除 username 和 confirmPassword 字段
- 保持现有 Apple 风格 / 浅色深色主题
- 成功注册/重置后自动登录跳转 `/notes`

## Dependencies

### 新增
- `nodemailer` — Node.js SMTP 邮件发送
- `ioredis` — Redis 客户端（速率限制 + 可选验证码缓存）

### 环境变量
```
QQ_EMAIL_USER=xxx@qq.com
QQ_EMAIL_PASS=授权码
REDIS_URL=redis://localhost:6379
```

## Migration

1. 新 User 的 `isVerified` 默认 false
2. 存量用户（已注册）批量设为 `isVerified: true`（迁移脚本）
3. 登录不检查 `isVerified`，仅在后续功能中可选使用

## Testing

- 单元测试：`VerificationCodeService`（生成/校验/过期）、`AuthService`（注册/登录/重置编排）
- 集成测试：5 个 API 端点，覆盖正常流程 + 频率限制 + 验证码过期/错误
- 前端：表单校验边界用例 + 倒计时行为
