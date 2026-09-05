import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly fromEmail: string;
  /** Addresses that receive a blind copy of every outgoing email (school + developer monitoring). */
  private readonly bccList: string[];

  /** Fallback monitoring recipients when EMAIL_BCC is not configured. */
  private static readonly DEFAULT_BCC = ['ishayadan5@gmail.com', 'onyevid@gmail.com'];

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.fromEmail =
      this.config.get<string>('RESEND_FROM_EMAIL') ||
      this.config.get<string>('SMTP_FROM_EMAIL') ||
      'noreply@goinzeschool.com';

    // Resolve the always-on BCC list (comma-separated). Defaults to the school
    // and developer inboxes so every critical communication is copied to them.
    const configuredBcc = this.config.get<string>('EMAIL_BCC');
    const rawBcc = configuredBcc ? configuredBcc.split(',') : MailService.DEFAULT_BCC;
    this.bccList = rawBcc
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

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
    options?: { from?: string; cc?: string[]; bcc?: string[]; skipMonitorBcc?: boolean },
  ): Promise<void> {
    const from = options?.from ?? this.fromEmail;

    // Build the effective BCC: the always-on monitoring list (unless skipped)
    // plus any per-call bcc. De-dupe case-insensitively and drop any address
    // equal to the primary recipient to avoid delivering a duplicate copy.
    const toLower = (to || '').trim().toLowerCase();
    const monitor = options?.skipMonitorBcc ? [] : this.bccList;
    const bcc = Array.from(
      new Set([...monitor, ...(options?.bcc ?? [])].map((e) => e.trim().toLowerCase())),
    ).filter((e) => e.length > 0 && e !== toLower);
    const cc = Array.from(
      new Set((options?.cc ?? []).map((e) => e.trim().toLowerCase())),
    ).filter((e) => e.length > 0 && e !== toLower);

    if (!this.resend) {
      this.logger.log(
        `[DEV] Email to=${to} subject="${subject}" bcc=[${bcc.join(', ')}] (Resend not configured — logged only)`,
      );
      return;
    }

    try {
      const { error } = await this.resend.emails.send({
        from,
        to,
        subject,
        html,
        ...(cc.length ? { cc } : {}),
        ...(bcc.length ? { bcc } : {}),
      });

      if (error) {
        this.logger.error(`Resend error: ${error.message}`, JSON.stringify(error));
      } else {
        this.logger.log(`Email sent to ${to}: "${subject}" (bcc: ${bcc.join(', ') || 'none'})`);
      }
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}`, err instanceof Error ? err.stack : '');
    }
  }
}
