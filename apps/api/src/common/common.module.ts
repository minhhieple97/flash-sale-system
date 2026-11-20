import { Module } from '@nestjs/common';
import { ClockService } from './providers/clock.service';

@Module({ providers: [ClockService], exports: [ClockService] })
export class CommonModule {}
