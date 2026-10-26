import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, Put } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, Max, Min, validateSync } from 'class-validator';
import { AuthUser, ClientIp, CurrentUser, Public, Roles } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { SupabaseService, unwrap } from '../common/supabase.service';
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
  @IsInt() @Min(1) @Max(50) maxGenerations: number; // generations above the direct referrer that are calculated
}

export class RegistrationSettingsDto {
  @IsBoolean() referralRequired: boolean;
}

const SCHEMAS = {
  withdrawal: WithdrawalSettingsDto,
  upgrade: UpgradeSettingsDto,
  commission: CommissionSettingsDto,
  registration: RegistrationSettingsDto,
} as const;
export type SettingKey = keyof typeof SCHEMAS;

export interface AllSettings {
  withdrawal: WithdrawalSettingsDto;
  upgrade: UpgradeSettingsDto;
  commission: CommissionSettingsDto;
  registration: RegistrationSettingsDto;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
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
    const clean = { ...dto };
    unwrap(
      await this.supabase.db
        .from('app_settings')
        .update({ value: clean, updated_at: new Date().toISOString(), updated_by: actor.id })
        .eq('key', key),
    );
    await this.audit.log({ actorId: actor.id, action: `settings.${key}.update`, entity: 'settings', entityId: key, before, after: clean, ip });
    return clean;
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
      commission: { maxGenerations: s.commission.maxGenerations ?? 3 },
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
  @Put('admin/settings/:key')
  update(@Param('key') key: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.settings.update(key, body, user, ip);
  }
}

@Module({ providers: [SettingsService], controllers: [SettingsController], exports: [SettingsService] })
export class SettingsModule {}
