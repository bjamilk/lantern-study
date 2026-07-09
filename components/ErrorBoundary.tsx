import React, { Component, ErrorInfo, ReactNode } from 'react';
import { captureException } from '../services/sentry';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  const msg = error.message || '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module')
  );
}

function isReactHooksError(error: Error | null): boolean {
  if (!error) return false;
  const msg = error.message || '';
  return (
    /Minified React error #30[0-9]/.test(msg) ||
    /Rendered (more|fewer) hooks than/.test(msg) ||
    /Invalid hook call/.test(msg)
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
    captureException(error, { componentStack: info.componentStack ?? undefined });
    this.props.onError?.(error, info);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const chunkError = isChunkLoadError(this.state.error);
      const hooksError = isReactHooksError(this.state.error);
      const shouldReload = chunkError || hooksError;

      return (
        <div className="min-h-[200px] flex flex-col items-center justify-center p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {shouldReload ? 'New version available' : 'Something went wrong'}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-md">
            {shouldReload
              ? 'The app was updated. Reload to get the latest version and continue.'
              : this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={shouldReload ? this.handleReload : this.handleRetry}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700"
          >
            {shouldReload ? 'Reload' : 'Try again'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
