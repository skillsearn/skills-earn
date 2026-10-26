import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { AuthUser, ClientIp, CurrentUser, Public, Roles } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { SupabaseService, unwrap } from '../common/supabase.service';
import { toCamel } from '../common/util';

export class CreatePackageDto {
  @IsString() @MaxLength(60) name: string;
  @Matches(/^[a-z0-9-]{2,40}$/) slug: string;
  @IsInt() @Min(1) @Max(99) level: number;
  @IsNumber() @Min(1) price: number;
  @IsInt() @Min(0) @Max(10000) directRateBps: number;
  @IsInt() @Min(0) @Max(50) maxGenerations: number;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) features?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePackageDto extends PartialType(CreatePackageDto) {}

export class CommissionRuleDto {
  @IsArray() @ArrayMinSize(3) @ArrayMaxSize(3) @IsInt({ each: true }) @Min(0, { each: true }) @Max(10000, { each: true })
  generationRatesBps: number[];
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export interface PackageRow {
  id: string;
  name: string;
  slug: string;
  level: number;
  price: string;
  direct_rate_bps: number;
  max_generations: number;
  description: string | null;
  features: string[];
  is_active: boolean;
}

@Injectable()
export class PackagesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
  ) {}

  async currentRule() {
    return unwrap(
      await this.supabase.db.from('commission_rule_versions').select('*').order('id', { ascending: false }).limit(1).single(),
    ) as { id: number; generation_rates_bps: number[] };
  }

  /** Packages with the generation rates they are eligible for (global 3-rate cycle, up to max_generations). */
  async list(includeInactive = false) {
    let q = this.supabase.db.from('packages').select('*').order('level');
    if (!includeInactive) q = q.eq('is_active', true);
    const [rows, rule] = await Promise.all([q.then(unwrap<PackageRow[]>), this.currentRule()]);
    return rows.map((p) => this.present(p, rule.generation_rates_bps));
  }

  present(p: PackageRow, rates: number[]) {
    return {
      ...toCamel<Record<string, unknown>>(p),
      price: Number(p.price),
      generationRatesBps: Array.from({ length: p.max_generations }, (_, i) => rates[i % rates.length]),
    };
  }

  async get(id: string) {
    const row = unwrap(await this.supabase.db.from('packages').select('*').eq('id', id).maybeSingle()) as PackageRow | null;
    if (!row) throw new NotFoundException({ code: 'PACKAGE_NOT_FOUND', message: 'Package not found' });
    return row;
  }

  private toRow(dto: Partial<CreatePackageDto>) {
    const map: Record<string, string> = {
      name: 'name', slug: 'slug', level: 'level', price: 'price', directRateBps: 'direct_rate_bps',
      maxGenerations: 'max_generations', description: 'description', features: 'features', isActive: 'is_active',
    };
    return Object.fromEntries(Object.entries(dto).filter(([k, v]) => map[k] && v !== undefined).map(([k, v]) => [map[k], v]));
  }

  async create(dto: CreatePackageDto, actor: AuthUser, ip: string | null) {
    const row = unwrap(await this.supabase.db.from('packages').insert(this.toRow(dto)).select().single());
    await this.audit.log({ actorId: actor.id, action: 'package.create', entity: 'package', entityId: row.id, after: row, ip });
    return toCamel(row);
  }

  async update(id: string, dto: UpdatePackageDto, actor: AuthUser, ip: string | null) {
    const before = await this.get(id);
    const row = unwrap(await this.supabase.db.from('packages').update(this.toRow(dto)).eq('id', id).select().single());
    await this.audit.log({ actorId: actor.id, action: 'package.update', entity: 'package', entityId: id, before, after: row, ip });
    return toCamel(row);
  }

  async ruleHistory() {
    const rows = unwrap(
      await this.supabase.db
        .from('commission_rule_versions')
        .select('*')
        .order('id', { ascending: false }),
    );
    return toCamel(rows);
  }

  async addRule(dto: CommissionRuleDto, actor: AuthUser, ip: string | null) {
    const before = await this.currentRule();
    const row = unwrap(
      await this.supabase.db
        .from('commission_rule_versions')
        .insert({ generation_rates_bps: dto.generationRatesBps, note: dto.note ?? null, created_by: actor.id })
        .select()
        .single(),
    );
    await this.audit.log({ actorId: actor.id, action: 'commission_rule.create', entity: 'commission_rule', entityId: String(row.id), before, after: row, ip });
    return toCamel(row);
  }
}

@Controller()
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Public()
  @Get('packages')
  list() {
    return this.packages.list();
  }

  @Roles('admin')
  @Get('admin/packages')
  adminList() {
    return this.packages.list(true);
  }

  @Roles('admin')
  @Post('admin/packages')
  create(@Body() dto: CreatePackageDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) {
    return this.packages.create(dto, u, ip);
  }

  @Roles('admin')
  @Patch('admin/packages/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePackageDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) {
    return this.packages.update(id, dto, u, ip);
  }

  @Roles('admin')
  @Get('admin/commission-rules')
  rules() {
    return this.packages.ruleHistory();
  }

  @Roles('admin')
  @Post('admin/commission-rules')
  addRule(@Body() dto: CommissionRuleDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) {
    return this.packages.addRule(dto, u, ip);
  }
}

@Module({ providers: [PackagesService], controllers: [PackagesController], exports: [PackagesService] })
export class PackagesModule {}
