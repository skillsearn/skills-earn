import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../common/supabase.service';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Credits matured pending commissions (only relevant when commission.holdDays > 0). */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async releasePendingCommissions() {
    try {
      const released = await this.supabase.rpc<number>('release_pending_commissions');
      if (released) this.logger.log(`Released ${released} pending commission(s)`);
    } catch (err) {
      this.logger.error(`release_pending_commissions failed: ${(err as Error).message}`);
    }
  }
}

@Module({ providers: [JobsService] })
export class JobsModule {}
