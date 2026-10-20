import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SupabaseService } from './supabase.service';

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  userCode: string;
  fullName: string;
  activePackageId: string | null;
}

export type AuthedRequest = Request & { user: AuthUser; token: string };

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_SUSPENDED = 'allowSuspended';
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED, true);

export const ROLES = 'roles';
export const Roles = (...roles: AuthUser['role'][]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user,
);

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.ip ?? null;
});

/** Short-lived token → user cache, so we don't hit Supabase Auth on every request. */
@Injectable()
export class AuthCache {
  private readonly ttlMs = 60_000;
  private readonly map = new Map<string, { user: AuthUser; exp: number }>();

  get(token: string) {
    const hit = this.map.get(token);
    if (!hit) return null;
    if (hit.exp < Date.now()) {
      this.map.delete(token);
      return null;
    }
    return hit.user;
  }

  set(token: string, user: AuthUser) {
    if (this.map.size > 5000) this.map.clear();
    this.map.set(token, { user, exp: Date.now() + this.ttlMs });
  }

  invalidateUser(userId: string) {
    for (const [k, v] of this.map) if (v.user.id === userId) this.map.delete(k);
  }

  invalidateToken(token: string) {
    this.map.delete(token);
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
    private readonly cache: AuthCache,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Please log in' });

    let user = this.cache.get(token);
    if (!user) {
      const { data, error } = await this.supabase.db.auth.getUser(token);
      if (error || !data.user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Session expired' });
      const { data: p } = await this.supabase.db
        .from('profiles')
        .select('id, email, role, status, user_code, full_name, active_package_id')
        .eq('id', data.user.id)
        .maybeSingle();
      if (!p) throw new UnauthorizedException({ code: 'NO_PROFILE', message: 'Account not found' });
      user = {
        id: p.id,
        email: p.email,
        role: p.role,
        status: p.status,
        userCode: p.user_code,
        fullName: p.full_name,
        activePackageId: p.active_package_id,
      };
      this.cache.set(token, user);
    }

    if (user.status === 'suspended' && !this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED, targets)) {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Your account is suspended' });
    }

    const roles = this.reflector.getAllAndOverride<AuthUser['role'][]>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Admin access required' });
    }

    req.user = user;
    req.token = token;
    return true;
  }
}
