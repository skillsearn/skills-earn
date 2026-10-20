import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/auth';
import { SupabaseService } from '../common/supabase.service';

@Controller('health')
export class HealthController {
  constructor(private readonly supabase: SupabaseService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    const { error } = await this.supabase.db.from('packages').select('id', { head: true, count: 'exact' });
    if (error) throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    return { status: 'ok', db: 'up', time: new Date().toISOString() };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
