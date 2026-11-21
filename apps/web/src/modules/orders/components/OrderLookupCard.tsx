import { type FormEvent, type ReactElement, useState } from 'react';
import { Card } from '@/shared/components/Card';
import { useOrderLookup } from '../hooks/use-order-lookup';
import { OrderLookupResult } from './OrderLookupResult';
import { OrderUserIdField } from './OrderUserIdField';

const SUBMIT_CLASSES =
  'rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none';

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
        <OrderUserIdField value={userId} onChange={setUserId} />
        <button
          type="submit"
          disabled={!canLookup}
          aria-busy={isLoading}
          className={SUBMIT_CLASSES}
        >
          Check order
        </button>
      </form>
      <div className="mt-4">
        <OrderLookupResult state={state} />
      </div>
    </Card>
  );
}
