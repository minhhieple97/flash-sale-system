import { type ReactElement, useId } from 'react';

interface UserIdFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function UserIdField({ value, onChange }: UserIdFieldProps): ReactElement {
  const inputId = useId();
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700">
        User ID
      </label>
      <input
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
    </div>
  );
}
