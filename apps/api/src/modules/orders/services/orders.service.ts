import { Injectable } from '@nestjs/common';
import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import { ACTIVE_FLASH_SALE_ID } from '../../flash-sales/constants/flash-sales.constants';
import type {
  ConfirmedReservation,
  LedgerHydrationResult,
  SaleLedgerState,
  UserOrderStatus,
} from '../interfaces/order.interface';
import { OrderCacheRepository } from '../repositories/order-cache.repository';
import { OrdersRepository } from '../repositories/orders.repository';

/** Read model of orders plus the ledger lifecycle AdminModule drives. Exported by OrdersModule. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly orderCache: OrderCacheRepository,
  ) {}

  /**
   * Cache first for ACTIVE_FLASH_SALE_ID: a RESERVED or CONFIRMED slot answers in O(1).
   * A NONE slot falls back to PostgreSQL, which answers CONFIRMED (with its orderId) or NONE.
   */
  async getUserOrderStatus(userId: NormalizedUserId): Promise<UserOrderStatus> {
    const slot = await this.orderCache.findSlot(ACTIVE_FLASH_SALE_ID, userId);
    if (slot.status !== 'NONE') return { ...slot, userId };
    const orderId = await this.ordersRepository.findConfirmedOrderId(ACTIVE_FLASH_SALE_ID, userId);
    if (orderId === null) return { status: 'NONE', userId };
    return { status: 'CONFIRMED', orderId, userId };
  }

  async listConfirmedReservations(saleId: string): Promise<readonly ConfirmedReservation[]> {
    return this.ordersRepository.listConfirmed(saleId);
  }

  async hydrateSaleState(state: SaleLedgerState): Promise<LedgerHydrationResult> {
    return this.orderCache.hydrateIfAbsent(state);
  }

  async replaceSaleState(state: SaleLedgerState): Promise<void> {
    return this.orderCache.replaceState(state);
  }
}
