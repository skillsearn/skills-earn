import { Body, Controller, Get, Header, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsNumber, IsString, MaxLength, MinLength, NotEquals } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { searchUserIds, SupabaseService, toHttpError, unwrap } from '../common/supabase.service';
import { pageRange, toCamel, toCsv } from '../common/util';
import { SettingsModule, SettingsService } from '../settings/settings.module';

export class AdjustDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @NotEquals(0) amount: number;
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

export interface LedgerQuery {
  type?: string;
  from?: string;
  to?: string;
  page?: string;
  pageSize?: string;
  userId?: string;
  search?: string;
}

export const LEDGER_COLUMNS = [
  { key: 'txn_id', label: 'Transaction ID' },
  { key: 'created_at', label: 'Date' },
  { key: 'type', label: 'Type' },
  { key: 'description', label: 'Description' },
  { key: 'amount', label: 'Amount (INR)' },
  { key: 'balance_after', label: 'Balance (INR)' },
];

@Injectable()
export class WalletService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: SettingsService,
  ) {}

  summary(userId: string) {
    return this.supabase.rpc<Record<string, number>>('wallet_summary', { p_user: userId });
  }

  async dashboard(user: AuthUser) {
    const [wallet, team, settings, profile, notifications] = await Promise.all([
      this.summary(user.id),
      this.supabase.rpc('team_summary', { p_user: user.id }),
      this.settings.publicView(),
      this.supabase.db
        .from('profiles')
        .select('user_code, full_name, referral_code, status, package_activated_at, active_package:packages!profiles_active_package_id_fkey(name, level, max_generations)')
        .eq('id', user.id)
        .single()
        .then(unwrap),
      this.supabase.db.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5).then(unwrap),
    ]);
    const { data: pending } = await this.supabase.db
      .from('purchases').select('id, type, amount, package:packages!purchases_package_id_fkey(name)')
      .eq('user_id', user.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1);
    return toCamel({
      profile,
      wallet,
      team,
      withdrawal: settings.withdrawal,
      notifications,
      pendingPurchase: pending?.[0] ?? null,
    });
  }

  private ledgerQuery(q: LedgerQuery, userIds?: string[] | null) {
    let query = this.supabase.db
      .from('wallet_ledger')
      .select('*, user:profiles!wallet_ledger_user_id_fkey(user_code, full_name)', { count: 'exact' })
      .order('created_at', { ascending: false });
    if (userIds) query = query.in('user_id', userIds);
    if (q.type) query = query.eq('type', q.type);
    if (q.from) query = query.gte('created_at', q.from);
    if (q.to) query = query.lte('created_at', `${q.to}T23:59:59.999+05:30`);
    return query;
  }

  async ledger(q: LedgerQuery, userIds?: string[] | null) {
    const { from, to, page, pageSize } = pageRange(q.page, q.pageSize);
    const { data, count, error } = await this.ledgerQuery(q, userIds).range(from, to);
    if (error) throw toHttpError(error);
    return { items: toCamel(data), total: count ?? 0, page, pageSize };
  }

  async statementCsv(userId: string, q: LedgerQuery) {
    const { data, error } = await this.ledgerQuery(q, [userId]).limit(10000);
    if (error) throw toHttpError(error);
    return toCsv(data ?? [], LEDGER_COLUMNS);
  }

  async commissions(q: { level?: string; status?: string; page?: string; pageSize?: string; purchaseId?: string }, beneficiaryIds?: string[] | null) {
    const { from, to, page, pageSize } = pageRange(q.page, q.pageSize);
    let query = this.supabase.db
      .from('commissions')
      .select(
        '*, source:profiles!commissions_source_user_id_fkey(user_code, full_name), ' +
          'beneficiary:profiles!commissions_beneficiary_id_fkey(user_code, full_name), ' +
          'purchase:purchases!commissions_purchase_id_fkey(type, amount, package:packages!purchases_package_id_fkey(name))',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .order('level')
      .range(from, to);
    if (beneficiaryIds) query = query.in('beneficiary_id', beneficiaryIds);
    // 'turnover' = every generation from 4 onwards
    if (q.level === 'turnover') query = query.gte('level', 4);
    else if (q.level !== undefined && q.level !== '') query = query.eq('level', Number(q.level));
    if (q.status) query = query.eq('status', q.status);
    if (q.purchaseId) query = query.eq('purchase_id', q.purchaseId);
    const { data, count, error } = await query;
    if (error) throw toHttpError(error);
    return { items: toCamel(data), total: count ?? 0, page, pageSize };
  }

  async adjust(userId: string, dto: AdjustDto, actor: AuthUser) {
    return toCamel(
      await this.supabase.rpc('admin_adjust_wallet', { p_user: userId, p_amount: dto.amount, p_reason: dto.reason, p_actor: actor.id }),
    );
  }

  async release() {
    return { released: await this.supabase.rpc<number>('release_pending_commissions') };
  }
}

@Controller()
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('me/dashboard')
  dashboard(@CurrentUser() u: AuthUser) {
    return this.wallet.dashboard(u);
  }

  @Get('me/wallet/summary')
  summary(@CurrentUser() u: AuthUser) {
    return this.wallet.summary(u.id);
  }

  @Get('me/wallet/ledger')
  ledger(@CurrentUser() u: AuthUser, @Query() q: LedgerQuery) {
    return this.wallet.ledger(q, [u.id]);
  }

  @Get('me/commissions')
  commissions(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.wallet.commissions(q, [u.id]);
  }

  @Get('me/statement.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="skillsearn-statement.csv"')
  statement(@CurrentUser() u: AuthUser, @Query() q: LedgerQuery) {
    return this.wallet.statementCsv(u.id, q);
  }

  @Roles('admin')
  @Get('admin/ledger')
  async adminLedger(@Query() q: LedgerQuery) {
    const ids = q.userId ? [q.userId] : q.search ? await searchUserIds(this.supabase, q.search) : null;
    return this.wallet.ledger(q, ids);
  }

  @Roles('admin')
  @Get('admin/commissions')
  async adminCommissions(@Query() q: Record<string, string>) {
    const ids = q.userId ? [q.userId] : q.search ? await searchUserIds(this.supabase, q.search) : null;
    return this.wallet.commissions(q, ids);
  }

  @Roles('admin')
  @HttpCode(200)
  @Post('admin/commissions/release')
  release() {
    return this.wallet.release();
  }

  @Roles('admin')
  @HttpCode(200)
  @Post('admin/users/:id/adjust')
  adjust(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustDto, @CurrentUser() u: AuthUser) {
    return this.wallet.adjust(id, dto, u);
  }
}

@Module({
  imports: [SettingsModule],
  providers: [WalletService],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
