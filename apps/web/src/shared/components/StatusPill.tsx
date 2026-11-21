import type { ReactElement, ReactNode } from 'react';
import type { Tone } from '../types/tone.types';

interface StatusPillProps {
  tone: Tone;
  children: ReactNode;
}

const PILL_TONE_CLASSES: Readonly<Record<Tone, string>> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-300',
  info: 'bg-sky-100 text-sky-800 ring-sky-300',
  success: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  warning: 'bg-amber-100 text-amber-800 ring-amber-300',
  danger: 'bg-rose-100 text-rose-800 ring-rose-300',
};

const DOT_TONE_CLASSES: Readonly<Record<Tone, string>> = {
  neutral: 'bg-slate-400',
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
};

export function StatusPill({ tone, children }: StatusPillProps): ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${PILL_TONE_CLASSES[tone]}`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${DOT_TONE_CLASSES[tone]}`} />
      {children}
    </span>
  );
}
