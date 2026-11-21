import type { ReactElement } from 'react';

interface OrderReceiptBadgeProps {
  orderId: string;
  userId: string;
}

export function OrderReceiptBadge({ orderId, userId }: OrderReceiptBadgeProps): ReactElement {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-emerald-300 bg-white p-4 shadow-sm">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-9 shrink-0 rounded-full bg-emerald-600 p-2 text-white"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <div className="min-w-0">
        <p className="font-semibold text-emerald-900">Verified receipt</p>
        <dl className="mt-2 space-y-1 text-xs text-slate-600">
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-slate-500">Order ID</dt>
            <dd className="break-all font-mono text-slate-900">{orderId}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-slate-500">User</dt>
            <dd className="break-all text-slate-900">{userId}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
