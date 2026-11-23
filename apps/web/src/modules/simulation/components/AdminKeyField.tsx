import { type ReactElement, useId } from 'react';

interface AdminKeyFieldProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

export function AdminKeyField({ value, disabled, onChange }: AdminKeyFieldProps): ReactElement {
  const inputId = useId();
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <label htmlFor={inputId} className="text-xs font-medium text-slate-700">
        Admin key
      </label>
      <input
        id={inputId}
        type="password"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        placeholder="Enter ADMIN_API_KEY"
        className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-xs"
      />
    </div>
  );
}
