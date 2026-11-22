import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  ERROR_CODES,
  TEMPORARY_FAILURE_MESSAGE,
} from '../../src/common/constants/common.constants';
import type { ClockService } from '../../src/common/providers/clock.service';
import type { PurchaseRejectionCode } from '../../src/modules/checkout/interfaces/checkout.interface';
import { CheckoutService } from '../../src/modules/checkout/services/checkout.service';
import { ACTIVE_FLASH_SALE_ID } from '../../src/modules/flash-sales/constants/flash-sales.constants';
import type { MetricsService } from '../../src/modules/metrics/services/metrics.service';
import type { ScheduleReservationOutcome } from '../../src/modules/orders/interfaces/order.interface';
import type { OrderPersistenceService } from '../../src/modules/orders/services/order-persistence.service';
import type {
  AttemptPurchaseParams,
  ReservationRef,
  ReservationVerdict,
  SaleLedgerRepository,
} from '../../src/modules/sale-ledger';
import { userIdOf } from '../support/user-id.fixtures';

const NOW_MS = 1_700_000_000_000;
const USER_ID = userIdOf('alice');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REJECTIONS: PurchaseRejectionCode[] = [
  'ALREADY_PURCHASED',
  'SOLD_OUT',
  'SALE_UPCOMING',
  'SALE_ENDED',
];

function buildService() {
  const reserve = jest.fn<Promise<ReservationVerdict>, [AttemptPurchaseParams]>();
  const scheduleReservation = jest.fn<Promise<ScheduleReservationOutcome>, [ReservationRef]>();
  const recordPurchaseAttempt = jest.fn<void, [string]>();
  reserve.mockResolvedValue('RESERVED');
  scheduleReservation.mockResolvedValue('QUEUED');
  const service = new CheckoutService(
    { reserve } as unknown as SaleLedgerRepository,
    { scheduleReservation } as unknown as OrderPersistenceService,
    { nowMs: () => NOW_MS } as ClockService,
    { recordPurchaseAttempt } as unknown as MetricsService,
  );
  return { service, reserve, scheduleReservation, recordPurchaseAttempt };
}

async function captureError(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt;
  } catch (error) {
    return error;
  }
  throw new Error('expected the attempt to reject');
}

function expectTemporaryFailure(error: unknown): void {
  expect(error).toBeInstanceOf(ServiceUnavailableException);
  expect((error as ServiceUnavailableException).getResponse()).toEqual({
    code: ERROR_CODES.TEMPORARY_FAILURE,
    message: TEMPORARY_FAILURE_MESSAGE,
  });
}

describe('CheckoutService.attemptPurchase', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls the gatekeeper once with the sale, user, a uuid order id and the clock time', async () => {
    const { service, reserve } = buildService();

    await service.attemptPurchase(USER_ID);

    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledWith({
      saleId: ACTIVE_FLASH_SALE_ID,
      userId: USER_ID,
      orderId: expect.stringMatching(UUID_PATTERN),
      nowMs: NOW_MS,
    });
  });

  it('returns RESERVED and schedules the same order id the gatekeeper reserved', async () => {
    const { service, reserve, scheduleReservation } = buildService();

    const result = await service.attemptPurchase(USER_ID);

    const { orderId } = reserve.mock.calls[0][0];
    expect(result).toEqual({ outcome: 'RESERVED', orderId, userId: USER_ID });
    expect(scheduleReservation).toHaveBeenCalledTimes(1);
    expect(scheduleReservation).toHaveBeenCalledWith({
      saleId: ACTIVE_FLASH_SALE_ID,
      userId: USER_ID,
      orderId,
    });
  });

  it.each(REJECTIONS)('returns %s as a value without scheduling or logging', async (verdict) => {
    const { service, reserve, scheduleReservation } = buildService();
    reserve.mockResolvedValue(verdict);

    const result = await service.attemptPurchase(USER_ID);

    expect(result).toEqual({ outcome: verdict });
    expect(scheduleReservation).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers 503 TEMPORARY_FAILURE without scheduling when the sale is not configured', async () => {
    const { service, reserve, scheduleReservation } = buildService();
    reserve.mockResolvedValue('SALE_NOT_CONFIGURED');

    const error = await captureError(service.attemptPurchase(USER_ID));

    expectTemporaryFailure(error);
    expect(scheduleReservation).not.toHaveBeenCalled();
  });

  it('answers 503 TEMPORARY_FAILURE when the reservation was released after a failed enqueue', async () => {
    const { service, scheduleReservation } = buildService();
    scheduleReservation.mockResolvedValue('RELEASED');

    const error = await captureError(service.attemptPurchase(USER_ID));

    expectTemporaryFailure(error);
  });

  it('answers 503 TEMPORARY_FAILURE and logs one warn when the gatekeeper rejects', async () => {
    const { service, reserve, scheduleReservation } = buildService();
    reserve.mockRejectedValue(new Error('redis down'));

    const error = await captureError(service.attemptPurchase(USER_ID));

    expectTemporaryFailure(error);
    expect(scheduleReservation).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('redis down');
  });

  it('answers 503 TEMPORARY_FAILURE and logs one warn when scheduling rejects', async () => {
    const { service, scheduleReservation } = buildService();
    scheduleReservation.mockRejectedValue(new Error('release failed'));

    const error = await captureError(service.attemptPurchase(USER_ID));

    expectTemporaryFailure(error);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('release failed');
  });

  it('gives each attempt its own order id', async () => {
    const { service, reserve } = buildService();

    await service.attemptPurchase(USER_ID);
    await service.attemptPurchase(USER_ID);

    const [first, second] = reserve.mock.calls.map(([params]) => params.orderId);
    expect(first).not.toBe(second);
  });

  it('records RESERVED, rejection verdicts and TEMPORARY_FAILURE in MetricsService', async () => {
    const { service, reserve, recordPurchaseAttempt } = buildService();
    await service.attemptPurchase(USER_ID);
    reserve.mockResolvedValueOnce('SOLD_OUT');
    await service.attemptPurchase(USER_ID);
    reserve.mockResolvedValueOnce('SALE_NOT_CONFIGURED');
    await expect(service.attemptPurchase(USER_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(recordPurchaseAttempt.mock.calls).toEqual([
      ['RESERVED'],
      ['SOLD_OUT'],
      [ERROR_CODES.TEMPORARY_FAILURE],
    ]);
  });
});
