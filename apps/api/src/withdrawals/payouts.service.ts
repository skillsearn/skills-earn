import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth';
import { SupabaseService, unwrap } from '../common/supabase.service';
import { toCamel } from '../common/util';
import { FundAccountInput, PayoutStatus, RazorpayPayout, RazorpayService } from '../payments/razorpay.service';

interface WithdrawalRow {
  id: string;
  user_id: string;
  status: string;
  method: 'upi' | 'bank';
  net_amount: string;
  payout_details: { upiId?: string; accountName?: string; accountNumber?: string; ifsc?: string };
  payout_id: string | null;
  payout_fund_account: string | null;
  payout_status: string | null;
  payout_initiated_by: string | null;
}

const PAID: PayoutStatus[] = ['processed'];
const FAILED: PayoutStatus[] = ['reversed', 'failed', 'rejected', 'cancelled'];
const UPI_LIMIT = 100_000;
const IMPS_LIMIT = 500_000;

/**
 * Pays approved withdrawals through RazorpayX and keeps them in sync.
 * Razorpay is the source of truth for the outcome; the ledger only moves through
 * transition_withdrawal, exactly as for a manual payout.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly razorpay: RazorpayService,
    private readonly audit: AuditService,
  ) {}

  status() {
    return {
      enabled: this.razorpay.payoutsEnabled,
      testMode: this.razorpay.isTestMode,
      reason: this.razorpay.payoutsEnabled
        ? null
        : !this.razorpay.keyId
          ? 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set'
          : 'RAZORPAYX_ACCOUNT_NUMBER is not set. Activate RazorpayX and add your RazorpayX account number to the API .env',
    };
  }

  private async load(id: string) {
    const w = unwrap(await this.supabase.db.from('withdrawals').select('*').eq('id', id).maybeSingle()) as WithdrawalRow | null;
    if (!w) throw new NotFoundException({ code: 'WITHDRAWAL_NOT_FOUND', message: 'Withdrawal not found' });
    return w;
  }

  /** approved → RazorpayX payout → processing. Safe to retry after an initiation failure. */
  async initiate(id: string, actor: AuthUser, ip: string | null) {
    if (!this.razorpay.payoutsEnabled) {
      throw new BadRequestException({ code: 'PAYOUTS_DISABLED', message: this.status().reason });
    }

    // Claim the row in one statement so two admins can't start two payouts.
    const { data: claimed } = await this.supabase.db
      .from('withdrawals')
      .update({ payout_provider: 'razorpayx', payout_status: 'initiating', payout_error: null, payout_initiated_by: actor.id, payout_initiated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'approved')
      .is('payout_id', null)
      .or('payout_status.is.null,payout_status.eq.initiation_failed')
      .select('*')
      .maybeSingle();
    const w = claimed as WithdrawalRow | null;
    if (!w) {
      const current = await this.load(id);
      throw new ConflictException({
        code: 'PAYOUT_NOT_ALLOWED',
        message: current.payout_id || current.payout_status === 'initiating'
          ? 'A payout has already been started for this withdrawal'
          : `Only approved withdrawals can be paid (current status: ${current.status})`,
      });
    }

    let payout: RazorpayPayout;
    try {
      const amount = Number(w.net_amount);
      const mode = w.method === 'upi' ? 'UPI' : amount <= IMPS_LIMIT ? 'IMPS' : 'NEFT';
      if (mode === 'UPI' && amount > UPI_LIMIT) {
        throw new BadRequestException({ code: 'UPI_LIMIT', message: `UPI payouts are limited to ₹${UPI_LIMIT.toLocaleString('en-IN')}. Ask the user to withdraw to a bank account.` });
      }
      const fundAccountId = w.payout_fund_account ?? (await this.fundAccount(w));
      await this.supabase.db.from('withdrawals').update({ payout_fund_account: fundAccountId, payout_mode: mode }).eq('id', w.id);

      payout = await this.razorpay.createPayout(
        { fundAccountId, amountPaise: Math.round(amount * 100), mode, referenceId: w.id, notes: { withdrawal_id: w.id, user_id: w.user_id } },
        `wd-${w.id}`,
      );
    } catch (err) {
      let message = (err as { response?: { message?: string } }).response?.message ?? (err as Error).message;
      // Razorpay answers like this when RazorpayX is not activated for these keys.
      if (/not found on the server|requested resource not available/i.test(message)) {
        message = 'RazorpayX payouts are not activated for this Razorpay account. Activate RazorpayX (x.razorpay.com) and check RAZORPAYX_ACCOUNT_NUMBER.';
        err = new BadGatewayException({ code: 'PAYOUTS_NOT_ACTIVATED', message });
      }
      await this.supabase.db.from('withdrawals').update({ payout_status: 'initiation_failed', payout_error: message }).eq('id', w.id);
      throw err;
    }

    await this.supabase.db
      .from('withdrawals')
      .update({ payout_id: payout.id, payout_status: payout.status, payout_utr: payout.utr, payout_mode: payout.mode })
      .eq('id', w.id);
    await this.audit.log({ actorId: actor.id, action: 'withdrawal.payout_initiated', entity: 'withdrawal', entityId: w.id, after: { payoutId: payout.id, mode: payout.mode, amount: payout.amount / 100 }, ip });
    await this.apply({ ...w, payout_id: payout.id, payout_initiated_by: actor.id }, payout);
    return this.view(w.id);
  }

  /** One RazorpayX contact per user (cached on the profile), one fund account per payout destination. */
  private async fundAccount(w: WithdrawalRow) {
    const p = unwrap(
      await this.supabase.db.from('profiles').select('id, user_code, full_name, email, mobile, razorpay_contact_id').eq('id', w.user_id).single(),
    ) as { id: string; user_code: string; full_name: string; email: string; mobile: string; razorpay_contact_id: string | null };

    let contactId = p.razorpay_contact_id;
    if (!contactId) {
      contactId = (await this.razorpay.createContact({ name: p.full_name, email: p.email, contact: p.mobile.replace(/\D/g, '').slice(-10), reference_id: p.user_code })).id;
      await this.supabase.db.from('profiles').update({ razorpay_contact_id: contactId }).eq('id', p.id);
    }

    const d = w.payout_details;
    const account: FundAccountInput =
      w.method === 'upi'
        ? { account_type: 'vpa', vpa: { address: d.upiId! } }
        : { account_type: 'bank_account', bank_account: { name: d.accountName!, ifsc: d.ifsc!, account_number: d.accountNumber! } };
    return (await this.razorpay.createFundAccount(contactId, account)).id;
  }

  /** Moves the withdrawal to match Razorpay's payout status. Idempotent. */
  private async apply(w: WithdrawalRow, payout: RazorpayPayout, source = 'sync') {
    const reason = payout.status_details?.description ?? payout.failure_reason ?? null;
    await this.supabase.db
      .from('withdrawals')
      .update({ payout_status: payout.status, payout_utr: payout.utr ?? null, payout_error: FAILED.includes(payout.status) ? reason : null })
      .eq('id', w.id);

    const actor = w.payout_initiated_by;
    const transition = (to: string, note: string, reference: string | null = null) =>
      this.supabase.rpc('transition_withdrawal', { p_id: w.id, p_to: to, p_actor: actor, p_note: note, p_reference: reference });

    // A payout exists, so the request is with the bank: approved → processing first.
    if (w.status === 'approved') {
      await transition('processing', `RazorpayX payout ${payout.id} (${payout.mode})`);
      w = { ...w, status: 'processing' };
    }
    if (w.status === 'processing' && PAID.includes(payout.status)) {
      await transition('paid', `Paid via RazorpayX (${source})`, payout.utr || payout.id);
    } else if (w.status === 'processing' && FAILED.includes(payout.status)) {
      await transition('failed', `RazorpayX payout ${payout.status}${reason ? `: ${reason}` : ''}`);
    } else if (w.status === 'paid' && payout.status === 'reversed') {
      // Money came back after we marked it paid; the ledger can't be rewound automatically.
      await this.supabase.db.from('fraud_alerts').insert({
        type: 'payout_reversed', severity: 'high', user_id: w.user_id,
        details: { withdrawal_id: w.id, payout_id: payout.id, reason },
      });
    }
  }

  async sync(id: string) {
    const w = await this.load(id);
    if (!w.payout_id) throw new BadRequestException({ code: 'NO_PAYOUT', message: 'This withdrawal has no RazorpayX payout' });
    await this.apply(w, await this.razorpay.fetchPayout(w.payout_id));
    return this.view(id);
  }

  /** payout.* webhook events (signature already verified by the caller). */
  async handleWebhook(event: string, payout: RazorpayPayout | undefined) {
    if (!payout?.id) return;
    const w = unwrap(await this.supabase.db.from('withdrawals').select('*').eq('payout_id', payout.id).maybeSingle()) as WithdrawalRow | null;
    if (!w) {
      this.logger.warn(`${event} for unknown payout ${payout.id}`);
      return;
    }
    await this.apply(w, payout, 'webhook');
  }

  /** Safety net for missed webhooks. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncOpenPayouts() {
    if (!this.razorpay.payoutsEnabled) return;
    const { data } = await this.supabase.db.from('withdrawals').select('id').eq('status', 'processing').not('payout_id', 'is', null).limit(100);
    for (const { id } of data ?? []) {
      await this.sync(id).catch((err: Error) => this.logger.error(`payout sync ${id} failed: ${err.message}`));
    }
  }

  private async view(id: string) {
    return toCamel(await this.load(id));
  }
}
