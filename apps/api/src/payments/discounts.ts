import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AuthUser, ClientIp, CurrentUser, Roles } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { SupabaseService, unwrap } from '../common/supabase.service';
import { round2, toCamel } from '../common/util';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class CreateDiscountDto {
  @Transform(upper) @IsString() @Matches(/^[A-Z0-9_-]{3,30}$/, { message: 'Code: 3–30 letters, digits, - or _' }) code: string;
  @IsIn(['percent', 'flat']) discountType: 'percent' | 'flat';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) discountValue: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(1_000_000) maxUses?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class UpdateDiscountDto {
  @IsOptional() @IsIn(['percent', 'flat']) discountType?: 'percent' | 'flat';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) discountValue?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(1_000_000) maxUses?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

interface DiscountRow {
  id: string;
  code: string;
  discount_type: 'percent' | 'flat';
  discount_value: string;
  max_uses: number | null;
  expires_at: string | null;
  is_active: boolean;
  note: string | null;
  created_at: string;
}

@Injectable()
export class DiscountsService {
  constructor(private readonly supabase: SupabaseService, private readonly audit: AuditService) {}

  private checkValue(type: string, value: number) {
    if (type === 'percent' && value > 100) {
      throw new BadRequestException({ code: 'INVALID_DISCOUNT', message: 'A percentage discount cannot exceed 100%' });
    }
  }

  async list() {
    const codes = unwrap(await this.supabase.db.from('discount_codes').select('*').order('created_at', { ascending: false })) as DiscountRow[];
    const { data: used } = await this.supabase.db.from('purchases')
      .select('discount_code_id, amount, discount_amount')
      .eq('status', 'paid').not('discount_code_id', 'is', null);
    const stats = new Map<string, { uses: number; discount: number; revenue: number }>();
    for (const u of (used ?? []) as { discount_code_id: string; amount: string; discount_amount: string }[]) {
      const s = stats.get(u.discount_code_id) ?? { uses: 0, discount: 0, revenue: 0 };
      s.uses += 1;
      s.discount = round2(s.discount + Number(u.discount_amount));
      s.revenue = round2(s.revenue + Number(u.amount));
      stats.set(u.discount_code_id, s);
    }
    return codes.map((c) => ({
      ...(toCamel(c) as object),
      discountValue: Number(c.discount_value),
      ...(stats.get(c.id) ?? { uses: 0, discount: 0, revenue: 0 }),
    }));
  }

  async create(dto: CreateDiscountDto, actor: AuthUser, ip: string | null) {
    this.checkValue(dto.discountType, dto.discountValue);
    const { data: exists } = await this.supabase.db.from('discount_codes').select('id').eq('code', dto.code).maybeSingle();
    if (exists) throw new BadRequestException({ code: 'CODE_EXISTS', message: 'This code already exists' });
    const row = unwrap(
      await this.supabase.db.from('discount_codes').insert({
        code: dto.code, discount_type: dto.discountType, discount_value: dto.discountValue,
        max_uses: dto.maxUses ?? null, expires_at: dto.expiresAt ?? null, is_active: dto.isActive ?? true,
        note: dto.note?.trim() || null, created_by: actor.id,
      }).select().single(),
    );
    await this.audit.log({ actorId: actor.id, action: 'discount.create', entity: 'discount_code', entityId: row.id, after: row, ip });
    return toCamel(row);
  }

  async update(id: string, dto: UpdateDiscountDto, actor: AuthUser, ip: string | null) {
    const before = unwrap(await this.supabase.db.from('discount_codes').select('*').eq('id', id).maybeSingle()) as DiscountRow | null;
    if (!before) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Discount code not found' });
    this.checkValue(dto.discountType ?? before.discount_type, dto.discountValue ?? Number(before.discount_value));
    const patch: Record<string, unknown> = {};
    if (dto.discountType !== undefined) patch.discount_type = dto.discountType;
    if (dto.discountValue !== undefined) patch.discount_value = dto.discountValue;
    if (dto.maxUses !== undefined) patch.max_uses = dto.maxUses;
    if (dto.expiresAt !== undefined) patch.expires_at = dto.expiresAt;
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    if (dto.note !== undefined) patch.note = dto.note.trim() || null;
    const after = unwrap(await this.supabase.db.from('discount_codes').update(patch).eq('id', id).select().single());
    await this.audit.log({ actorId: actor.id, action: 'discount.update', entity: 'discount_code', entityId: id, before, after, ip });
    return toCamel(after);
  }
}

@Roles('admin')
@Controller('admin/discounts')
export class DiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  @Get()
  list() {
    return this.discounts.list();
  }

  @Post()
  create(@Body() dto: CreateDiscountDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) {
    return this.discounts.create(dto, u, ip);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDiscountDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) {
    return this.discounts.update(id, dto, u, ip);
  }
}
