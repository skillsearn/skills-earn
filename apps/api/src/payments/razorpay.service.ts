import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Env } from '../common/env';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
}

export type PayoutStatus = 'queued' | 'pending' | 'processing' | 'processed' | 'reversed' | 'cancelled' | 'rejected' | 'failed';

export interface RazorpayPayout {
  id: string;
  fund_account_id: string;
  amount: number;
  status: PayoutStatus;
  mode: string;
  utr: string | null;
  reference_id: string | null;
  status_details?: { description?: string | null; reason?: string | null } | null;
  failure_reason?: string | null;
}

export type FundAccountInput =
  | { account_type: 'vpa'; vpa: { address: string } }
  | { account_type: 'bank_account'; bank_account: { name: string; ifsc: string; account_number: string } };

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Minimal Razorpay REST client (no SDK needed). */
@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly base = 'https://api.razorpay.com/v1';

  constructor(private readonly config: ConfigService<Env, true>) {}

  get keyId() {
    return this.config.get('RAZORPAY_KEY_ID', { infer: true }) ?? '';
  }

  private get secret() {
    return this.config.get('RAZORPAY_KEY_SECRET', { infer: true }) ?? '';
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.keyId}:${this.secret}`).toString('base64'),
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) {
      this.logger.error(`Razorpay ${method} ${path} → ${res.status} ${json.error?.description ?? ''}`);
      throw new BadGatewayException({ code: 'PAYMENT_GATEWAY_ERROR', message: json.error?.description ?? 'Payment gateway error' });
    }
    return json;
  }

  createOrder(amountRupees: number, receipt: string, notes: Record<string, string>) {
    return this.call<RazorpayOrder>('POST', '/orders', {
      amount: Math.round(amountRupees * 100),
      currency: 'INR',
      receipt: receipt.slice(0, 40),
      notes,
    });
  }

  fetchPayment(paymentId: string) {
    return this.call<RazorpayPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`);
  }

  capture(paymentId: string, amountPaise: number) {
    return this.call<RazorpayPayment>('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, {
      amount: amountPaise,
      currency: 'INR',
    });
  }

  // ── RazorpayX payouts ──

  get payoutAccount() {
    return this.config.get('RAZORPAYX_ACCOUNT_NUMBER', { infer: true }) ?? '';
  }

  get payoutsEnabled() {
    return !!(this.keyId && this.secret && this.payoutAccount);
  }

  get isTestMode() {
    return this.keyId.startsWith('rzp_test_');
  }

  createContact(c: { name: string; email: string; contact: string; reference_id: string }) {
    return this.call<{ id: string }>('POST', '/contacts', { ...c, type: 'customer' });
  }

  createFundAccount(contactId: string, account: FundAccountInput) {
    return this.call<{ id: string }>('POST', '/fund_accounts', { contact_id: contactId, ...account });
  }

  /** Same idempotency key + same body returns the original payout instead of paying twice. */
  createPayout(p: { fundAccountId: string; amountPaise: number; mode: string; referenceId: string; notes: Record<string, string> }, idempotencyKey: string) {
    return this.call<RazorpayPayout>(
      'POST',
      '/payouts',
      {
        account_number: this.payoutAccount,
        fund_account_id: p.fundAccountId,
        amount: p.amountPaise,
        currency: 'INR',
        mode: p.mode,
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: p.referenceId.slice(0, 40),
        narration: 'SKILLSEARN Withdrawal',
        notes: p.notes,
      },
      { 'X-Payout-Idempotency': idempotencyKey },
    );
  }

  fetchPayout(payoutId: string) {
    return this.call<RazorpayPayout>('GET', `/payouts/${encodeURIComponent(payoutId)}`);
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
    const expected = createHmac('sha256', this.secret).update(`${orderId}|${paymentId}`).digest('hex');
    return safeEqual(expected, signature);
  }

  verifyWebhook(rawBody: Buffer, signature: string) {
    const secret = this.config.get('RAZORPAY_WEBHOOK_SECRET', { infer: true });
    if (!secret || !signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return safeEqual(expected, signature);
  }
}
