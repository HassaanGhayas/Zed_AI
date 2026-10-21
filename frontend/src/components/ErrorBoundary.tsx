import React from 'react';
import { clearPersistedSession } from '../lib/persistence';

interface ErrorBoundaryState {
  error: Error | null;
}

/** Top-level safety net: shows a friendly reset screen instead of a blank page. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  // A corrupt saved session can crash on restore, so offer a clean start.
  private handleReset = () => {
    clearPersistedSession();
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="min-h-screen flex items-center justify-center bg-surface text-ink p-6"
      >
        <div className="max-w-md w-full bg-raised border border-line-soft rounded-lg p-6 shadow-pop text-center">
          <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm text-ink-muted mb-6">
            Studify hit an unexpected error. You can reload the page, or reset your saved session if
            the problem keeps happening.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={this.handleReload}
              className="px-4 py-2 min-h-[44px] text-sm font-semibold rounded-md bg-accent hover:bg-accent-hover text-on-accent transition-colors cursor-pointer"
            >
              Reload
            </button>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 min-h-[44px] text-sm font-semibold rounded-md bg-sunken hover:bg-line-soft text-ink-muted border border-line transition-colors cursor-pointer"
            >
              Reset saved session
            </button>
          </div>
        </div>
      </div>
    );
  }
}
