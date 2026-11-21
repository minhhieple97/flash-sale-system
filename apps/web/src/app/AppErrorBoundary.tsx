import { Component, type ReactNode } from 'react';
import { Alert } from '@/shared/components/Alert';

interface AppErrorBoundaryProps {
  children: ReactNode;
  onReload?: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

function reloadPage(): void {
  window.location.reload();
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    const onReload = this.props.onReload ?? reloadPage;
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <Alert tone="danger" title="Something went wrong">
          <p>The storefront hit an unexpected error. Reloading usually fixes it.</p>
          <button
            type="button"
            onClick={onReload}
            className="mt-3 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
          >
            Reload page
          </button>
        </Alert>
      </main>
    );
  }
}
