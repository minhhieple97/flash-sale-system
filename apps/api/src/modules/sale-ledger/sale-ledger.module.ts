import { Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { SALE_LEDGER_REDIS } from './constants/sale-ledger.constants';
import { SaleLedgerRepository } from './repositories/sale-ledger.repository';
import { SaleLedgerLeaseRepository } from './repositories/sale-ledger-lease.repository';
import { SALE_LEDGER_SCRIPTS, type SaleLedgerRedis } from './scripts/sale-ledger.scripts';

function registerLedgerScripts(client: Redis): SaleLedgerRedis {
  for (const { name, numberOfKeys, lua } of SALE_LEDGER_SCRIPTS) {
    client.defineCommand(name, { numberOfKeys, lua });
  }
  // defineCommand attaches the methods at runtime, so the type cannot see them.
  return client as SaleLedgerRedis;
}

@Module({
  imports: [RedisModule],
  providers: [
    { provide: SALE_LEDGER_REDIS, inject: [REDIS_CLIENT], useFactory: registerLedgerScripts },
    SaleLedgerRepository,
    SaleLedgerLeaseRepository,
  ],
  exports: [SaleLedgerRepository, SaleLedgerLeaseRepository],
})
export class SaleLedgerModule {}
