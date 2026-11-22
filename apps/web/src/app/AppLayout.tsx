import type { ReactElement, ReactNode } from 'react';

interface AppLayoutProps {
  children: ReactNode;
  footer: ReactNode;
}

export function AppLayout({ children, footer }: AppLayoutProps): ReactElement {
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50/80 via-slate-50 to-white pb-44 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/80 bg-white/90 shadow-sm shadow-slate-200/50 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-xl font-bold text-white shadow-md shadow-indigo-200"
          >
            ✦
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-950">Flash Sale</h1>
            <p className="text-xs text-slate-500 sm:text-sm">
              One limited-edition drop. One unit per customer. Be quick.
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8">
        {children}
      </main>
      {footer}
    </div>
  );
}
