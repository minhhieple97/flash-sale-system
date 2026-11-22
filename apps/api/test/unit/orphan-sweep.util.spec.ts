import {
  NO_STRIKES,
  STRIKES_TO_COMPENSATE,
} from '../../src/modules/orders/constants/orders.constants';
import { decideSweep } from '../../src/modules/orders/utils/orphan-sweep.util';
import type { ReservationRef } from '../../src/modules/sale-ledger';
import { userIdOf } from '../support/user-id.fixtures';

const refOf = (user: string): ReservationRef => ({
  saleId: 'sale-1',
  userId: userIdOf(user),
  orderId: `order-${user}`,
});

const A = refOf('alice');
const B = refOf('bob');

describe('decideSweep', () => {
  it('compensates nothing on the first interval sighting and records one strike per orphan', () => {
    const decision = decideSweep(NO_STRIKES, [A, B], STRIKES_TO_COMPENSATE.INTERVAL);

    expect(decision.toCompensate).toEqual([]);
    expect(decision.nextStrikes.size).toBe(2);
    expect(decision.nextStrikes.get(A.orderId)).toBe(1);
  });

  it('compensates an orphan seen on two consecutive interval sweeps and drops its strike', () => {
    const first = decideSweep(NO_STRIKES, [A], STRIKES_TO_COMPENSATE.INTERVAL);

    const second = decideSweep(first.nextStrikes, [A], STRIKES_TO_COMPENSATE.INTERVAL);

    expect(second.toCompensate).toEqual([A]);
    expect(second.nextStrikes.has(A.orderId)).toBe(false);
  });

  it('drops the strike of an orderId that is no longer orphaned', () => {
    const first = decideSweep(NO_STRIKES, [A, B], STRIKES_TO_COMPENSATE.INTERVAL);

    const second = decideSweep(first.nextStrikes, [A], STRIKES_TO_COMPENSATE.INTERVAL);

    expect(second.toCompensate).toEqual([A]);
    expect(second.nextStrikes.size).toBe(0);
  });

  it('compensates every orphan at once with the boot threshold', () => {
    const decision = decideSweep(NO_STRIKES, [A, B], STRIKES_TO_COMPENSATE.BOOT);

    expect(decision.toCompensate).toEqual([A, B]);
    expect(decision.nextStrikes.size).toBe(0);
  });

  it('starts a new reservation of the same user clean', () => {
    const first = decideSweep(NO_STRIKES, [A], STRIKES_TO_COMPENSATE.INTERVAL);
    const renewed = { ...A, orderId: 'order-alice-2' };

    const second = decideSweep(first.nextStrikes, [renewed], STRIKES_TO_COMPENSATE.INTERVAL);

    expect(second.toCompensate).toEqual([]);
    expect(second.nextStrikes.get(renewed.orderId)).toBe(1);
  });
});
