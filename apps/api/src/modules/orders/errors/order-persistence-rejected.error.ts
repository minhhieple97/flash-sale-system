import type { PersistRejectionReason } from '../interfaces/order.interface';

export class OrderPersistenceRejectedError extends Error {
  constructor(
    readonly reason: PersistRejectionReason,
    readonly orderId: string,
  ) {
    super(reason);
    this.name = OrderPersistenceRejectedError.name;
  }
}
