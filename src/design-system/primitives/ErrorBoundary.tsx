// src/design-system/primitives/ErrorBoundary.tsx — Phase 9 Plan 09-02 (D-215, D-218).
//
// Class-based React error boundary. React 19 still has no functional error hook,
// so class is the only way to catch render-time errors from descendants.
//
// Recovery UX (planner-chosen per D-215): three buttons.
//   - "Reset route"        → clears local error state in place (same-route retry)
//   - "Back to dashboard"  → sets window.location.hash for router-free navigation (D-05)
//   - "Copy error"         → writes error.name + message + componentStack to clipboard
//
// Reset semantics (D-218): navigating to a different route changes the `resetKey`
// prop; componentDidUpdate clears the captured error so the next route renders
// cleanly. This ensures one crashed route cannot poison navigation elsewhere.
//
// @see .planning/phases/09-polish/09-PATTERNS.md §1

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { GlassPanel } from './GlassPanel';
import { Button } from './Button';

interface ErrorBoundaryProps {
  /** Children to guard. */
  children: ReactNode;
  /** When this value changes, the boundary resets (e.g., route id). */
  resetKey?: string;
  /** Called when the boundary catches; for logging/analytics. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
    // Dev visibility; production consumers can wire onError → analytics.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, info: null });
    }
  }

  private handleReset = (): void => {
    this.setState({ error: null, info: null });
  };

  private handleCopy = (): void => {
    const { error, info } = this.state;
    if (!error) return;
    const text = `${error.name}: ${error.message}\n\n${info?.componentStack ?? ''}`;
    void navigator.clipboard.writeText(text);
  };

  private handleHome = (): void => {
    // Router-free navigation via URL hash (D-05 contract).
    window.location.hash = '#/dashboard';
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <GlassPanel
        tier={1}
        role="alert"
        aria-label="Route error — recovery affordances below"
        style={{ margin: 'var(--s-8) auto', maxWidth: 560, padding: 'var(--s-8)' }}
      >
        <h2 className="t-h2" style={{ margin: 0 }}>Something broke in this route.</h2>
        <p className="t-body" style={{ color: 'var(--t-2)', marginTop: 'var(--s-3)' }}>
          {this.state.error.message}
        </p>
        <div style={{ display: 'flex', gap: 'var(--s-3)', marginTop: 'var(--s-5)' }}>
          <Button onClick={this.handleReset}>Reset route</Button>
          <Button onClick={this.handleHome}>Back to dashboard</Button>
          <Button onClick={this.handleCopy}>Copy error</Button>
        </div>
      </GlassPanel>
    );
  }
}
