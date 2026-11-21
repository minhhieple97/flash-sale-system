import type { ReactElement } from 'react';

interface CheckoutActionsProps {
  canBuy: boolean;
  isSubmitting: boolean;
  onRandomUser: () => void;
}

const BUTTON_BASE = 'rounded-xl px-4 py-2.5 text-sm font-semibold transition';
const BUY_BUTTON_CLASSES = `${BUTTON_BASE} bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none aria-busy:animate-pulse`;
const RANDOM_BUTTON_CLASSES = `${BUTTON_BASE} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

export function CheckoutActions({
  canBuy,
  isSubmitting,
  onRandomUser,
}: CheckoutActionsProps): ReactElement {
  return (
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={onRandomUser} className={RANDOM_BUTTON_CLASSES}>
        Random Test User
      </button>
      <button
        type="submit"
        disabled={!canBuy}
        aria-busy={isSubmitting}
        className={BUY_BUTTON_CLASSES}
      >
        Buy Now
      </button>
    </div>
  );
}
