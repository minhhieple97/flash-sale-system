import { Inject, Injectable } from '@nestjs/common';
import {
  flashSaleMaintenanceLockKey,
  RELEASE_LOCK_REPLY,
  SALE_LEDGER_REDIS,
} from '../constants/sale-ledger.constants';
import type { MaintenanceLease } from '../interfaces/sale-ledger.interface';
import type { SaleLedgerRedis } from '../scripts/sale-ledger.scripts';

@Injectable()
export class SaleLedgerLeaseRepository {
  constructor(@Inject(SALE_LEDGER_REDIS) private readonly redis: SaleLedgerRedis) {}

  async acquireMaintenanceLease(lease: MaintenanceLease): Promise<boolean> {
    const reply = await this.redis.set(
      flashSaleMaintenanceLockKey(lease.saleId),
      lease.ownerToken,
      'PX',
      lease.ttlMs,
      'NX',
    );
    return reply === 'OK';
  }

  async releaseMaintenanceLease(saleId: string, ownerToken: string): Promise<boolean> {
    const reply = await this.redis.releaseLock(flashSaleMaintenanceLockKey(saleId), ownerToken);
    if (reply === RELEASE_LOCK_REPLY.RELEASED) return true;
    if (reply === RELEASE_LOCK_REPLY.NOT_OWNER) return false;
    throw new Error(`Unexpected releaseLock reply: ${String(reply)}`);
  }
}
