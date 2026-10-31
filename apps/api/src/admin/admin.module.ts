import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AuthCache, AuthUser, ClientIp, CurrentUser, Roles } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { searchUserIds, SupabaseService, toHttpError, unwrap } from '../common/supabase.service';
import { UploadsService } from '../common/uploads.service';
import { pageRange, toCamel, toCsv } from '../common/util';
import { LEDGER_COLUMNS } from '../wallet/wallet.module';

export class UserStatusDto {
  @IsIn(['active', 'suspended']) status: 'active' | 'suspended';
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const EXPORTS: Record<string, { table: string; select: string; date: string; columns: { key: string; label: string }[]; flatten: (r: any) => any }> = {
  users: {
    table: 'profiles',
    select: 'user_code, full_name, email, mobile, referral_code, status, role, created_at, package_activated_at, registration_ip, payout_details, sponsor:sponsor_id(user_code), active_package:packages!profiles_active_package_id_fkey(name)',
    date: 'created_at',
    columns: [
      { key: 'user_code', label: 'User ID' }, { key: 'full_name', label: 'Name' }, { key: 'email', label: 'Email' },
      { key: 'mobile', label: 'Mobile' }, { key: 'referral_code', label: 'Referral Code' }, { key: 'sponsor', label: 'Direct Referrer' },
      { key: 'package', label: 'Package' }, { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Joined' },
      { key: 'package_activated_at', label: 'Package Activated' }, { key: 'upi_id', label: 'UPI ID' },
      { key: 'account_name', label: 'Account Holder' }, { key: 'account_number', label: 'Account Number' },
      { key: 'ifsc', label: 'IFSC' }, { key: 'bank_name', label: 'Bank Name' }, { key: 'registration_ip', label: 'Registration IP' },
    ],
    flatten: (r) => ({
      ...r, sponsor: r.sponsor?.user_code, package: r.active_package?.name,
      upi_id: r.payout_details?.upiId, account_name: r.payout_details?.accountName, account_number: r.payout_details?.accountNumber,
      ifsc: r.payout_details?.ifsc, bank_name: r.payout_details?.bankName,
    }),
  },
  purchases: {
    table: 'purchases',
    select: 'id, type, amount, status, provider, provider_payment_id, manual_utr, manual_submitted_at, paid_at, created_at, commission_status, user:profiles!purchases_user_id_fkey(user_code, full_name), package:packages!purchases_package_id_fkey(name)',
    date: 'created_at',
    columns: [
      { key: 'id', label: 'Purchase ID' }, { key: 'user_code', label: 'User ID' }, { key: 'name', label: 'Name' },
      { key: 'package', label: 'Package' }, { key: 'type', label: 'Type' }, { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' }, { key: 'provider', label: 'Provider' }, { key: 'provider_payment_id', label: 'Payment Ref' },
      { key: 'manual_utr', label: 'Manual UTR' }, { key: 'manual_submitted_at', label: 'Screenshot Submitted' },
      { key: 'commission_status', label: 'Commission' }, { key: 'paid_at', label: 'Paid At' },
    ],
    flatten: (r) => ({ ...r, user_code: r.user?.user_code, name: r.user?.full_name, package: r.package?.name }),
  },
  commissions: {
    table: 'commissions',
    select: 'purchase_id, level, amount, rate_bps, base_amount, calculation, status, skip_reason, created_at, beneficiary:profiles!commissions_beneficiary_id_fkey(user_code, full_name), source:profiles!commissions_source_user_id_fkey(user_code)',
    date: 'created_at',
    columns: [
      { key: 'purchase_id', label: 'Purchase ID' }, { key: 'source', label: 'Purchaser' }, { key: 'beneficiary', label: 'Beneficiary' },
      { key: 'level_label', label: 'Level' }, { key: 'amount', label: 'Amount' }, { key: 'calculation', label: 'Calculation' },
      { key: 'status', label: 'Status' }, { key: 'skip_reason', label: 'Skip Reason' }, { key: 'created_at', label: 'Date' },
    ],
    flatten: (r) => ({
      ...r, source: r.source?.user_code, beneficiary: `${r.beneficiary?.user_code} ${r.beneficiary?.full_name}`,
      level_label: r.level === 0 ? 'Direct' : r.level <= 3 ? `Generation ${r.level}` : `Turnover (Generation ${r.level})`,
    }),
  },
  withdrawals: {
    table: 'withdrawals',
    select: 'id, gross_amount, charge_amount, net_amount, method, payout_details, status, payment_reference, admin_note, requested_at, paid_at, user:profiles!withdrawals_user_id_fkey(user_code, full_name, mobile)',
    date: 'requested_at',
    columns: [
      { key: 'id', label: 'Withdrawal ID' }, { key: 'user_code', label: 'User ID' }, { key: 'name', label: 'Name' },
      { key: 'mobile', label: 'Mobile' }, { key: 'gross_amount', label: 'Gross' }, { key: 'charge_amount', label: 'Platform Charge' },
      { key: 'net_amount', label: 'Net Payable' }, { key: 'method', label: 'Method' }, { key: 'payout', label: 'Payout Details' },
      { key: 'status', label: 'Status' }, { key: 'payment_reference', label: 'Payment Ref' }, { key: 'requested_at', label: 'Requested' },
      { key: 'paid_at', label: 'Paid' },
    ],
    flatten: (r) => ({
      ...r, user_code: r.user?.user_code, name: r.user?.full_name, mobile: r.user?.mobile,
      payout: r.payout_details?.upiId ?? [r.payout_details?.accountName, r.payout_details?.accountNumber, r.payout_details?.ifsc].filter(Boolean).join(' / '),
    }),
  },
  ledger: {
    table: 'wallet_ledger',
    select: 'txn_id, created_at, type, description, amount, balance_after, user:profiles!wallet_ledger_user_id_fkey(user_code)',
    date: 'created_at',
    columns: [{ key: 'user_code', label: 'User ID' }, ...LEDGER_COLUMNS],
    flatten: (r) => ({ ...r, user_code: r.user?.user_code }),
  },
};

@Injectable()
export class AdminService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly cache: AuthCache,
    private readonly uploads: UploadsService,
  ) {}

  dashboard() {
    return this.supabase.rpc('admin_dashboard');
  }

  async reports(period: string, from?: string, to?: string) {
    if (!['day', 'week', 'month'].includes(period)) throw new BadRequestException({ code: 'INVALID_PERIOD', message: 'period must be day, week or month' });
    const end = to || today();
    const span = { day: 29, week: 7 * 11, month: 31 * 11 }[period as 'day'];
    const start = from || new Date(Date.parse(end) - span * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.supabase.rpc<Record<string, unknown>[]>('admin_report', { p_period: period, p_from: start, p_to: end });
    return { period, from: start, to: end, rows: toCamel(rows) };
  }

  async users(q: { search?: string; status?: string; packageId?: string; page?: string; pageSize?: string }) {
    const { from, to, page, pageSize } = pageRange(q.page, q.pageSize);
    let query = this.supabase.db
      .from('profiles')
      .select(
        'id, user_code, full_name, email, mobile, referral_code, role, status, created_at, payout_details, ' +
          'active_package:packages!profiles_active_package_id_fkey(name, level), sponsor:sponsor_id(user_code, full_name)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, to);
    if (q.status) query = query.eq('status', q.status);
    if (q.packageId === 'none') query = query.is('active_package_id', null);
    else if (q.packageId) query = query.eq('active_package_id', q.packageId);
    if (q.search) query = query.in('id', await searchUserIds(this.supabase, q.search));
    const { data, count, error } = await query;
    if (error) throw toHttpError(error);
    return { items: toCamel(data), total: count ?? 0, page, pageSize };
  }

  async user(id: string) {
    const profile = unwrap(
      await this.supabase.db
        .from('profiles')
        .select(
          '*, active_package:packages!profiles_active_package_id_fkey(name, level, max_generations), sponsor:sponsor_id(id, user_code, full_name)',
        )
        .eq('id', id)
        .maybeSingle(),
    );
    if (!profile) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    const [wallet, team, purchases, withdrawals, authUser] = await Promise.all([
      this.supabase.rpc('wallet_summary', { p_user: id }),
      this.supabase.rpc('team_summary', { p_user: id }),
      this.supabase.db.from('purchases')
        .select('*, package:packages!purchases_package_id_fkey(name), from_package:packages!purchases_from_package_id_fkey(name)')
        .eq('user_id', id).order('created_at', { ascending: false }).then(unwrap),
      this.supabase.db.from('withdrawals').select('*').eq('user_id', id).order('requested_at', { ascending: false }).limit(20).then(unwrap),
      this.supabase.db.auth.admin.getUserById(id).then((r) => r.data?.user ?? null, () => null),
    ]);
    const { ancestors: _a, ...rest } = profile as Record<string, unknown> & { payout_details?: Record<string, string> | null };
    const withProof = await Promise.all(
      (purchases as { manual_proof_path: string | null }[]).map(async (p) => ({ ...p, proof_url: await this.uploads.signedUrl(p.manual_proof_path) })),
    );
    return {
      profile: toCamel({
        ...rest,
        upi_qr_url: await this.uploads.signedUrl(rest.payout_details?.upiQrPath),
        last_sign_in_at: authUser?.last_sign_in_at ?? null,
        email_confirmed_at: authUser?.email_confirmed_at ?? null,
      }),
      wallet, team, purchases: toCamel(withProof), withdrawals: toCamel(withdrawals),
    };
  }

  async setStatus(id: string, dto: UserStatusDto, actor: AuthUser, ip: string | null) {
    if (id === actor.id) throw new BadRequestException({ code: 'SELF_ACTION', message: 'You cannot change your own status' });
    const before = unwrap(await this.supabase.db.from('profiles').select('id, user_code, status').eq('id', id).maybeSingle());
    if (!before) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    const after = unwrap(await this.supabase.db.from('profiles').update({ status: dto.status }).eq('id', id).select('id, user_code, status').single());
    this.cache.invalidateUser(id);
    await this.audit.log({
      actorId: actor.id, action: dto.status === 'suspended' ? 'user.suspend' : 'user.reactivate',
      entity: 'profile', entityId: id, before, after: { ...after, reason: dto.reason }, ip,
    });
    return toCamel(after);
  }

  async fraudAlerts(q: { resolved?: string; page?: string; pageSize?: string }) {
    const { from, to, page, pageSize } = pageRange(q.page, q.pageSize);
    let query = this.supabase.db
      .from('fraud_alerts')
      .select('*, user:profiles!fraud_alerts_user_id_fkey(id, user_code, full_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    query = q.resolved === 'true' ? query.not('resolved_at', 'is', null) : query.is('resolved_at', null);
    const { data, count, error } = await query;
    if (error) throw toHttpError(error);
    return { items: toCamel(data), total: count ?? 0, page, pageSize };
  }

  async resolveAlert(id: string, actor: AuthUser, ip: string | null) {
    const row = unwrap(
      await this.supabase.db.from('fraud_alerts').update({ resolved_at: new Date().toISOString(), resolved_by: actor.id }).eq('id', id).select().single(),
    );
    await this.audit.log({ actorId: actor.id, action: 'fraud_alert.resolve', entity: 'fraud_alert', entityId: id, after: row, ip });
    return toCamel(row);
  }

  async auditLogs(q: { action?: string; search?: string; page?: string; pageSize?: string }) {
    const { from, to, page, pageSize } = pageRange(q.page, q.pageSize);
    let query = this.supabase.db
      .from('audit_logs')
      .select('*, actor:profiles!audit_logs_actor_id_fkey(user_code, full_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (q.action) query = query.ilike('action', `${q.action.replace(/[%*]/g, '')}%`);
    if (q.search) query = query.in('actor_id', await searchUserIds(this.supabase, q.search));
    const { data, count, error } = await query;
    if (error) throw toHttpError(error);
    return { items: toCamel(data), total: count ?? 0, page, pageSize };
  }

  async exportCsv(report: string, q: { from?: string; to?: string; status?: string }, actor: AuthUser, ip: string | null) {
    const def = EXPORTS[report];
    if (!def) throw new NotFoundException({ code: 'UNKNOWN_REPORT', message: `Unknown report ${report}` });
    let query = this.supabase.db.from(def.table).select(def.select).order(def.date, { ascending: false }).limit(50000);
    if (q.from) query = query.gte(def.date, q.from);
    if (q.to) query = query.lte(def.date, `${q.to}T23:59:59.999+05:30`);
    if (q.status) query = query.eq('status', q.status);
    const { data, error } = await query;
    if (error) throw toHttpError(error);
    await this.audit.log({ actorId: actor.id, action: `export.${report}`, entity: 'export', entityId: report, after: { ...q, rows: data?.length ?? 0 }, ip });
    return toCsv((data ?? []).map(def.flatten), def.columns);
  }
}

@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('reports')
  reports(@Query('period') period = 'day', @Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.reports(period, from, to);
  }

  @Get('users')
  users(@Query() q: Record<string, string>) {
    return this.admin.users(q);
  }

  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.user(id);
  }

  @Patch('users/:id/status')
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UserStatusDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) {
    return this.admin.setStatus(id, dto, u, ip);
  }

  @Get('fraud-alerts')
  fraud(@Query() q: Record<string, string>) {
    return this.admin.fraudAlerts(q);
  }

  @HttpCode(200)
  @Post('fraud-alerts/:id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) {
    return this.admin.resolveAlert(id, u, ip);
  }

  @Get('audit-logs')
  audit(@Query() q: Record<string, string>) {
    return this.admin.auditLogs(q);
  }

  @Get('export/:report')
  async export(
    @Param('report') report: string,
    @Query() q: Record<string, string>,
    @CurrentUser() u: AuthUser,
    @ClientIp() ip: string | null,
    @Res() res: Response,
  ) {
    const csv = await this.admin.exportCsv(report.replace(/\.csv$/, ''), q, u, ip);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="skillsearn-${report.replace(/\.csv$/, '')}-${today()}.csv"`);
    res.send(csv);
  }
}

@Module({ providers: [AdminService], controllers: [AdminController] })
export class AdminModule {}
