import { Component } from "react";

export default class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, details) {
    console.error("Ledgify interface error", error, details);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="application-error-state" role="alert">
      <div>
        <span>Something went wrong</span>
        <h1>This page could not be displayed</h1>
        <p>Your data has not been changed. Reload the application or return to the dashboard.</p>
        <div><button type="button" className="page-primary-button" onClick={() => window.location.reload()}>Reload application</button><a className="invoice-secondary-button" href="/">Return to dashboard</a></div>
      </div>
    </main>;
  }
}
