import type { ReactElement } from 'react';
import { Alert } from '@/shared/components/Alert';
import type { AsyncState } from '@/shared/types/async-state.types';
import { LOOKUP_FAILED_TITLE, LOOKUP_PRESENTATION } from '../constants/orders.constants';
import type { OrderStatus } from '../types/orders.types';
import { OrderReceiptBadge } from './OrderReceiptBadge';

interface OrderLookupResultProps {
  state: AsyncState<OrderStatus>;
}

export function OrderLookupResult({ state }: OrderLookupResultProps): ReactElement | null {
  if (state.status === 'error') {
    return (
      <Alert tone="danger" title={LOOKUP_FAILED_TITLE}>
        {state.error.message}
      </Alert>
    );
  }
  if (state.status !== 'success') return null;
  const { orderId, status, userId } = state.data;
  const { tone, title } = LOOKUP_PRESENTATION[status];
  const isConfirmed = status === 'CONFIRMED' && orderId !== null;
  return (
    <Alert tone={tone} title={title(userId)}>
      {isConfirmed ? <OrderReceiptBadge orderId={orderId} userId={userId} /> : null}
      {!isConfirmed && orderId ? <p className="font-mono text-xs">Order {orderId}</p> : null}
    </Alert>
  );
}
