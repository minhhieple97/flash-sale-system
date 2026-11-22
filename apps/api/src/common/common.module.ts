import { Module } from '@nestjs/common';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { ClockService } from './providers/clock.service';
import { RateLimitService } from './services/rate-limit.service';

@Module({
  providers: [ClockService, RateLimitService, RateLimitGuard],
  exports: [ClockService, RateLimitService, RateLimitGuard],
})
export class CommonModule {}
