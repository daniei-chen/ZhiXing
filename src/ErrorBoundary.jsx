import { Component } from 'react';
import './error-boundary.css';

// React's default caught-error reporter includes the exception and stack.
// Keep renderer diagnostics useful without copying workspace content into logs.
export function reportRenderError(_error, info) {
  const scope = info?.errorBoundary?.props?.scope === 'workbench' ? 'workbench' : 'application';
  console.error('renderer.boundary', { code: 'RENDER_FAILED', scope });
}

export class ErrorBoundary extends Component {
  state = { failed: false, restoring: false, restoreFailed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  restore = async (reload = false) => {
    if (this.state.restoring) return;
    if (this.props.beforeRestore) {
      this.setState({ restoring: true, restoreFailed: false });
      try {
        await this.props.beforeRestore();
      } catch {
        this.setState({ restoring: false, restoreFailed: true });
        return;
      }
    }
    if (reload) window.location.reload();
    else this.setState({ failed: false, restoring: false, restoreFailed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;

    const workbench = this.props.scope === 'workbench';
    const content = (
      <section className="render-error-card" role="alert">
        <h2>{workbench ? '工作面板暂时无法显示' : '界面暂时无法显示'}</h2>
        <p>
          {workbench
            ? '可以重试显示工作面板，当前聊天仍可继续使用。'
            : '请重试显示界面。若仍未恢复，可以重新载入。'}
        </p>
        {this.state.restoreFailed && <p>最后的更改仍未保存，请检查磁盘空间后重试。</p>}
        <div className="render-error-actions">
          <button
            type="button"
            className="render-error-retry"
            disabled={this.state.restoring}
            onClick={() => void this.restore()}
          >
            {this.state.restoring ? '正在保存…' : '重试显示'}
          </button>
          {!workbench && (
            <button
              type="button"
              disabled={this.state.restoring}
              onClick={() => void this.restore(true)}
            >
              重新载入
            </button>
          )}
        </div>
      </section>
    );

    if (workbench) {
      return (
        <aside
          className="workbench render-error-workbench"
          aria-label="工作面板"
          hidden={this.props.hidden}
        >
          {content}
        </aside>
      );
    }

    return <main className="render-error-application">{content}</main>;
  }
}
