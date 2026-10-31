import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Module, Param, Post, Put } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, validateSync } from 'class-validator';
import { AuthUser, ClientIp, CurrentUser, Public, Roles } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { SupabaseService, unwrap } from '../common/supabase.service';
import { UploadsService } from '../common/uploads.service';
import { isWindowOpen, nextWindowStart, WithdrawalSettings } from '../common/util';

export class WithdrawalSettingsDto implements WithdrawalSettings {
  @IsIn(['weekly', 'monthly']) mode: 'weekly' | 'monthly';
  @IsInt() @Min(0) @Max(6) weeklyDay: number;
  @IsInt() @Min(1) @Max(28) monthlyDay: number;
  @IsInt() @Min(1) @Max(28) windowDays: number;
  @IsNumber() @Min(0) minAmount: number;
  @IsInt() @Min(0) @Max(5000) chargeBps: number;
  @IsBoolean() processingEnabled: boolean;
  @IsBoolean() manualPayoutConfirmation: boolean;
}

export class UpgradeSettingsDto {
  @IsInt() @Min(0) @Max(3650) windowDays: number; // 0 = no deadline
  @IsBoolean() commissionable: boolean;
  @IsInt() @Min(0) @Max(10000) commissionBaseBps: number;
}

export class CommissionSettingsDto {
  @IsInt() @Min(0) @Max(365) holdDays: number;
  @IsBoolean() directRequiresActivePackage: boolean;
  @IsInt() @Min(3) @Max(100) maxGenerations: number; // generations above the direct referrer that are calculated (G4+ = turnover income)
}

export class RegistrationSettingsDto {
  @IsBoolean() referralRequired: boolean;
}

/** Where members send manual (non-gateway) payments. The QR image is uploaded separately (qrPath). */
export class ManualPaymentSettingsDto {
  @IsBoolean() enabled: boolean;
  @IsOptional() @IsString() @Matches(/^$|^[\w.\-]{2,}@[a-zA-Z]{2,}$/, { message: 'Invalid UPI ID' }) upiId?: string;
  @IsOptional() @IsString() @MaxLength(80) payeeName?: string;
  @IsOptional() @IsString() @MaxLength(80) bankName?: string;
  @IsOptional() @IsString() @MaxLength(80) accountName?: string;
  @IsOptional() @IsString() @Matches(/^$|^\d{6,18}$/, { message: 'Invalid account number' }) accountNumber?: string;
  @IsOptional() @IsString() @Matches(/^$|^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'Invalid IFSC' }) ifsc?: string;
  @IsOptional() @IsString() @MaxLength(1000) instructions?: string;
}

export class QrUploadDto {
  @IsString() @MaxLength(8_000_000) image: string;
}

export interface ManualPaymentSettings extends ManualPaymentSettingsDto {
  qrPath?: string;
}

const SCHEMAS = {
  withdrawal: WithdrawalSettingsDto,
  upgrade: UpgradeSettingsDto,
  commission: CommissionSettingsDto,
  registration: RegistrationSettingsDto,
  manualPayment: ManualPaymentSettingsDto,
} as const;
export type SettingKey = keyof typeof SCHEMAS;

export interface AllSettings {
  withdrawal: WithdrawalSettingsDto;
  upgrade: UpgradeSettingsDto;
  commission: CommissionSettingsDto;
  registration: RegistrationSettingsDto;
  manualPayment: ManualPaymentSettings;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
  ) {}

  async all(): Promise<AllSettings> {
    const rows = unwrap(await this.supabase.db.from('app_settings').select('key, value'));
    return Object.fromEntries(rows.map((r: { key: string; value: unknown }) => [r.key, r.value])) as unknown as AllSettings;
  }

  async get<K extends SettingKey>(key: K): Promise<AllSettings[K]> {
    const row = unwrap(await this.supabase.db.from('app_settings').select('value').eq('key', key).single());
    return row.value as AllSettings[K];
  }

  async update(key: string, value: unknown, actor: AuthUser, ip: string | null) {
    const schema = SCHEMAS[key as SettingKey];
    if (!schema) throw new BadRequestException({ code: 'UNKNOWN_SETTING', message: `Unknown setting ${key}` });
    const dto = plainToInstance(schema as new () => object, value);
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      throw new BadRequestException({
        code: 'VALIDATION',
        message: errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; '),
      });
    }
    const before = await this.get(key as SettingKey);
    const clean: Record<string, unknown> = { ...dto };
    // The QR image path is only changed through uploadManualQr().
    if (key === 'manualPayment') clean.qrPath = (before as ManualPaymentSettings | null)?.qrPath ?? '';
    unwrap(
      await this.supabase.db
        .from('app_settings')
        .update({ value: clean, updated_at: new Date().toISOString(), updated_by: actor.id })
        .eq('key', key),
    );
    await this.audit.log({ actorId: actor.id, action: `settings.${key}.update`, entity: 'settings', entityId: key, before, after: clean, ip });
    return clean;
  }

  /** Manual payment details with a signed QR URL (members see this at checkout). */
  async manualPayment() {
    const { data } = await this.supabase.db.from('app_settings').select('value').eq('key', 'manualPayment').maybeSingle();
    const s = (data?.value ?? { enabled: false }) as ManualPaymentSettings;
    const { qrPath, ...rest } = s;
    return { ...rest, qrUrl: await this.uploads.signedUrl(qrPath, 6 * 3600) };
  }

  async uploadManualQr(image: string, actor: AuthUser, ip: string | null) {
    const { data } = await this.supabase.db.from('app_settings').select('value').eq('key', 'manualPayment').maybeSingle();
    const current = data?.value as ManualPaymentSettings | undefined;
    const qrPath = await this.uploads.uploadImage('settings/manual-payment-qr', image);
    unwrap(
      await this.supabase.db.from('app_settings').upsert({
        key: 'manualPayment', value: { enabled: true, ...(current ?? {}), qrPath },
        updated_at: new Date().toISOString(), updated_by: actor.id,
      }),
    );
    await this.audit.log({ actorId: actor.id, action: 'settings.manualPayment.qr_upload', entity: 'settings', entityId: 'manualPayment', before: { qrPath: current?.qrPath }, after: { qrPath }, ip });
    return this.manualPayment();
  }

  async publicView() {
    const s = await this.all();
    return {
      withdrawal: {
        ...s.withdrawal,
        windowOpenNow: isWindowOpen(s.withdrawal),
        nextWindowStart: nextWindowStart(s.withdrawal),
      },
      upgrade: { windowDays: s.upgrade.windowDays },
      commission: { maxGenerations: s.commission.maxGenerations ?? 50 },
      registration: s.registration,
    };
  }
}

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('settings/public')
  publicSettings() {
    return this.settings.publicView();
  }

  @Roles('admin')
  @Get('admin/settings')
  all() {
    return this.settings.all();
  }

  @Roles('admin')
  @Get('admin/settings/manual-payment')
  manualPayment() {
    return this.settings.manualPayment();
  }

  @Roles('admin')
  @HttpCode(200)
  @Post('admin/settings/manual-payment/qr')
  uploadQr(@Body() dto: QrUploadDto, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.settings.uploadManualQr(dto.image, user, ip);
  }

  @Roles('admin')
  @Put('admin/settings/:key')
  update(@Param('key') key: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.settings.update(key, body, user, ip);
  }
}

@Module({ providers: [SettingsService], controllers: [SettingsController], exports: [SettingsService] })
export class SettingsModule {}
