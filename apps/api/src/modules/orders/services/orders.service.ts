import { Injectable } from '@nestjs/common';
import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import { ACTIVE_FLASH_SALE_ID } from '../../flash-sales/constants/flash-sales.constants';
import { SaleLedgerRepository } from '../../sale-ledger';
import type {
  ConfirmedBatchPage,
  ListConfirmedBatchParams,
  UserOrderStatus,
} from '../interfaces/order.interface';
import { OrdersRepository } from '../repositories/orders.repository';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly ledger: SaleLedgerRepository,
  ) {}

  /**
   * Cache first for ACTIVE_FLASH_SALE_ID: a RESERVED or CONFIRMED slot answers in O(1),
   * and a NONE slot while the ledger is intact answers NONE without hitting PostgreSQL.
   * Only when the ledger is missing keys does lookup fall back to PostgreSQL.
   */
  async getUserOrderStatus(userId: NormalizedUserId): Promise<UserOrderStatus> {
    const { slot, isLedgerIntact } = await this.ledger.readSlotWithLedgerState(
      ACTIVE_FLASH_SALE_ID,
      userId,
    );
    if (slot.status !== 'NONE') return { ...slot, userId };
    if (isLedgerIntact) return { status: 'NONE', userId };
    const orderId = await this.ordersRepository.findConfirmedOrderId(ACTIVE_FLASH_SALE_ID, userId);
    if (orderId === null) return { status: 'NONE', userId };
    return { status: 'CONFIRMED', orderId, userId };
  }

  async hasConfirmedOrders(saleId: string): Promise<boolean> {
    return this.ordersRepository.hasConfirmedOrders(saleId);
  }

  async listConfirmedBatch(params: ListConfirmedBatchParams): Promise<ConfirmedBatchPage> {
    return this.ordersRepository.listConfirmedBatch(params);
  }
}
