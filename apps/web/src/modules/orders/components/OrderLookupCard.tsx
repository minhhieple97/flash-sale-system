import { type FormEvent, type ReactElement, useState } from 'react';
import { Card } from '@/shared/components/Card';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { UserIdField } from '@/shared/components/UserIdField';
import { useOrderLookup } from '../hooks/use-order-lookup';
import { OrderLookupResult } from './OrderLookupResult';

const SUBMIT_CLASSES =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60';

export function OrderLookupCard(): ReactElement {
  const [userId, setUserId] = useState('');
  const { state, lookup } = useOrderLookup();
  const isLoading = state.status === 'loading';
  const canLookup = userId.trim() !== '' && !isLoading;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (canLookup) void lookup(userId);
  };

  return (
    <Card title="Order lookup">
      <form onSubmit={handleSubmit} className="space-y-4">
        <UserIdField value={userId} onChange={setUserId} disabled={isLoading} />
        <button
          type="submit"
          disabled={!canLookup}
          aria-label="Check order"
          aria-busy={isLoading}
          className={SUBMIT_CLASSES}
        >
          {isLoading ? <LoadingSpinner /> : null}
          {isLoading ? 'Checking...' : 'Check order'}
        </button>
        {isLoading ? (
          <span role="status" className="sr-only">
            Checking your order
          </span>
        ) : null}
      </form>
      <div className="mt-4">
        <OrderLookupResult state={state} />
      </div>
    </Card>
  );
}
