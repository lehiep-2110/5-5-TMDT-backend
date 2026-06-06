import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Dòng log fallback giữ nguyên format [MOCK EMAIL] cũ. */
  logMessage: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private from = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const user = this.config.get<string>('MAIL_USER');
    const pass = this.config.get<string>('MAIL_PASSWORD');

    if (!user || !pass) {
      this.logger.warn(
        'MAIL_USER/MAIL_PASSWORD chưa cấu hình — email sẽ chỉ được log ra console ([MOCK EMAIL]).',
      );
      return;
    }

    this.from = this.config.get<string>('MAIL_FROM') || `"Bookstore" <${user}>`;
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    this.logger.log('Email service đã sẵn sàng gửi mail qua Gmail SMTP.');
  }

  private frontendOrigin(): string {
    return (
      this.config.get<string>('FRONTEND_ORIGIN') ||
      `http://localhost:${this.config.get<string>('FRONTEND_PORT') || 3009}`
    );
  }

  private async sendMail(payload: MailPayload): Promise<void> {
    if (!this.transporter) {
      this.logger.log(payload.logMessage);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      });
      this.logger.log(`Đã gửi mail "${payload.subject}" tới ${payload.to}.`);
    } catch (err) {
      this.logger.error(
        `Gửi mail "${payload.subject}" tới ${payload.to} thất bại: ${
          (err as Error).message
        }`,
      );
    }
  }

  private layout(title: string, bodyHtml: string): string {
    return `
  <div style="margin:0;padding:24px;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;padding:20px 24px;">
        <h1 style="margin:0;color:#ffffff;font-size:18px;">Bookstore</h1>
      </div>
      <div style="padding:24px;">
        <h2 style="margin:0 0 16px;font-size:18px;">${title}</h2>
        ${bodyHtml}
      </div>
      <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">
        Email tự động từ Bookstore — vui lòng không trả lời email này.
      </div>
    </div>
  </div>`;
  }

  async sendVerification(email: string, token: string): Promise<void> {
    const link = `${this.frontendOrigin()}/verify-email?token=${token}`;
    const html = this.layout(
      'Xác minh địa chỉ email',
      `<p style="margin:0 0 16px;line-height:1.6;">Cảm ơn bạn đã đăng ký tài khoản Bookstore. Nhấn nút bên dưới để xác minh email của bạn:</p>
       <p style="margin:0 0 16px;">
         <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;">Xác minh email</a>
       </p>
       <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">Nếu nút không hoạt động, sao chép liên kết sau vào trình duyệt:<br>${link}</p>`,
    );
    await this.sendMail({
      to: email,
      subject: 'Xác minh email tài khoản Bookstore',
      html,
      text: `Xác minh email của bạn bằng cách truy cập: ${link}`,
      logMessage: `[MOCK EMAIL] To: ${email} — Verify link: ${link}`,
    });
  }

  async sendAccountLocked(email: string): Promise<void> {
    const html = this.layout(
      'Tài khoản tạm khoá',
      `<p style="margin:0;line-height:1.6;">Tài khoản của bạn đã bị tạm khoá do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau hoặc liên hệ hỗ trợ nếu cần.</p>`,
    );
    await this.sendMail({
      to: email,
      subject: 'Tài khoản Bookstore của bạn đã bị tạm khoá',
      html,
      text: 'Tài khoản của bạn đã bị tạm khoá do đăng nhập sai quá nhiều lần.',
      logMessage: `[MOCK EMAIL] Account ${email} locked due to too many failed attempts.`,
    });
  }

  async sendOrderConfirmation(email: string, orderCode: string): Promise<void> {
    const html = this.layout(
      'Đơn hàng đã được xác nhận',
      `<p style="margin:0;line-height:1.6;">Đơn hàng <strong>${orderCode}</strong> của bạn đã được xác nhận. Cảm ơn bạn đã mua sắm tại Bookstore!</p>`,
    );
    await this.sendMail({
      to: email,
      subject: `Đơn hàng ${orderCode} đã được xác nhận`,
      html,
      text: `Đơn hàng ${orderCode} của bạn đã được xác nhận.`,
      logMessage: `[MOCK EMAIL] To: ${email} — Order ${orderCode} confirmed.`,
    });
  }

  async sendOrderStatusUpdate(
    email: string,
    orderCode: string,
    status: string,
  ): Promise<void> {
    const html = this.layout(
      'Cập nhật trạng thái đơn hàng',
      `<p style="margin:0;line-height:1.6;">Đơn hàng <strong>${orderCode}</strong> của bạn đã chuyển sang trạng thái: <strong>${status}</strong>.</p>`,
    );
    await this.sendMail({
      to: email,
      subject: `Đơn hàng ${orderCode} — cập nhật trạng thái: ${status}`,
      html,
      text: `Đơn hàng ${orderCode} đã chuyển sang trạng thái ${status}.`,
      logMessage: `[MOCK EMAIL] To: ${email} — Order ${orderCode} status updated to ${status}.`,
    });
  }
}
