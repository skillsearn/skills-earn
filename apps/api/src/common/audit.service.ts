import { Global, Injectable, Module } from '@nestjs/common';
import { AuthCache, AuthGuard } from './auth';
import { SupabaseService } from './supabase.service';

@Injectable()
export class AuditService {
  constructor(private readonly supabase: SupabaseService) {}

  async log(entry: {
    actorId?: string | null;
    action: string;
    entity?: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
  }) {
    await this.supabase.db.from('audit_logs').insert({
      actor_id: entry.actorId ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entity_id: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
    });
  }
}

@Global()
@Module({ providers: [AuditService, AuthCache, AuthGuard], exports: [AuditService, AuthCache, AuthGuard] })
export class CommonModule {}
