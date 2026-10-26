import { Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';
import { Env } from '../common/env';
import { SupabaseService, unwrap } from '../common/supabase.service';
import { pageRange, toCamel } from '../common/util';
import { SettingsModule, SettingsService } from '../settings/settings.module';

interface DownlineRow {
  total_count: number;
  [k: string]: unknown;
}

@Injectable()
export class ReferralsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService<Env, true>,
    private readonly settings: SettingsService,
  ) {}

  /** Levels a member earns from: L1 pays direct, L(n+1) pays generation n. */
  async earningDepth() {
    const c = await this.settings.get('commission');
    return (c.maxGenerations ?? 3) + 1;
  }

  async validate(code: string) {
    const { data } = await this.supabase.db
      .from('profiles')
      .select('user_code, full_name, status')
      .eq('referral_code', code.trim().toUpperCase())
      .maybeSingle();
    if (!data || data.status !== 'active') return { valid: false };
    // Expose only first name + user id to the public.
    return { valid: true, userCode: data.user_code, name: String(data.full_name).split(' ')[0] };
  }

  async summary(user: AuthUser) {
    const [team, prof] = await Promise.all([
      this.supabase.rpc('team_summary', { p_user: user.id }),
      this.supabase.db.from('profiles').select('referral_code').eq('id', user.id).single().then(unwrap),
    ]);
    return {
      ...(team as object),
      referralCode: prof.referral_code,
      referralLink: `${this.config.get('SITE_URL')}/register?ref=${prof.referral_code}`,
    };
  }

  async downline(userId: string, q: { depth?: string; search?: string; page?: string; pageSize?: string }, maxDepth: number) {
    const { from, page, pageSize } = pageRange(q.page, q.pageSize);
    const rows = await this.supabase.rpc<DownlineRow[]>('get_downline', {
      p_user: userId,
      p_max_depth: maxDepth,
      p_depth: q.depth ? Number(q.depth) : null,
      p_search: q.search?.trim() || null,
      p_limit: pageSize,
      p_offset: from,
    });
    return {
      items: toCamel(rows.map(({ total_count, ...r }) => r)),
      total: Number(rows[0]?.total_count ?? 0),
      page,
      pageSize,
    };
  }

  /** Admin hierarchy viewer: upline chain (nearest first) + downline stats. */
  async hierarchy(userId: string) {
    const me = unwrap(
      await this.supabase.db.from('profiles').select('id, user_code, full_name, ancestors').eq('id', userId).maybeSingle(),
    ) as { id: string; ancestors: string[] } | null;
    if (!me) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    const uplineRows = me.ancestors.length
      ? unwrap(
          await this.supabase.db
            .from('profiles')
            .select('id, user_code, full_name, status, active_package:packages!profiles_active_package_id_fkey(name, max_generations)')
            .in('id', me.ancestors),
        )
      : [];
    const byId = new Map((uplineRows as { id: string }[]).map((r) => [r.id, r]));
    const depth = await this.earningDepth();
    const upline = me.ancestors.map((id, i) => ({
      ...toCamel<object>(byId.get(id)),
      position: i + 1,
      role: i === 0 ? 'Direct Referrer (sponsor)' : i < depth ? `Generation ${i}` : `Upline ${i + 1}`,
    }));
    const team = await this.supabase.rpc('team_summary', { p_user: userId });
    return { upline, team };
  }
}

@Controller()
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('referrals/validate/:code')
  validate(@Param('code') code: string) {
    return this.referrals.validate(code);
  }

  @Get('me/team/summary')
  summary(@CurrentUser() u: AuthUser) {
    return this.referrals.summary(u);
  }

  /** Members down to the earning depth: L1 pays direct, L2… pay generation 1… */
  @Get('me/team')
  async team(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.referrals.downline(u.id, q, await this.referrals.earningDepth());
  }

  @Roles('admin')
  @Get('admin/users/:id/hierarchy')
  hierarchy(@Param('id', ParseUUIDPipe) id: string) {
    return this.referrals.hierarchy(id);
  }

  @Roles('admin')
  @Get('admin/users/:id/downline')
  adminDownline(@Param('id', ParseUUIDPipe) id: string, @Query() q: Record<string, string>) {
    return this.referrals.downline(id, q, 50);
  }
}

@Module({ imports: [SettingsModule], providers: [ReferralsService], controllers: [ReferralsController] })
export class ReferralsModule {}
