import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Session } from '@supabase/supabase-js';
import { AllowSuspended, AuthCache, AuthedRequest, AuthUser, ClientIp, CurrentUser, Public } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { Env } from '../common/env';
import { SupabaseService, toHttpError, unwrap } from '../common/supabase.service';
import { UploadsService } from '../common/uploads.service';
import { normalizeMobile, toCamel } from '../common/util';
import { Req } from '@nestjs/common';

export class RegisterDto {
  @IsString() @MinLength(2) @MaxLength(80) fullName: string;
  @IsEmail() @MaxLength(120) email: string;
  @IsString() @MaxLength(20) mobile: string;
  @IsString() @MinLength(8) @MaxLength(72) password: string;
  @IsUUID() packageId: string;
  @IsOptional() @IsString() @MaxLength(20) referralCode?: string;
  @IsBoolean() @Equals(true, { message: 'You must accept the Terms & Conditions' }) acceptTerms: boolean;
}

export class LoginDto {
  @IsString() @MinLength(3) @MaxLength(120) identifier: string; // user id, email or mobile
  @IsString() @MinLength(1) @MaxLength(72) password: string;
}

export class ForgotPasswordDto {
  @IsString() @MinLength(3) @MaxLength(120) identifier: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(1) currentPassword: string;
  @IsString() @MinLength(8) @MaxLength(72) newPassword: string;
}

export class PayoutDetailsDto {
  @IsOptional() @IsString() @Matches(/^[\w.\-]{2,}@[a-zA-Z]{2,}$/, { message: 'Invalid UPI ID' }) upiId?: string;
  @IsOptional() @IsString() @MaxLength(80) accountName?: string;
  @IsOptional() @IsString() @Matches(/^\d{6,18}$/, { message: 'Invalid account number' }) accountNumber?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'Invalid IFSC' }) ifsc?: string;
  @IsOptional() @IsString() @MaxLength(80) bankName?: string;
}

export class PayoutQrDto {
  @IsString() @MaxLength(8_000_000) image: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) fullName?: string;
  @IsOptional() @ValidateNested() @Type(() => PayoutDetailsDto) payoutDetails?: PayoutDetailsDto;
}

function presentSession(s: Session) {
  return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly cache: AuthCache,
    private readonly config: ConfigService<Env, true>,
    private readonly uploads: UploadsService,
  ) {}

  referralLink(code: string) {
    return `${this.config.get('SITE_URL')}/register?ref=${code}`;
  }

  async register(dto: RegisterDto, ip: string | null) {
    const mobile = normalizeMobile(dto.mobile);
    if (!mobile) throw new BadRequestException({ code: 'INVALID_MOBILE', message: 'Enter a valid 10-digit mobile number' });
    const email = dto.email.trim().toLowerCase();

    const pkg = unwrap(await this.supabase.db.from('packages').select('id, price, is_active').eq('id', dto.packageId).maybeSingle());
    if (!pkg?.is_active) throw new BadRequestException({ code: 'INVALID_PACKAGE', message: 'Selected package is not available' });

    const { data: clash } = await this.supabase.db
      .from('profiles')
      .select('email, mobile')
      .or(`email.eq."${email}",mobile.eq."${mobile}"`)
      .limit(1);
    if (clash?.length) {
      throw new ConflictException({
        code: 'ALREADY_REGISTERED',
        message: clash[0].email === email ? 'Email is already registered' : 'Mobile number is already registered',
      });
    }

    const created = await this.supabase.db.auth.admin.createUser({
      email,
      password: dto.password,
      email_confirm: true,
      user_metadata: { full_name: dto.fullName },
    });
    if (created.error || !created.data.user) {
      const msg = created.error?.message ?? 'Could not create account';
      throw new BadRequestException({ code: /already/i.test(msg) ? 'ALREADY_REGISTERED' : 'SIGNUP_FAILED', message: msg });
    }
    const userId = created.data.user.id;

    try {
      await this.supabase.rpc('create_profile', {
        p_id: userId,
        p_full_name: dto.fullName,
        p_email: email,
        p_mobile: mobile,
        p_sponsor_code: dto.referralCode?.trim() || null,
        p_ip: ip,
      });
    } catch (err) {
      await this.supabase.db.auth.admin.deleteUser(userId).catch(() => undefined);
      throw err;
    }

    const purchase = unwrap(
      await this.supabase.db
        .from('purchases')
        .insert({ user_id: userId, package_id: pkg.id, type: 'new', amount: pkg.price, commission_base: pkg.price })
        .select('id')
        .single(),
    );

    const { data, error } = await this.supabase.anon().auth.signInWithPassword({ email, password: dto.password });
    if (error || !data.session) throw new UnauthorizedException({ code: 'LOGIN_FAILED', message: 'Account created, please log in' });

    return { session: presentSession(data.session), purchaseId: purchase.id, profile: await this.me(userId) };
  }

  /** Accepts User ID (SE100001), email or mobile. */
  private async resolveEmail(identifier: string): Promise<{ email: string; id: string; role: string; status: string } | null> {
    const id = identifier.trim();
    let q = this.supabase.db.from('profiles').select('id, email, role, status');
    if (id.includes('@')) q = q.eq('email', id.toLowerCase());
    else if (/^SE\d+$/i.test(id)) q = q.eq('user_code', id.toUpperCase());
    else {
      const m = normalizeMobile(id);
      if (!m) return null;
      q = q.eq('mobile', m);
    }
    const { data } = await q.maybeSingle();
    return data;
  }

  async login(dto: LoginDto, ip: string | null) {
    const profile = await this.resolveEmail(dto.identifier);
    const invalid = new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    if (!profile) throw invalid;

    const { data, error } = await this.supabase.anon().auth.signInWithPassword({ email: profile.email, password: dto.password });
    if (error || !data.session) {
      if (profile.role === 'admin') {
        await this.audit.log({ actorId: profile.id, action: 'security.admin_login_failed', entity: 'profile', entityId: profile.id, ip });
      }
      throw invalid;
    }
    if (profile.status === 'suspended') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Your account is suspended. Contact support.' });
    }
    if (profile.role === 'admin') {
      await this.audit.log({ actorId: profile.id, action: 'security.admin_login', entity: 'profile', entityId: profile.id, ip });
    }
    return { session: presentSession(data.session), profile: await this.me(profile.id) };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const profile = await this.resolveEmail(dto.identifier);
    if (profile) {
      const { error } = await this.supabase.anon().auth.resetPasswordForEmail(profile.email, {
        redirectTo: `${this.config.get('SITE_URL')}/reset-password`,
      });
      if (error) this.logger.warn(`reset email failed: ${error.message}`);
    }
    // Same response either way so accounts can't be enumerated.
    return { ok: true, message: 'If the account exists, a reset link has been sent to the registered email.' };
  }

  async me(userId: string) {
    const p = unwrap(
      await this.supabase.db
        .from('profiles')
        .select(
          'id, user_code, full_name, email, mobile, referral_code, role, status, package_activated_at, payout_details, created_at, ' +
            'active_package:packages!profiles_active_package_id_fkey(id, name, slug, level, price, max_generations, direct_rate_bps), ' +
            'sponsor:sponsor_id(user_code, full_name)',
        )
        .eq('id', userId)
        .single(),
    ) as unknown as Record<string, unknown> & { referral_code: string; payout_details: Record<string, string> | null };
    const upiQrUrl = await this.uploads.signedUrl(p.payout_details?.upiQrPath);
    return { ...toCamel<Record<string, unknown>>(p), upiQrUrl, referralLink: this.referralLink(p.referral_code) };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto, ip: string | null) {
    const check = await this.supabase.anon().auth.signInWithPassword({ email: user.email, password: dto.currentPassword });
    if (check.error) throw new BadRequestException({ code: 'WRONG_PASSWORD', message: 'Current password is incorrect' });
    const { error } = await this.supabase.db.auth.admin.updateUserById(user.id, { password: dto.newPassword });
    if (error) throw toHttpError(error);
    await this.audit.log({ actorId: user.id, action: 'security.password_changed', entity: 'profile', entityId: user.id, ip });
    return { ok: true };
  }

  async logout(token: string) {
    this.cache.invalidateToken(token);
    await this.supabase.db.auth.admin.signOut(token).catch(() => undefined);
    return { ok: true };
  }

  async updateProfile(user: AuthUser, dto: UpdateProfileDto) {
    const patch: Record<string, unknown> = {};
    if (dto.fullName) patch.full_name = dto.fullName.trim();
    if (dto.payoutDetails) {
      // Keep the uploaded QR (not part of the editable form).
      const { data } = await this.supabase.db.from('profiles').select('payout_details').eq('id', user.id).single();
      const qr = (data?.payout_details as Record<string, string> | null)?.upiQrPath;
      patch.payout_details = { ...dto.payoutDetails, ...(qr ? { upiQrPath: qr } : {}) };
    }
    if (Object.keys(patch).length) {
      unwrap(await this.supabase.db.from('profiles').update(patch).eq('id', user.id));
      this.cache.invalidateUser(user.id);
    }
    return this.me(user.id);
  }

  async uploadPayoutQr(user: AuthUser, image: string) {
    const path = await this.uploads.uploadImage(`upi-qr/${user.id}`, image);
    const { data } = await this.supabase.db.from('profiles').select('payout_details').eq('id', user.id).single();
    const current = (data?.payout_details as Record<string, string> | null) ?? {};
    unwrap(await this.supabase.db.from('profiles').update({ payout_details: { ...current, upiQrPath: path } }).eq('id', user.id));
    this.cache.invalidateUser(user.id);
    return this.me(user.id);
  }
}

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/register')
  register(@Body() dto: RegisterDto, @ClientIp() ip: string | null) {
    return this.auth.register(dto, ip);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('auth/login')
  login(@Body() dto: LoginDto, @ClientIp() ip: string | null) {
    return this.auth.login(dto, ip);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('auth/forgot-password')
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @AllowSuspended()
  @Get('auth/me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('auth/change-password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @ClientIp() ip: string | null) {
    return this.auth.changePassword(user, dto, ip);
  }

  @AllowSuspended()
  @HttpCode(200)
  @Post('auth/logout')
  logout(@Req() req: AuthedRequest) {
    return this.auth.logout(req.token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('me/payout-qr')
  uploadPayoutQr(@CurrentUser() user: AuthUser, @Body() dto: PayoutQrDto) {
    return this.auth.uploadPayoutQr(user, dto.image);
  }

  @Patch('me/profile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user, dto);
  }
}

@Module({ providers: [AuthService], controllers: [AuthController], exports: [AuthService] })
export class AuthModule {}
