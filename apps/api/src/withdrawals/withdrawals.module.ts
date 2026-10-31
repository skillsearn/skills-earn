import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuthUser, ClientIp, CurrentUser, Roles } from '../common/auth';
import { searchUserIds, SupabaseService, toHttpError, unwrap } from '../common/supabase.service';
import { UploadsService } from '../common/uploads.service';
import { isWindowOpen, nextWindowStart, pageRange, toCamel, withdrawalQuote } from '../common/util';
import { PayoutDetailsDto } from '../auth/auth.module';
import { SettingsModule, SettingsService } from '../settings/settings.module';
import { RazorpayService } from '../payments/razorpay.service';
import { PayoutsService } from './payouts.service';

export class RequestWithdrawalDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) amount: number;
  @IsIn(['upi', 'bank']) method: 'upi' | 'bank';
  @ValidateNested() @Type(() => PayoutDetailsDto) details: PayoutDetailsDto;
  @IsOptional() @IsBoolean() saveDetails?: boolean;
}

export const WITHDRAWAL_STATUSES = ['requested', 'under_review', 'approved', 'processing', 'paid', 'rejected', 'failed'] as const;

export class TransitionDto {
  @IsIn(WITHDRAWAL_STATUSES) status: (typeof WITHDRAWAL_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsString() @MaxLength(100) paymentReference?: string;
}

const OPEN = ['requested', 'under_review', 'approved', 'processing'];

@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: SettingsService,
    private readonly uploads: UploadsService,
  ) {}

  async quote(user: AuthUser, amount: number) {
    const [s, wallet, open] = await Promise.all([
      this.settings.get('withdrawal'),
      this.supabase.rpc<{ availableBalance: number }>('wallet_summary', { p_user: user.id }),
      this.supabase.db.from('withdrawals').select('id', { count: 'exact', head: true }).eq('user_id', user.id).in('status', OPEN),
    ]);
    const q = withdrawalQuote(amount || 0, s.chargeBps);
    const available = Number(wallet.availableBalance);
    const windowOpen = isWindowOpen(s);
    const problems: string[] = [];
    if (!s.processingEnabled) problems.push('Withdrawals are temporarily paused');
    if (!windowOpen) problems.push(`Requests open on ${nextWindowStart(s)}`);
    if ((open.count ?? 0) > 0) problems.push('You already have a withdrawal in progress');
    if (q.gross > 0 && q.gross < s.minAmount) problems.push(`Minimum withdrawal is ₹${s.minAmount}`);
    if (q.gross > available) problems.push('Amount exceeds available balance');
    return {
      ...q,
      available,
      minAmount: s.minAmount,
      schedule: { mode: s.mode, weeklyDay: s.weeklyDay, monthlyDay: s.monthlyDay, windowDays: s.windowDays },
      windowOpen,
      nextWindowStart: nextWindowStart(s),
      canRequest: problems.length === 0 && q.gross > 0,
      problems,
    };
  }

  async request(user: AuthUser, dto: RequestWithdrawalDto) {
    const d = dto.details ?? {};
    const details =
      dto.method === 'upi'
        ? { upiId: d.upiId, accountName: d.accountName }
        : { accountName: d.accountName, accountNumber: d.accountNumber, ifsc: d.ifsc, bankName: d.bankName };
    const missing = dto.method === 'upi' ? !d.upiId : !(d.accountName && d.accountNumber && d.ifsc);
    if (missing) {
      throw toHttpError({ message: `PAYOUT_DETAILS_REQUIRED: ${dto.method === 'upi' ? 'UPI ID is' : 'Account name, number and IFSC are'} required` });
    }
    const row = await this.supabase.rpc('request_withdrawal', {
      p_user: user.id,
      p_amount: dto.amount,
      p_method: dto.method,
      p_details: details,
    });
    if (dto.saveDetails) {
      const { data } = await this.supabase.db.from('profiles').select('payout_details').eq('id', user.id).single();
      const qr = (data?.payout_details as Record<string, string> | null)?.upiQrPath;
      await this.supabase.db.from('profiles').update({ payout_details: { ...d, ...(qr ? { upiQrPath: qr } : {}) } }).eq('id', user.id);
    }
    return toCamel(row);
  }

  async mine(user: AuthUser, q: { page?: string; pageSize?: string }) {
    const { from, to, page, pageSize } = pageRange(q.page, q.pageSize);
    const { data, count, error } = await this.supabase.db
      .from('withdrawals')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('requested_at', { ascending: false })
      .range(from, to);
    if (error) throw toHttpError(error);
    return { items: toCamel(data), total: count ?? 0, page, pageSize };
  }

  async adminList(q: { status?: string; search?: string; from?: string; to?: string; page?: string; pageSize?: string }) {
    const { from, to, page, pageSize } = pageRange(q.page, q.pageSize);
    let query = this.supabase.db
      .from('withdrawals')
      .select('*, user:profiles!withdrawals_user_id_fkey(user_code, full_name, mobile)', { count: 'exact' })
      .order('requested_at', { ascending: false })
      .range(from, to);
    if (q.status === 'open') query = query.in('status', OPEN);
    else if (q.status) query = query.eq('status', q.status);
    if (q.from) query = query.gte('requested_at', q.from);
    if (q.to) query = query.lte('requested_at', `${q.to}T23:59:59.999+05:30`);
    if (q.search) query = query.in('user_id', await searchUserIds(this.supabase, q.search));
    const { data, count, error } = await query;
    if (error) throw toHttpError(error);
    return { items: toCamel(data), total: count ?? 0, page, pageSize };
  }

  async adminDetail(id: string) {
    const w = unwrap(
      await this.supabase.db
        .from('withdrawals')
        .select('*, user:profiles!withdrawals_user_id_fkey(id, user_code, full_name, mobile, email, status, payout_details)')
        .eq('id', id)
        .maybeSingle(),
    ) as { user_id: string; user?: { payout_details?: Record<string, string> | null } } | null;
    if (!w) throw new NotFoundException({ code: 'WITHDRAWAL_NOT_FOUND', message: 'Withdrawal not found' });
    const [events, ledger, wallet] = await Promise.all([
      this.supabase.db.from('withdrawal_events').select('*, actor:profiles!withdrawal_events_actor_id_fkey(user_code, full_name)')
        .eq('withdrawal_id', id).order('created_at').then(unwrap),
      this.supabase.db.from('wallet_ledger').select('*').eq('withdrawal_id', id).order('created_at').then(unwrap),
      this.supabase.rpc('wallet_summary', { p_user: w.user_id }),
    ]);
    const upiQrUrl = await this.uploads.signedUrl(w.user?.payout_details?.upiQrPath);
    return toCamel({ withdrawal: w, events, ledger, wallet, upiQrUrl });
  }

  async transition(id: string, dto: TransitionDto, actor: AuthUser) {
    return toCamel(
      await this.supabase.rpc('transition_withdrawal', {
        p_id: id,
        p_to: dto.status,
        p_actor: actor.id,
        p_note: dto.note ?? null,
        p_reference: dto.paymentReference ?? null,
      }),
    );
  }
}

@Controller()
export class WithdrawalsController {
  constructor(
    private readonly withdrawals: WithdrawalsService,
    private readonly payouts: PayoutsService,
  ) {}

  @Get('me/withdrawals/quote')
  quote(@CurrentUser() u: AuthUser, @Query('amount') amount: string) {
    return this.withdrawals.quote(u, Number(amount));
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('me/withdrawals')
  request(@CurrentUser() u: AuthUser, @Body() dto: RequestWithdrawalDto) {
    return this.withdrawals.request(u, dto);
  }

  @Get('me/withdrawals')
  mine(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.withdrawals.mine(u, q);
  }

  @Roles('admin')
  @Get('admin/withdrawals')
  adminList(@Query() q: Record<string, string>) {
    return this.withdrawals.adminList(q);
  }

  @Roles('admin')
  @Get('admin/payouts/status')
  payoutStatus() {
    return this.payouts.status();
  }

  @Roles('admin')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('admin/withdrawals/:id/payout')
  payout(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) {
    return this.payouts.initiate(id, u, ip);
  }

  @Roles('admin')
  @Post('admin/withdrawals/:id/payout/sync')
  syncPayout(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.sync(id);
  }

  @Roles('admin')
  @Get('admin/withdrawals/:id')
  adminDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.adminDetail(id);
  }

  @Roles('admin')
  @Patch('admin/withdrawals/:id')
  transition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionDto, @CurrentUser() u: AuthUser) {
    return this.withdrawals.transition(id, dto, u);
  }
}

@Module({
  imports: [SettingsModule],
  providers: [WithdrawalsService, PayoutsService, RazorpayService],
  controllers: [WithdrawalsController],
  exports: [PayoutsService],
})
export class WithdrawalsModule {}
