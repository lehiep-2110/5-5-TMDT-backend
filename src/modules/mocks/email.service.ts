import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendVerification(email: string, token: string): Promise<void> {
    const frontendOrigin =
      process.env.FRONTEND_ORIGIN ||
      `http://localhost:${process.env.FRONTEND_PORT || 3009}`;
    const link = `${frontendOrigin}/verify-email?token=${token}`;
    this.logger.log(`[MOCK EMAIL] To: ${email} — Verify link: ${link}`);
  }

  async sendAccountLocked(email: string): Promise<void> {
    this.logger.log(
      `[MOCK EMAIL] Account ${email} locked due to too many failed attempts.`,
    );
  }

  async sendOrderConfirmation(
    email: string,
    orderCode: string,
  ): Promise<void> {
    this.logger.log(
      `[MOCK EMAIL] To: ${email} — Order ${orderCode} confirmed.`,
    );
  }

  async sendOrderStatusUpdate(
    email: string,
    orderCode: string,
    status: string,
  ): Promise<void> {
    this.logger.log(
      `[MOCK EMAIL] To: ${email} — Order ${orderCode} status updated to ${status}.`,
    );
  }
}
