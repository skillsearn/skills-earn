import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { AuthCache, AuthUser, ClientIp, CurrentUser, Public, Roles } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { Env } from '../common/env';
import { searchUserIds, SupabaseService, toHttpError, unwrap } from '../common/supabase.service';
import { UploadsService } from '../common/uploads.service';
import { pageRange, round2, toCamel } from '../common/util';
import { SettingsModule, SettingsService } from '../settings/settings.module';
import { PayoutsService } from '../withdrawals/payouts.service';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { RazorpayService } from './razorpay.service';

export class CheckoutDto {
  @IsOptional() @IsUUID() purchaseId?: string;
  @IsOptional() @IsUUID() packageId?: string;
}

export class UpgradeDto {
  @IsUUID() packageId: string;
}

export class VerifyDto {
  @IsUUID() purchaseId: string;
  @IsString() @MaxLength(64) razorpayOrderId: string;
  @IsString() @MaxLength(64) razorpayPaymentId: string;
  @IsString() @MaxLength(256) razorpaySignature: string;
}

export class ManualVerifyDto {
  @IsString() @MinLength(3) @MaxLength(80) reference: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ManualProofDto {
  @IsString() @MaxLength(8_000_000) image: string;
  @IsString() @MinLength(6) @MaxLength(40) utr: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class FailDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  package_id: string;
  from_package_id: string | null;
  type: 'new' | 'upgrade';
  amount: string;
  status: string;
  provider: string | null;
  provider_order_id: string | null;
  manual_proof_path: string | null;
  manual_utr: string | null;
  manual_submitted_at: string | null;
}

const formatAmount = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PURCHASE_SELECT =
  '*, package:packages!purchases_package_id_fkey(name, level), from_package:packages!purchases_from_package_id_fkey(name, level)';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly razorpay: RazorpayService,
    private readonly payouts: PayoutsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly cache: AuthCache,
    private readonly config: ConfigService<Env, true>,
    private readonly uploads: UploadsService,
  ) {}

  private get provider() {
    return this.config.get('PAYMENT_PROVIDER');
  }

  private async purchaseFor(user: AuthUser, id: string): Promise<PurchaseRow> {
    const p = unwrap(await this.supabase.db.from('purchases').select('*').eq('id', id).maybeSingle()) as PurchaseRow | null;
    if (!p || p.user_id !== user.id) throw new NotFoundException({ code: 'PURCHASE_NOT_FOUND', message: 'Purchase not found' });
    return p;
  }

  private async logEvent(purchaseId: string | null, provider: string, event: string, payload: unknown) {
    await this.supabase.db.from('payment_events').insert({ purchase_id: purchaseId, provider, event, payload });
  }

  private async activate(purchaseId: string, provider: string, paymentId: string | null, verifiedBy: string | null) {
    const result = await this.supabase.rpc<{ status: string }>('activate_purchase', {
      p_purchase_id: purchaseId,
      p_provider: provider,
      p_payment_id: paymentId,
      p_verified_by: verifiedBy,
    });
    const { data } = await this.supabase.db.from('purchases').select('user_id').eq('id', purchaseId).single();
    if (data) this.cache.invalidateUser(data.user_id);
    return result;
  }

  private async checkoutPayload(p: PurchaseRow, user: AuthUser) {
    if (!['pending', 'failed'].includes(p.status)) {
      throw new BadRequestException({ code: 'PURCHASE_NOT_PAYABLE', message: `Purchase is ${p.status}` });
    }
    const pkg = unwrap(await this.supabase.db.from('packages').select('name').eq('id', p.package_id).single());
    const amount = Number(p.amount);
    const manual = await this.settings.manualPayment();
    const base = {
      purchaseId: p.id, type: p.type, packageName: pkg.name, amount, status: p.status,
      manual: manual.enabled ? manual : null,
      proof: p.manual_proof_path ? { utr: p.manual_utr, submittedAt: p.manual_submitted_at } : null,
    };

    if (this.provider === 'mock') {
      if (p.provider !== 'mock') await this.supabase.db.from('purchases').update({ provider: 'mock' }).eq('id', p.id);
      return { ...base, provider: 'mock' as const };
    }

    let orderId = p.provider_order_id;
    if (!orderId) {
      try {
        const order = await this.razorpay.createOrder(amount, p.id, { purchase_id: p.id, user_code: user.userCode });
        orderId = order.id;
        unwrap(await this.supabase.db.from('purchases').update({ provider: 'razorpay', provider_order_id: orderId }).eq('id', p.id));
        await this.logEvent(p.id, 'razorpay', 'order.created', order);
      } catch (err) {
        // Gateway down / not configured: members can still pay manually.
        if (!base.manual) throw err;
        this.logger.warn(`Razorpay order failed for ${p.id}: ${(err as Error).message}`);
        return { ...base, provider: 'manual' as const };
      }
    }
    const prof = unwrap(await this.supabase.db.from('profiles').select('full_name, email, mobile').eq('id', user.id).single());
    return {
      ...base,
      provider: 'razorpay' as const,
      keyId: this.razorpay.keyId,
      orderId,
      amountPaise: Math.round(amount * 100),
      currency: 'INR',
      prefill: { name: prof.full_name, email: prof.email, contact: prof.mobile },
    };
  }

  async checkout(user: AuthUser, dto: CheckoutDto) {
    if (dto.purchaseId) return this.checkoutPayload(await this.purchaseFor(user, dto.purchaseId), user);

    if (!dto.packageId) throw new BadRequestException({ code: 'PACKAGE_REQUIRED', message: 'Select a package' });
    const prof = unwrap(await this.supabase.db.from('profiles').select('active_package_id').eq('id', user.id).single());
    if (prof.active_package_id) {
      throw new BadRequestException({ code: 'ALREADY_ACTIVE', message: 'You already have an active package. Use upgrade.' });
    }
    const pkg = unwrap(await this.supabase.db.from('packages').select('id, price, is_active').eq('id', dto.packageId).maybeSingle());
    if (!pkg?.is_active) throw new BadRequestException({ code: 'INVALID_PACKAGE', message: 'Package not available' });

    await this.supabase.db.from('purchases').update({ status: 'cancelled' })
      .eq('user_id', user.id).eq('type', 'new').eq('status', 'pending');
    const p = unwrap(
      await this.supabase.db
        .from('purchases')
        .insert({ user_id: user.id, package_id: pkg.id, type: 'new', amount: pkg.price, commission_base: pkg.price })
        .select('*')
        .single(),
    ) as PurchaseRow;
    return this.checkoutPayload(p, user);
  }

  async upgradeOptions(user: AuthUser) {
    const prof = unwrap(
      await this.supabase.db
        .from('profiles')
        .select('package_activated_at, active_package:packages!profiles_active_package_id_fkey(id, name, level, price)')
        .eq('id', user.id)
        .single(),
    ) as unknown as { package_activated_at: string | null; active_package: { id: string; name: string; level: number; price: string } | null };
    if (!prof.active_package) {
      throw new BadRequestException({ code: 'NO_ACTIVE_PACKAGE', message: 'Activate a package before upgrading' });
    }
    const s = await this.settings.get('upgrade');
    const deadline =
      s.windowDays > 0 && prof.package_activated_at
        ? new Date(new Date(prof.package_activated_at).getTime() + s.windowDays * 86_400_000).toISOString()
        : null;
    const windowOpen = !deadline || new Date(deadline) > new Date();
    const higher = unwrap(
      await this.supabase.db.from('packages').select('id, name, level, price, max_generations')
        .eq('is_active', true).gt('level', prof.active_package.level).order('level'),
    );
    const currentPrice = Number(prof.active_package.price);
    return {
      current: { ...prof.active_package, price: currentPrice },
      deadline,
      windowOpen,
      commissionable: s.commissionable && s.commissionBaseBps > 0,
      options: higher
        .map((p: { id: string; name: string; level: number; price: string; max_generations: number }) => ({
          id: p.id, name: p.name, level: p.level, price: Number(p.price),
          maxGenerations: p.max_generations, payable: round2(Number(p.price) - currentPrice),
        }))
        .filter((o: { payable: number }) => o.payable > 0),
    };
  }

  async createUpgrade(user: AuthUser, dto: UpgradeDto) {
    const opts = await this.upgradeOptions(user);
    if (!opts.windowOpen) throw new BadRequestException({ code: 'UPGRADE_WINDOW_CLOSED', message: 'The upgrade period has ended' });
    const option = opts.options.find((o: { id: string; payable: number }) => o.id === dto.packageId);
    if (!option) throw new BadRequestException({ code: 'INVALID_UPGRADE', message: 'This upgrade is not available' });

    const s = await this.settings.get('upgrade');
    const commissionBase = s.commissionable ? round2((option.payable * s.commissionBaseBps) / 10000) : 0;

    await this.supabase.db.from('purchases').update({ status: 'cancelled' })
      .eq('user_id', user.id).eq('type', 'upgrade').eq('status', 'pending');
    const p = unwrap(
      await this.supabase.db
        .from('purchases')
        .insert({
          user_id: user.id,
          package_id: option.id,
          from_package_id: opts.current.id,
          type: 'upgrade',
          amount: option.payable,
          commission_base: commissionBase,
          commission_status: commissionBase > 0 ? 'pending' : 'not_applicable',
        })
        .select('*')
        .single(),
    ) as PurchaseRow;
    return this.checkoutPayload(p, user);
  }

  /** Client-side Razorpay success handler → server verification. */
  async verify(user: AuthUser, dto: VerifyDto) {
    const p = await this.purchaseFor(user, dto.purchaseId);
    if (p.provider_order_id !== dto.razorpayOrderId) {
      throw new BadRequestException({ code: 'ORDER_MISMATCH', message: 'Order does not match purchase' });
    }
    if (!this.razorpay.verifyCheckoutSignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature)) {
      await this.logEvent(p.id, 'razorpay', 'signature.invalid', dto);
      throw new BadRequestException({ code: 'INVALID_SIGNATURE', message: 'Payment verification failed' });
    }
    let payment = await this.razorpay.fetchPayment(dto.razorpayPaymentId);
    const expected = Math.round(Number(p.amount) * 100);
    if (payment.order_id !== p.provider_order_id || payment.amount !== expected) {
      await this.logEvent(p.id, 'razorpay', 'payment.mismatch', payment);
      throw new BadRequestException({ code: 'PAYMENT_MISMATCH', message: 'Payment amount mismatch' });
    }
    if (payment.status === 'authorized') payment = await this.razorpay.capture(payment.id, expected);
    await this.logEvent(p.id, 'razorpay', `payment.${payment.status}`, payment);
    if (payment.status !== 'captured') {
      throw new BadRequestException({ code: 'PAYMENT_NOT_CAPTURED', message: `Payment is ${payment.status}` });
    }
    return this.activate(p.id, 'razorpay', payment.id, null);
  }

  async webhook(raw: Buffer | undefined, signature: string, body: any) {
    if (!raw || !this.razorpay.verifyWebhook(raw, signature)) {
      this.logger.warn('Rejected webhook with invalid signature');
      throw new ForbiddenException({ code: 'INVALID_SIGNATURE', message: 'Invalid signature' });
    }
    const event: string = body?.event ?? 'unknown';
    if (event.startsWith('payout.')) {
      await this.logEvent(null, 'razorpayx', `webhook.${event}`, body);
      await this.payouts.handleWebhook(event, body?.payload?.payout?.entity);
      return { ok: true };
    }
    const payment = body?.payload?.payment?.entity;
    const orderId: string | undefined = payment?.order_id;
    const { data: p } = orderId
      ? await this.supabase.db.from('purchases').select('*').eq('provider_order_id', orderId).maybeSingle()
      : { data: null };
    await this.logEvent(p?.id ?? null, 'razorpay', `webhook.${event}`, body);
    if (!p) return { ok: true };

    if (event === 'payment.captured') {
      if (payment.amount !== Math.round(Number(p.amount) * 100)) {
        await this.supabase.db.from('fraud_alerts').insert({
          type: 'payment_amount_mismatch', severity: 'high', user_id: p.user_id, purchase_id: p.id,
          details: { expected: p.amount, received_paise: payment.amount },
        });
        return { ok: true };
      }
      try {
        await this.activate(p.id, 'razorpay', payment.id, null);
      } catch (err) {
        await this.logEvent(p.id, 'razorpay', 'activation_error', { message: (err as Error).message });
      }
    } else if (event === 'payment.failed') {
      await this.supabase.db.from('purchases').update({ status: 'failed' }).eq('id', p.id).eq('status', 'pending');
    }
    return { ok: true };
  }

  async mockConfirm(user: AuthUser, id: string) {
    if (this.provider !== 'mock' || this.config.get('NODE_ENV') === 'production') {
      throw new ForbiddenException({ code: 'MOCK_DISABLED', message: 'Mock payments are disabled' });
    }
    const p = await this.purchaseFor(user, id);
    await this.logEvent(p.id, 'mock', 'payment.captured', { amount: p.amount });
    return this.activate(p.id, 'mock', `mock_${randomUUID()}`, null);
  }

  /** Member paid outside the gateway (UPI / bank transfer) and uploads the screenshot + UTR for admin review. */
  async submitManualProof(user: AuthUser, id: string, dto: ManualProofDto) {
    const manual = await this.settings.manualPayment();
    if (!manual.enabled) throw new BadRequestException({ code: 'MANUAL_DISABLED', message: 'Manual payment is not available right now' });
    const p = await this.purchaseFor(user, id);
    if (!['pending', 'failed'].includes(p.status)) {
      throw new BadRequestException({ code: 'PURCHASE_NOT_PAYABLE', message: `Purchase is ${p.status}` });
    }
    const utr = dto.utr.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,40}$/.test(utr)) throw new BadRequestException({ code: 'INVALID_UTR', message: 'Enter the UTR / transaction ID shown in your payment app' });
    const { data: reused } = await this.supabase.db.from('purchases').select('id, user_id')
      .eq('manual_utr', utr).neq('id', p.id).in('status', ['pending', 'paid']).limit(1);
    if (reused?.length) {
      await this.supabase.db.from('fraud_alerts').insert({
        type: 'manual_utr_reused', severity: 'high', user_id: user.id, purchase_id: p.id,
        details: { utr, other_purchase: reused[0].id, other_user: reused[0].user_id },
      });
      throw new BadRequestException({ code: 'UTR_ALREADY_USED', message: 'This UTR has already been submitted for another payment' });
    }

    const path = await this.uploads.uploadImage(`payment-proofs/${user.id}`, dto.image);
    const now = new Date().toISOString();
    unwrap(
      await this.supabase.db.from('purchases').update({
        status: 'pending', manual_proof_path: path, manual_utr: utr, manual_note: dto.note?.trim() || null, manual_submitted_at: now,
      }).eq('id', p.id).in('status', ['pending', 'failed']),
    );
    await this.logEvent(p.id, 'manual', 'proof.submitted', { utr, path, note: dto.note ?? null, previous: p.manual_proof_path });

    const { data: admins } = await this.supabase.db.from('profiles').select('id').eq('role', 'admin');
    if (admins?.length) {
      await this.supabase.db.from('notifications').insert(admins.map((a: { id: string }) => ({
        user_id: a.id, type: 'manual_payment', title: 'Manual payment to verify',
        body: `${user.userCode} uploaded a payment screenshot for ${formatAmount(p.amount)} (UTR ${utr}).`, link: '/admin/payments',
      })));
    }
    return { ok: true, purchaseId: p.id, submittedAt: now, utr };
  }

  async myPurchases(user: AuthUser) {
    const rows = unwrap(
      await this.supabase.db.from('purchases').select(PURCHASE_SELECT).eq('user_id', user.id)
        .neq('status', 'cancelled').order('created_at', { ascending: false }),
    );
    return toCamel(rows);
  }

  // ───────── admin ─────────
  async adminList(q: { status?: string; type?: string; proof?: string; search?: string; page?: string; pageSize?: string }) {
    const { from, to, page, pageSize } = pageRange(q.page, q.pageSize);
    let query = this.supabase.db
      .from('purchases')
      .select(`${PURCHASE_SELECT}, user:profiles!purchases_user_id_fkey(user_code, full_name, mobile)`, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (q.status) query = query.eq('status', q.status);
    if (q.type) query = query.eq('type', q.type);
    if (q.proof === 'submitted') query = query.not('manual_proof_path', 'is', null);
    if (q.search) query = query.in('user_id', await searchUserIds(this.supabase, q.search));
    const { data, count, error } = await query;
    if (error) throw toHttpError(error);
    return { items: toCamel(data), total: count ?? 0, page, pageSize };
  }

  async adminDetail(id: string) {
    const [purchase, events, commissions] = await Promise.all([
      this.supabase.db.from('purchases')
        .select(`${PURCHASE_SELECT}, user:profiles!purchases_user_id_fkey(id, user_code, full_name, mobile, email)`)
        .eq('id', id).maybeSingle().then(unwrap),
      this.supabase.db.from('payment_events').select('*').eq('purchase_id', id).order('created_at').then(unwrap),
      this.supabase.db.from('commissions')
        .select('*, beneficiary:profiles!commissions_beneficiary_id_fkey(user_code, full_name)')
        .eq('purchase_id', id).order('level').then(unwrap),
    ]);
    if (!purchase) throw new NotFoundException({ code: 'PURCHASE_NOT_FOUND', message: 'Purchase not found' });
    const proofUrl = await this.uploads.signedUrl((purchase as PurchaseRow).manual_proof_path);
    return toCamel({ purchase: { ...purchase, proof_url: proofUrl }, events, commissions });
  }

  async manualVerify(id: string, dto: ManualVerifyDto, actor: AuthUser, ip: string | null) {
    const before = unwrap(await this.supabase.db.from('purchases').select('*').eq('id', id).maybeSingle());
    if (!before) throw new NotFoundException({ code: 'PURCHASE_NOT_FOUND', message: 'Purchase not found' });
    if (dto.note) await this.supabase.db.from('purchases').update({ notes: dto.note }).eq('id', id);
    await this.logEvent(id, 'manual', 'payment.manual_verified', { reference: dto.reference, by: actor.userCode });
    const result = await this.activate(id, 'manual', `manual_${dto.reference.trim()}`, actor.id);
    await this.audit.log({ actorId: actor.id, action: 'payment.manual_verify', entity: 'purchase', entityId: id, before, after: { reference: dto.reference, result }, ip });
    return result;
  }

  async markFailed(id: string, dto: FailDto, actor: AuthUser, ip: string | null) {
    const before = unwrap(await this.supabase.db.from('purchases').select('*').eq('id', id).maybeSingle());
    if (!before) throw new NotFoundException({ code: 'PURCHASE_NOT_FOUND', message: 'Purchase not found' });
    if (before.status !== 'pending') throw new BadRequestException({ code: 'NOT_PENDING', message: 'Only pending payments can be failed' });
    const after = unwrap(
      await this.supabase.db.from('purchases').update({ status: 'failed', notes: dto.note ?? before.notes }).eq('id', id).select().single(),
    );
    await this.audit.log({ actorId: actor.id, action: 'payment.mark_failed', entity: 'purchase', entityId: id, before, after, ip });
    if (before.manual_proof_path) {
      await this.supabase.db.from('notifications').insert({
        user_id: before.user_id, type: 'payment', title: 'Payment could not be verified',
        body: dto.note ? `Reason: ${dto.note}. You can upload a new screenshot.` : 'Your payment screenshot could not be verified. Please upload a new one or contact support.',
        link: `/app/checkout/${id}`,
      });
    }
    return toCamel(after);
  }
}

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payments/checkout')
  checkout(@CurrentUser() u: AuthUser, @Body() dto: CheckoutDto) {
    return this.payments.checkout(u, dto);
  }

  @Get('payments/upgrade-options')
  upgradeOptions(@CurrentUser() u: AuthUser) {
    return this.payments.upgradeOptions(u);
  }

  @Post('payments/upgrade')
  upgrade(@CurrentUser() u: AuthUser, @Body() dto: UpgradeDto) {
    return this.payments.createUpgrade(u, dto);
  }

  @HttpCode(200)
  @Post('payments/verify')
  verify(@CurrentUser() u: AuthUser, @Body() dto: VerifyDto) {
    return this.payments.verify(u, dto);
  }

  @HttpCode(200)
  @Post('payments/mock/:id/confirm')
  mock(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.mockConfirm(u, id);
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('payments/webhook/razorpay')
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') sig: string, @Body() body: unknown) {
    return this.payments.webhook(req.rawBody, sig, body);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('payments/:id/manual-proof')
  manualProof(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ManualProofDto) {
    return this.payments.submitManualProof(u, id, dto);
  }

  @Get('me/purchases')
  mine(@CurrentUser() u: AuthUser) {
    return this.payments.myPurchases(u);
  }

  @Roles('admin')
  @Get('admin/payments')
  adminList(@Query() q: Record<string, string>) {
    return this.payments.adminList(q);
  }

  @Roles('admin')
  @Get('admin/payments/:id')
  adminDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.adminDetail(id);
  }

  @Roles('admin')
  @HttpCode(200)
  @Post('admin/payments/:id/verify')
  manualVerify(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ManualVerifyDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) {
    return this.payments.manualVerify(id, dto, u, ip);
  }

  @Roles('admin')
  @HttpCode(200)
  @Post('admin/payments/:id/fail')
  fail(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FailDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) {
    return this.payments.markFailed(id, dto, u, ip);
  }
}

@Module({
  imports: [SettingsModule, WithdrawalsModule],
  providers: [PaymentsService, RazorpayService],
  controllers: [PaymentsController],
})
export class PaymentsModule {}
