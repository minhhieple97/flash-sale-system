import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/env.interface';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => {
        const host: string = config.get('REDIS_HOST', { infer: true });
        const port: number = config.get('REDIS_PORT', { infer: true });
        return { connection: { host, port } };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
