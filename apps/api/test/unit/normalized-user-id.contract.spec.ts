import type { NormalizedUserId } from '../../src/common/interfaces/user-id.interface';
import { normalizeUserId } from '../../src/common/utils/user-id-normalizer.util';
import type { ExecuteReservationParams } from '../../src/modules/checkout/interfaces/checkout.interface';
import type { CheckoutService } from '../../src/modules/checkout/services/checkout.service';
import type { ReservationRef } from '../../src/modules/orders/interfaces/order.interface';
import type { OrdersService } from '../../src/modules/orders/services/orders.service';

// The real assertions are the @ts-expect-error lines: `pnpm typecheck` fails as soon as a raw
// string becomes assignable to any of these parameters.
type AttemptPurchaseInput = Parameters<CheckoutService['attemptPurchase']>[0];
type OrderLookupInput = Parameters<OrdersService['getUserOrderStatus']>[0];

const SALE_ID = 'sale-1';
const ORDER_ID = 'order-1';

describe('NormalizedUserId brand', () => {
  it('accepts the id minted by normalizeUserId at the service boundary', () => {
    const normalization = normalizeUserId('  Alice@Example.COM ');

    if (!normalization.isValid) throw new Error('fixture must be a valid user id');
    const input: AttemptPurchaseInput = normalization.userId;

    expect(input).toBe('alice@example.com');
  });

  it('rejects raw strings for services and repository params at compile time', () => {
    const raw = 'alice@example.com';

    // @ts-expect-error a raw string is not a NormalizedUserId
    const branded: NormalizedUserId = raw;
    // @ts-expect-error CheckoutService.attemptPurchase only takes a normalized id
    const purchaseInput: AttemptPurchaseInput = raw;
    // @ts-expect-error OrdersService.getUserOrderStatus only takes a normalized id
    const lookupInput: OrderLookupInput = raw;
    const reservation: ExecuteReservationParams = {
      saleId: SALE_ID,
      // @ts-expect-error the gatekeeper params carry the brand
      userId: raw,
      orderId: ORDER_ID,
      nowMs: 0,
    };
    const ref: ReservationRef = {
      saleId: SALE_ID,
      // @ts-expect-error the job payload carries the brand
      userId: raw,
      orderId: ORDER_ID,
    };

    const values = [branded, purchaseInput, lookupInput, reservation.userId, ref.userId];
    expect(values).toEqual([raw, raw, raw, raw, raw]);
  });
});
