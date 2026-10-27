import { Component } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

// Catches unexpected rendering errors so one broken screen never blanks the
// whole app. `resetKey` (the current path) clears the error on navigation.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ui] Unexpected error:', error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
        <div className="rounded-full bg-amber-50 p-3 text-amber-600">
          <AlertTriangle className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-bold text-navy-900">This page hit a problem</h1>
        <p className="mt-1 text-sm text-slate-500">Your data is safe. Reload the page or go back to the start.</p>
        <div className="mt-6 flex gap-2">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Reload
          </button>
          <a href="/" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Home className="h-4 w-4" aria-hidden /> Home
          </a>
        </div>
      </div>
    );
  }
}
