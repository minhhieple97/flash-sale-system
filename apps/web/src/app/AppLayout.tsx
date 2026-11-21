import type { ReactElement, ReactNode } from 'react';

interface AppLayoutProps {
  children: ReactNode;
  footer: ReactNode;
}

export function AppLayout({ children, footer }: AppLayoutProps): ReactElement {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 pb-44">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Flash Sale</h1>
          <p className="mt-1 text-sm text-slate-600">
            One limited-edition drop. One unit per customer. Be quick.
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">{children}</main>
      {footer}
    </div>
  );
}
