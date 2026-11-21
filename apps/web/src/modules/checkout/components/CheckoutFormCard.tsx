import { type FormEvent, type ReactElement, useState } from 'react';
import type { SaleState } from '@/modules/flash-sale';
import { useOrderConfirmationPoller } from '@/modules/orders';
import { Card } from '@/shared/components/Card';
import { BUY_DISABLED_REASON, BUY_DISABLED_REASON_UNKNOWN } from '../constants/checkout.constants';
import { usePurchaseAttempt } from '../hooks/use-purchase-attempt';
import { generateTestUserId } from '../utils/test-user-id.util';
import { CheckoutActions } from './CheckoutActions';
import { CheckoutFeedbackBanner } from './CheckoutFeedbackBanner';
import { UserIdField } from './UserIdField';

interface CheckoutFormCardProps {
  saleState: SaleState | null;
}

function disabledReason(saleState: SaleState | null): string | null {
  return saleState === null ? BUY_DISABLED_REASON_UNKNOWN : BUY_DISABLED_REASON[saleState];
}

export function CheckoutFormCard({ saleState }: CheckoutFormCardProps): ReactElement {
  const [userId, setUserId] = useState('');
  const { state, submit } = usePurchaseAttempt();
  const confirmation = useOrderConfirmationPoller(
    state.status === 'success' ? state.data.userId : null,
  );
  const reason = disabledReason(saleState);
  const isSubmitting = state.status === 'loading';
  const canBuy = reason === null && !isSubmitting && userId.trim() !== '';

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (canBuy) void submit(userId);
  };

  return (
    <Card title="Checkout">
      <form onSubmit={handleSubmit} className="space-y-4">
        <UserIdField value={userId} onChange={setUserId} disabled={isSubmitting} />
        <CheckoutActions
          canBuy={canBuy}
          isSubmitting={isSubmitting}
          onRandomUser={() => setUserId(generateTestUserId())}
        />
        {isSubmitting ? (
          <span role="status" className="sr-only">
            Processing your purchase
          </span>
        ) : null}
        {reason ? <p className="text-sm text-slate-600">{reason}</p> : null}
      </form>
      <div className="mt-4">
        <CheckoutFeedbackBanner state={state} confirmation={confirmation} />
      </div>
    </Card>
  );
}
