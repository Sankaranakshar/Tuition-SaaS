import { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
    // Same lazy-load reasoning as main.tsx: don't ship or fetch @sentry/react
    // when there's no DSN to report to (HANDOFF §7, docs/OPTIMIZATION_AUDIT.md
    // finding H5). An error boundary firing is already an exceptional path,
    // so the dynamic import here costs nothing in the normal case.
    if (import.meta.env.VITE_SENTRY_DSN) {
      import("@sentry/react").then((Sentry) => {
        Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
      });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center px-6">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-4">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
          <p className="mt-1 text-sm text-gray-500 max-w-sm">
            This page hit an error loading data. Try again, or come back in a moment.
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-5 px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
