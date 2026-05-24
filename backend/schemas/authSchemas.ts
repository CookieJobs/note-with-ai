import { z } from 'zod';

export const sendVerifyCodeSchema = z.object({
  body: z.object({
    email: z.string().email('邮箱格式不正确'),
    purpose: z.enum(['register', 'reset'] as const, {
      message: '用途必须是 register 或 reset',
    }),
  }),
});

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email('邮箱格式不正确'),
    password: z.string()
      .min(8, '密码长度至少8位')
      .regex(/(?=.*[A-Za-z])(?=.*\d)/, '密码必须包含字母和数字'),
    code: z.string().length(6, '验证码为6位数字'),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('邮箱格式不正确'),
    code: z.string().length(6, '验证码为6位数字'),
    newPassword: z.string()
      .min(8, '密码长度至少8位')
      .regex(/(?=.*[A-Za-z])(?=.*\d)/, '密码必须包含字母和数字'),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().min(1, '缺少必填字段: email').email('邮箱格式不正确'),
    password: z.string().min(1, '缺少必填字段: password'),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    oldPassword: z.string().min(1, '请输入当前密码'),
    newPassword: z
      .string()
      .min(8, '密码长度至少8位')
      .regex(/(?=.*[A-Za-z])(?=.*\d)/, '密码必须包含字母和数字'),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    username: z.string()
      .min(2, '用户名长度必须在2-20字符之间')
      .max(20, '用户名长度必须在2-20字符之间')
      .regex(/^[a-zA-Z0-9_\-一-龥]+$/, '用户名只能包含字母、数字、下划线、中划线和中文')
      .optional(),
    email: z.string().email('邮箱格式不正确').optional(),
    avatar: z.string().optional(),
  }),
});
