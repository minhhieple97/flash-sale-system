import type { PollVerdict } from '@/shared/hooks/use-polling';
import { CONFIRMATION_POLL_MAX_ATTEMPTS } from '../constants/orders.constants';
import type { ConfirmationState, OrderState, OrderStatus } from '../types/orders.types';

export interface ConfirmationTransition {
  next: ConfirmationState;
  verdict: PollVerdict;
}

const KEEP_POLLING: ConfirmationTransition = { next: { phase: 'polling' }, verdict: 'continue' };
const TIMED_OUT: ConfirmationTransition = { next: { phase: 'timed-out' }, verdict: 'stop' };

const TRANSITION_BY_ORDER_STATE: Readonly<
  Record<OrderState, (status: OrderStatus) => ConfirmationTransition>
> = {
  RESERVED: () => KEEP_POLLING,
  NONE: () => ({ next: { phase: 'released' }, verdict: 'stop' }),
  CONFIRMED: ({ orderId }) =>
    orderId === null ? KEEP_POLLING : { next: { phase: 'confirmed', orderId }, verdict: 'stop' },
};

export function nextConfirmation(
  answer: OrderStatus | null,
  attemptsMade: number,
): ConfirmationTransition {
  const transition =
    answer === null ? KEEP_POLLING : TRANSITION_BY_ORDER_STATE[answer.status](answer);
  const isBudgetSpent = attemptsMade >= CONFIRMATION_POLL_MAX_ATTEMPTS;
  return transition.verdict === 'continue' && isBudgetSpent ? TIMED_OUT : transition;
}
