import type { ReactElement } from 'react';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

interface CheckoutActionsProps {
  canBuy: boolean;
  isSubmitting: boolean;
  onRandomUser: () => void;
}

const BUTTON_BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';
const BUY_BUTTON_CLASSES = `${BUTTON_BASE} min-w-36 bg-indigo-600 text-white shadow-md shadow-indigo-200 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none`;
const RANDOM_BUTTON_CLASSES = `${BUTTON_BASE} border border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50`;

export function CheckoutActions({
  canBuy,
  isSubmitting,
  onRandomUser,
}: CheckoutActionsProps): ReactElement {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={onRandomUser}
        disabled={isSubmitting}
        className={RANDOM_BUTTON_CLASSES}
      >
        Random Test User
      </button>
      <button
        type="submit"
        disabled={!canBuy}
        aria-label="Buy Now"
        aria-busy={isSubmitting}
        className={BUY_BUTTON_CLASSES}
      >
        {isSubmitting ? (
          <>
            <LoadingSpinner /> Processing...
          </>
        ) : (
          'Buy Now'
        )}
      </button>
    </div>
  );
}
