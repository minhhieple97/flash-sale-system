import type { ReactElement, ReactNode } from 'react';
import type { Tone } from '../types/tone.types';

interface AlertProps {
  tone: Tone;
  title: string;
  children?: ReactNode;
}

const ALERT_TONE_CLASSES: Readonly<Record<Tone, string>> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-800',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-rose-200 bg-rose-50 text-rose-900',
};

const ASSERTIVE_TONES: ReadonlySet<Tone> = new Set<Tone>(['warning', 'danger']);

export function Alert({ tone, title, children }: AlertProps): ReactElement {
  return (
    <div
      role={ASSERTIVE_TONES.has(tone) ? 'alert' : 'status'}
      className={`rounded-xl border px-4 py-3 text-sm ${ALERT_TONE_CLASSES[tone]}`}
    >
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}
