import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    username: z.string()
      .min(2, '用户名长度必须在2-20字符之间')
      .max(20, '用户名长度必须在2-20字符之间')
      .regex(/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/, '用户名只能包含字母、数字、下划线、中划线和中文'),
    email: z.string().email('邮箱格式不正确'),
    password: z.string()
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

export const updateProfileSchema = z.object({
  body: z.object({
    username: z.string()
      .min(2, '用户名长度必须在2-20字符之间')
      .max(20, '用户名长度必须在2-20字符之间')
      .regex(/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/, '用户名只能包含字母、数字、下划线、中划线和中文')
      .optional(),
    email: z.string().email('邮箱格式不正确').optional(),
    avatar: z.string().optional(),
  }),
});