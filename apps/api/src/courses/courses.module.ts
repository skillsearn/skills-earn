import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, ClientIp, CurrentUser, Public, Roles } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { SupabaseService, unwrap } from '../common/supabase.service';
import { toCamel } from '../common/util';

export class CourseDto {
  @IsString() @MaxLength(120) title: string;
  @Matches(/^[a-z0-9-]{3,80}$/) slug: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsUrl() thumbnailUrl?: string;
  @IsInt() @Min(1) @Max(99) minPackageLevel: number;
  @IsOptional() @IsBoolean() isPublished?: boolean;
  @IsOptional() @IsInt() sort?: number;
}
export class UpdateCourseDto extends PartialType(CourseDto) {}

export class LessonDto {
  @IsString() @MaxLength(160) title: string;
  @IsOptional() @IsUrl() videoUrl?: string;
  @IsOptional() @IsString() @MaxLength(20000) content?: string;
  @IsOptional() @IsInt() @Min(0) durationMinutes?: number;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsBoolean() isPreview?: boolean;
}
export class UpdateLessonDto extends PartialType(LessonDto) {}

const COURSE_MAP: Record<string, string> = {
  title: 'title', slug: 'slug', description: 'description', thumbnailUrl: 'thumbnail_url',
  minPackageLevel: 'min_package_level', isPublished: 'is_published', sort: 'sort',
};
const LESSON_MAP: Record<string, string> = {
  title: 'title', videoUrl: 'video_url', content: 'content', durationMinutes: 'duration_minutes', sort: 'sort', isPreview: 'is_preview',
};
const mapRow = (dto: object, map: Record<string, string>) =>
  Object.fromEntries(Object.entries(dto).filter(([k, v]) => map[k] && v !== undefined).map(([k, v]) => [map[k], v]));

interface LessonRow {
  id: string;
  title: string;
  video_url: string | null;
  content: string | null;
  duration_minutes: number | null;
  sort: number;
  is_preview: boolean;
}

@Injectable()
export class CoursesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
  ) {}

  private async userLevel(userId: string): Promise<number> {
    const { data } = await this.supabase.db
      .from('profiles')
      .select('active_package:packages!profiles_active_package_id_fkey(level)')
      .eq('id', userId)
      .single();
    return (data?.active_package as unknown as { level: number } | null)?.level ?? 0;
  }

  async catalog() {
    const rows = unwrap(
      await this.supabase.db.from('courses')
        .select('id, title, slug, description, thumbnail_url, min_package_level, lessons(count)')
        .eq('is_published', true).order('sort'),
    );
    return toCamel(rows);
  }

  async listForUser(user: AuthUser) {
    const [level, courses, progress] = await Promise.all([
      this.userLevel(user.id),
      this.supabase.db.from('courses')
        .select('id, title, slug, description, thumbnail_url, min_package_level, sort, lessons(id)')
        .eq('is_published', true).order('sort').then(unwrap),
      this.supabase.db.from('lesson_progress').select('lesson_id').eq('user_id', user.id).then(unwrap),
    ]);
    const done = new Set((progress as { lesson_id: string }[]).map((p) => p.lesson_id));
    return (courses as (Record<string, unknown> & { lessons: { id: string }[]; min_package_level: number })[]).map(({ lessons, ...c }) => ({
      ...toCamel<object>(c),
      lessonCount: lessons.length,
      completedCount: lessons.filter((l) => done.has(l.id)).length,
      locked: c.min_package_level > level,
    }));
  }

  async detail(user: AuthUser, slug: string) {
    const course = unwrap(
      await this.supabase.db.from('courses').select('*, lessons(*)').eq('slug', slug).eq('is_published', true).maybeSingle(),
    ) as (Record<string, unknown> & { id: string; min_package_level: number; lessons: LessonRow[] }) | null;
    if (!course) throw new NotFoundException({ code: 'COURSE_NOT_FOUND', message: 'Course not found' });
    const level = await this.userLevel(user.id);
    const locked = course.min_package_level > level;
    if (!locked) {
      await this.supabase.db.from('enrolments').upsert({ user_id: user.id, course_id: course.id }, { onConflict: 'user_id,course_id', ignoreDuplicates: true });
    }
    const progress = unwrap(await this.supabase.db.from('lesson_progress').select('lesson_id').eq('user_id', user.id)) as { lesson_id: string }[];
    const done = new Set(progress.map((p) => p.lesson_id));
    const lessons = [...course.lessons]
      .sort((a, b) => a.sort - b.sort)
      .map((l) => {
        const open = !locked || l.is_preview;
        return {
          id: l.id, title: l.title, durationMinutes: l.duration_minutes, sort: l.sort, isPreview: l.is_preview,
          locked: !open, completed: done.has(l.id),
          videoUrl: open ? l.video_url : null,
          content: open ? l.content : null,
        };
      });
    const { lessons: _omit, ...rest } = course;
    return { ...toCamel<object>(rest), locked, lessons };
  }

  async complete(user: AuthUser, lessonId: string) {
    const lesson = unwrap(
      await this.supabase.db.from('lessons').select('id, is_preview, course:courses(min_package_level)').eq('id', lessonId).maybeSingle(),
    ) as unknown as { id: string; is_preview: boolean; course: { min_package_level: number } } | null;
    if (!lesson) throw new NotFoundException({ code: 'LESSON_NOT_FOUND', message: 'Lesson not found' });
    if (!lesson.is_preview && lesson.course.min_package_level > (await this.userLevel(user.id))) {
      throw new ForbiddenException({ code: 'COURSE_LOCKED', message: 'Upgrade your package to access this lesson' });
    }
    await this.supabase.db.from('lesson_progress').upsert({ user_id: user.id, lesson_id: lessonId }, { onConflict: 'user_id,lesson_id', ignoreDuplicates: true });
    return { ok: true };
  }

  // ───────── admin ─────────
  async adminList() {
    const rows = unwrap(
      await this.supabase.db.from('courses').select('*, lessons(count), enrolments(count)').order('sort'),
    );
    return toCamel(rows);
  }

  async adminGet(id: string) {
    const row = unwrap(await this.supabase.db.from('courses').select('*, lessons(*)').eq('id', id).maybeSingle()) as
      | (Record<string, unknown> & { lessons: LessonRow[] })
      | null;
    if (!row) throw new NotFoundException({ code: 'COURSE_NOT_FOUND', message: 'Course not found' });
    row.lessons.sort((a, b) => a.sort - b.sort);
    return toCamel(row);
  }

  async create(dto: CourseDto, actor: AuthUser, ip: string | null) {
    const row = unwrap(await this.supabase.db.from('courses').insert(mapRow(dto, COURSE_MAP)).select().single());
    await this.audit.log({ actorId: actor.id, action: 'course.create', entity: 'course', entityId: row.id, after: row, ip });
    return toCamel(row);
  }

  async update(id: string, dto: UpdateCourseDto, actor: AuthUser, ip: string | null) {
    const row = unwrap(await this.supabase.db.from('courses').update(mapRow(dto, COURSE_MAP)).eq('id', id).select().single());
    await this.audit.log({ actorId: actor.id, action: 'course.update', entity: 'course', entityId: id, after: row, ip });
    return toCamel(row);
  }

  async remove(id: string, actor: AuthUser, ip: string | null) {
    unwrap(await this.supabase.db.from('courses').delete().eq('id', id));
    await this.audit.log({ actorId: actor.id, action: 'course.delete', entity: 'course', entityId: id, ip });
    return { ok: true };
  }

  async addLesson(courseId: string, dto: LessonDto) {
    return toCamel(unwrap(await this.supabase.db.from('lessons').insert({ ...mapRow(dto, LESSON_MAP), course_id: courseId }).select().single()));
  }

  async updateLesson(id: string, dto: UpdateLessonDto) {
    return toCamel(unwrap(await this.supabase.db.from('lessons').update(mapRow(dto, LESSON_MAP)).eq('id', id).select().single()));
  }

  async removeLesson(id: string) {
    unwrap(await this.supabase.db.from('lessons').delete().eq('id', id));
    return { ok: true };
  }
}

@Controller()
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Public()
  @Get('courses/catalog')
  catalog() {
    return this.courses.catalog();
  }

  @Get('courses')
  list(@CurrentUser() u: AuthUser) {
    return this.courses.listForUser(u);
  }

  @Get('courses/:slug')
  detail(@CurrentUser() u: AuthUser, @Param('slug') slug: string) {
    return this.courses.detail(u, slug);
  }

  @HttpCode(200)
  @Post('courses/lessons/:id/complete')
  complete(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.complete(u, id);
  }

  @Roles('admin') @Get('admin/courses')
  adminList() { return this.courses.adminList(); }

  @Roles('admin') @Get('admin/courses/:id')
  adminGet(@Param('id', ParseUUIDPipe) id: string) { return this.courses.adminGet(id); }

  @Roles('admin') @Post('admin/courses')
  create(@Body() dto: CourseDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) { return this.courses.create(dto, u, ip); }

  @Roles('admin') @Patch('admin/courses/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCourseDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) {
    return this.courses.update(id, dto, u, ip);
  }

  @Roles('admin') @Delete('admin/courses/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ClientIp() ip: string | null) { return this.courses.remove(id, u, ip); }

  @Roles('admin') @Post('admin/courses/:id/lessons')
  addLesson(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LessonDto) { return this.courses.addLesson(id, dto); }

  @Roles('admin') @Patch('admin/lessons/:id')
  updateLesson(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLessonDto) { return this.courses.updateLesson(id, dto); }

  @Roles('admin') @Delete('admin/lessons/:id')
  removeLesson(@Param('id', ParseUUIDPipe) id: string) { return this.courses.removeLesson(id); }
}

@Module({ providers: [CoursesService], controllers: [CoursesController] })
export class CoursesModule {}
