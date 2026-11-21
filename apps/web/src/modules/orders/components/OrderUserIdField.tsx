import { type ReactElement, useId } from 'react';

interface OrderUserIdFieldProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

export function OrderUserIdField({
  value,
  onChange,
  disabled,
}: OrderUserIdFieldProps): ReactElement {
  const inputId = useId();
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700">
        User ID
      </label>
      <input
        id={inputId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  );
}
