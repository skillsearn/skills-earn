import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { SupabaseService, toHttpError, unwrap } from '../common/supabase.service';
import { pageRange, toCamel } from '../common/util';

export class AnnouncementDto {
  @IsString() @MinLength(3) @MaxLength(120) title: string;
  @IsString() @MinLength(3) @MaxLength(2000) body: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(user: AuthUser, q: { page?: string; pageSize?: string }) {
    const { from, to, page, pageSize } = pageRange(q.page, q.pageSize);
    const [list, unread] = await Promise.all([
      this.supabase.db.from('notifications').select('*', { count: 'exact' }).eq('user_id', user.id)
        .order('created_at', { ascending: false }).range(from, to),
      this.supabase.db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null),
    ]);
    if (list.error) throw toHttpError(list.error);
    return { items: toCamel(list.data), total: list.count ?? 0, unread: unread.count ?? 0, page, pageSize };
  }

  async markRead(user: AuthUser, id?: string) {
    let q = this.supabase.db.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
    if (id) q = q.eq('id', id);
    unwrap(await q);
    return { ok: true };
  }

  async announcements() {
    return toCamel(unwrap(await this.supabase.db.from('announcements').select('*').order('created_at', { ascending: false }).limit(100)));
  }

  async announce(dto: AnnouncementDto, actor: AuthUser) {
    return toCamel(await this.supabase.rpc('broadcast_announcement', { p_title: dto.title, p_body: dto.body, p_actor: actor.id }));
  }
}

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('me/notifications')
  list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.notifications.list(u, q);
  }

  @HttpCode(200)
  @Post('me/notifications/read-all')
  readAll(@CurrentUser() u: AuthUser) {
    return this.notifications.markRead(u);
  }

  @HttpCode(200)
  @Post('me/notifications/:id/read')
  read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(u, id);
  }

  @Roles('admin')
  @Get('admin/announcements')
  announcements() {
    return this.notifications.announcements();
  }

  @Roles('admin')
  @Post('admin/announcements')
  announce(@Body() dto: AnnouncementDto, @CurrentUser() u: AuthUser) {
    return this.notifications.announce(dto, u);
  }
}

@Module({ providers: [NotificationsService], controllers: [NotificationsController] })
export class NotificationsModule {}
