import { type ReactElement, type ReactNode, useId } from 'react';

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, children, className = '' }: CardProps): ReactElement {
  const titleId = useId();
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_35px_-20px_rgba(15,23,42,0.18)] sm:p-6 ${className}`}
    >
      {title ? (
        <h2 id={titleId} className="mb-5 text-lg font-bold tracking-tight text-slate-900">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}
