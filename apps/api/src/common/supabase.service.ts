import {
  BadRequestException,
  ConflictException,
  Global,
  Injectable,
  InternalServerErrorException,
  Logger,
  Module,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { Env } from './env';

const logger = new Logger('Supabase');

/** Converts a Postgres/PostgREST error into an HTTP exception.
 *  Functions raise 'CODE: human message' which becomes 400 { code, message }. */
export function toHttpError(error: PostgrestError | { message: string; code?: string }) {
  const match = /^([A-Z_]{3,}): (.+)$/s.exec(error.message ?? '');
  if (match) {
    const [, code, message] = match;
    if (code.endsWith('_NOT_FOUND')) return new NotFoundException({ code, message });
    return new BadRequestException({ code, message });
  }
  if (error.code === '23505') return new ConflictException({ code: 'DUPLICATE', message: 'Record already exists' });
  if (error.code === '23503') return new BadRequestException({ code: 'INVALID_REFERENCE', message: 'Related record not found' });
  logger.error(error.message, (error as PostgrestError).details);
  return new InternalServerErrorException({ code: 'DB_ERROR', message: 'Database error' });
}

/** Throws on error, returns data otherwise. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unwrap<T = any>(res: { data: unknown; error: PostgrestError | null }): T {
  if (res.error) throw toHttpError(res.error);
  return res.data as T;
}

@Injectable()
export class SupabaseService {
  /** Service-role client: bypasses RLS. Never expose to the browser. */
  readonly db: SupabaseClient;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.db = createClient(config.get('SUPABASE_URL'), config.get('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Fresh anon client for password sign-in (no shared session state). */
  anon(): SupabaseClient {
    return createClient(this.config.get('SUPABASE_URL'), this.config.get('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw toHttpError(error);
    return data as T;
  }
}

@Global()
@Module({ providers: [SupabaseService], exports: [SupabaseService] })
export class SupabaseModule {}

/** Resolves a free-text admin search (user id, name, mobile, email) to profile ids. */
export async function searchUserIds(supabase: SupabaseService, search: string): Promise<string[]> {
  const s = search.replace(/[,()"%*]/g, '').trim();
  if (!s) return [];
  const { data } = await supabase.db
    .from('profiles')
    .select('id')
    .or(`user_code.ilike.%${s}%,full_name.ilike.%${s}%,mobile.ilike.%${s}%,email.ilike.%${s}%`)
    .limit(500);
  return (data ?? []).map((r: { id: string }) => r.id);
}
