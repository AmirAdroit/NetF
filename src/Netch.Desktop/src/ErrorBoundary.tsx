import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("NetF UI failure", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-error" role="alert">
          <div className="brand-mark"><span>NF</span></div>
          <h1>NetF interface failed safely</h1>
          <p>The engine was not automatically restarted. Reopen NetF from the tray and check Activity logs.</p>
          <pre>{this.state.error.message}</pre>
          <button onClick={() => window.location.reload()} type="button">Reload interface</button>
        </main>
      );
    }
    return this.props.children;
  }
}
