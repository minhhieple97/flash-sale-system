import { type ReactElement, useId } from 'react';
import { USER_ID_FORMAT_HINT, validateUserId } from '../utils/user-id-validation.util';

interface UserIdFieldProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

const BASE_INPUT_CLASSES =
  'w-full rounded-xl border bg-slate-50/70 px-4 py-3 text-sm text-slate-900 transition focus:bg-white focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60';
const NORMAL_INPUT_CLASSES = 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-100';
const INVALID_INPUT_CLASSES = 'border-amber-400 focus:border-amber-500 focus:ring-amber-100';

export function UserIdField({ value, onChange, disabled }: UserIdFieldProps): ReactElement {
  const inputId = useId();
  const hintId = useId();
  const isInvalid = validateUserId(value) === 'invalid';

  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700">
        User ID (username or email)
      </label>
      <input
        id={inputId}
        value={value}
        disabled={disabled}
        aria-describedby={hintId}
        aria-invalid={isInvalid ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        placeholder="e.g. alice@example.com or john_doe"
        className={`${BASE_INPUT_CLASSES} ${isInvalid ? INVALID_INPUT_CLASSES : NORMAL_INPUT_CLASSES}`}
      />
      <p
        id={hintId}
        className={`mt-1.5 text-xs ${isInvalid ? 'text-amber-700' : 'text-slate-500'}`}
      >
        {isInvalid ? `Invalid format — ${USER_ID_FORMAT_HINT}` : USER_ID_FORMAT_HINT}
      </p>
    </div>
  );
}
