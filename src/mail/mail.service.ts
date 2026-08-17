import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly fromEmail: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.fromEmail =
      this.config.get<string>('RESEND_FROM_EMAIL') ||
      this.config.get<string>('SMTP_FROM_EMAIL') ||
      'noreply@goinzeschool.com';

    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.logger.warn(
        'RESEND_API_KEY is not set — emails will be logged to console instead of sent.',
      );
      this.resend = null;
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    options?: { from?: string },
  ): Promise<void> {
    const from = options?.from ?? this.fromEmail;

    if (!this.resend) {
      this.logger.log(
        `[DEV] Email to=${to} subject="${subject}" (Resend not configured — logged only)`,
      );
      return;
    }

    try {
      const { error } = await this.resend.emails.send({
        from,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Resend error: ${error.message}`, JSON.stringify(error));
      } else {
        this.logger.log(`Email sent to ${to}: "${subject}"`);
      }
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}`, err instanceof Error ? err.stack : '');
    }
  }
}
