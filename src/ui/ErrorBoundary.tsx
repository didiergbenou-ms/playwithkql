import { Component, type ErrorInfo, type ReactNode } from 'react';
import { GameplayLoadError } from '../game/GameplayLoadError';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence. A thrown render error used to leave the player staring
 * at a black screen with no way back; now they get the error and a reset.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[KQL Quest] render error', error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="screen">
        <div className="panel" style={{ maxWidth: 720, margin: '0 auto' }}>
          <span className="tag tag-amber">SOMETHING BROKE</span>
          <h1>The Kingdom lost the thread</h1>
          <p className="muted">
            An error stopped the page rendering. Your profile and achievements are safe.
          </p>
          <pre className="caret" style={{ whiteSpace: 'pre-wrap' }}>
            {error.message}
          </pre>
          <div className="brief-actions">
            <button className="ghost" onClick={() => window.location.reload()}>
              Reload
            </button>
            {!(error instanceof GameplayLoadError) && (
              <button className="primary big" onClick={this.reset}>
                Back to HQ
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
