import nodemailer from 'nodemailer';
import { config } from '../../config';

const transporter = nodemailer.createTransport({
  host: 'smtp.qq.com',
  port: 465,
  secure: true,
  auth: {
    user: config.QQ_EMAIL_USER,
    pass: config.QQ_EMAIL_PASS,
  },
});

export class EmailService {
  static async sendVerificationCode(
    to: string,
    code: string,
    purpose: 'register' | 'reset'
  ): Promise<void> {
    const subject =
      purpose === 'register'
        ? 'NoteWithAI - 邮箱验证码'
        : 'NoteWithAI - 密码重置验证码';

    const action = purpose === 'register' ? '注册 NoteWithAI' : '重置密码';

    const html = `
      <div style="max-width:480px;margin:0 auto;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
        <h2 style="color:#1D1D1F;margin-bottom:16px">${subject}</h2>
        <p style="color:#86868B;font-size:15px;line-height:1.6">您正在${action}，验证码如下：</p>
        <div style="background:#F5F5F7;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#1D1D1F">${code}</span>
        </div>
        <p style="color:#86868B;font-size:13px;line-height:1.6">验证码 5 分钟内有效，请勿泄露给他人。</p>
        <hr style="border:none;border-top:1px solid #E5E5EA;margin:24px 0">
        <p style="color:#AEAEB2;font-size:12px">如果这不是您的操作，请忽略此邮件。</p>
      </div>`;

    await transporter.sendMail({
      from: `NoteWithAI <${config.QQ_EMAIL_USER}>`,
      to,
      subject,
      html,
    });
  }
}
