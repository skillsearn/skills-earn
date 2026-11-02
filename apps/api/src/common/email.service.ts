import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './env';

/** Sends transactional email through the Resend HTTP API. */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(to: string, subject: string, html: string, text: string): Promise<boolean> {
    const key = this.config.get('RESEND_API_KEY', { infer: true });
    const from = this.config.get('EMAIL_FROM', { infer: true }) || 'SkillsEarn <no-reply@skillsearn.in>';
    if (!key) {
      this.logger.warn(`RESEND_API_KEY not set — email "${subject}" to ${to} not sent`);
      return false;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
      });
      if (!res.ok) {
        this.logger.warn(`Resend ${res.status}: ${await res.text()}`);
        return false;
      }
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      this.logger.log(`Resend accepted email id=${body.id ?? '?'}`);
      return true;
    } catch (err) {
      this.logger.warn(`Resend request failed: ${(err as Error).message}`);
      return false;
    }
  }
}
