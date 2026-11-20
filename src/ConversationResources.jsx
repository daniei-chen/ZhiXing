import { useLayoutEffect, useMemo, useRef } from 'react';
import { ArrowSquareOut, ArrowUUpLeft, FileText, Globe, ListChecks, Plus, UsersThree, X } from '@phosphor-icons/react';
import { aggregateConversationResources } from './conversation-resources.js';

const listStyle = { maxHeight: 'min(20rem, 35vh)', overflowY: 'auto' };

/**
 * onOpenDeliverable receives the original deliverable file.
 * onOpenSource receives a source record with kind, url/file, and messageId when available.
 * The remaining navigation callbacks take no arguments. Navigation closes the popover.
 */
export function ConversationResources({
  messages = [],
  liveTrace = [],
  running,
  runningTitle,
  onOpenDeliverable,
  onOpenSource,
  onViewActivity,
  onViewFiles,
  onAddSource,
  onReturnToRun,
  onClose,
}) {
  const panel = useRef(null);
  const returnFocus = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const resources = useMemo(() => aggregateConversationResources(messages, liveTrace), [messages, liveTrace]);

  useLayoutEffect(() => {
    returnFocus.current = document.activeElement;
    const first = [...panel.current.querySelectorAll('button:not(:disabled)')]
      .find(button => button.getClientRects().length);
    (first || panel.current).focus({ preventScroll: true });
    function dismissOutside(event) {
      if (returnFocus.current?.contains(event.target)) return;
      if (!panel.current?.contains(event.target)) close.current?.();
    }
    document.addEventListener('click', dismissOutside);
    return () => {
      document.removeEventListener('click', dismissOutside);
      const previous = returnFocus.current;
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus?.({ preventScroll: true });
    };
  }, []);

  function navigate(callback, ...args) {
    if (typeof callback !== 'function') return;
    callback(...args);
    onClose?.();
  }

  function onKeyDown(event) {
    if (event.isComposing || event.nativeEvent?.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = [...panel.current.querySelectorAll('button:not(:disabled)')]
      .filter(button => button.getClientRects().length);
    const first = buttons[0];
    const last = buttons.at(-1);
    if (!first) {
      event.preventDefault();
      panel.current.focus({ preventScroll: true });
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div ref={panel} className="dropdown conversation-resources" role="dialog" aria-label="当前对话产出与来源" tabIndex={-1} onKeyDown={onKeyDown}>
    <header className="resource-header">
      <button type="button" className="resource-close" aria-label="关闭当前对话产出与来源" onClick={() => onClose?.()}>
        <X size={17} aria-hidden="true"/>
      </button>
    </header>
    {running && <button type="button" className="resource-running" disabled={!onReturnToRun} onClick={() => navigate(onReturnToRun)}>
      <ArrowUUpLeft size={17} aria-hidden="true"/>
      <span>返回运行中的任务{runningTitle ? ` · ${runningTitle}` : ''}</span>
    </button>}
    <section className="resource-section" aria-label="输出内容">
      <div className="resource-section-heading">
        <h3>输出内容</h3>
        <button type="button" className="resource-add" aria-label="在文件面板添加或查看输出内容" title="打开文件面板" disabled={!onViewFiles} onClick={() => navigate(onViewFiles)}>
          <Plus size={16} aria-hidden="true"/>
        </button>
      </div>
      {resources.deliverables.length ? <ul className="resource-list resource-outputs" style={listStyle}>
        {resources.deliverables.map(resource => <li className="resource-item" key={resource.id}>
          <button type="button" className="resource-open" disabled={!onOpenDeliverable} onClick={() => navigate(onOpenDeliverable, resource.file)}>
            <FileText size={18} aria-hidden="true"/>
            <span className="resource-copy"><strong>{resource.name}</strong><small>{resource.file.description || resource.file.path}</small></span>
            <ArrowSquareOut size={15} aria-hidden="true"/>
          </button>
        </li>)}
      </ul> : <p className="resource-empty">本对话暂无已记录的文件产出。</p>}
    </section>
    <section className="resource-section" aria-label="来源">
      <div className="resource-section-heading">
        <h3>来源</h3>
        <button type="button" className="resource-add" aria-label="在浏览器中添加来源" title="打开浏览器" disabled={!onAddSource} onClick={() => navigate(onAddSource)}>
          <Plus size={16} aria-hidden="true"/>
        </button>
      </div>
      {resources.sources.length ? <ul className="resource-list resource-sources" style={listStyle}>
        {resources.sources.map(source => {
          const Icon = source.kind === 'web' ? Globe : source.kind === 'activity' ? ListChecks : FileText;
          const description = source.status === 'failed' ? `${source.description} · 失败` : source.description;
          const content = <>
            <Icon size={18} aria-hidden="true"/>
            <span className="resource-copy"><strong>{source.name}</strong><small>{source.url || description}</small>{source.url && <small>{description}</small>}</span>
          </>;
          return <li className="resource-item" key={source.id}>
            {source.kind === 'activity' ? <button type="button" className="resource-open" disabled={!onViewActivity} onClick={() => navigate(onViewActivity)}>
              {content}<span className="resource-action">查看执行</span>
            </button> : source.canOpen ? <button type="button" className="resource-open" disabled={!onOpenSource} onClick={() => navigate(onOpenSource, source)}>
              {content}<ArrowSquareOut size={15} aria-hidden="true"/>
            </button> : <div className="resource-record">{content}</div>}
          </li>;
        })}
      </ul> : <p className="resource-empty">本对话暂无已记录的附件或网页来源。</p>}
    </section>
    <footer className="resource-activity">
      {resources.agents.length > 0 && <button type="button" className="resource-summary" disabled={!onViewActivity} onClick={() => navigate(onViewActivity)}>
        <UsersThree size={16} aria-hidden="true"/>协作子任务 · {resources.agents.length}
      </button>}
      {resources.jobs.length > 0 && <button type="button" className="resource-summary" disabled={!onViewActivity} onClick={() => navigate(onViewActivity)}>
        <ListChecks size={16} aria-hidden="true"/>后台作业 · {resources.jobs.length}
      </button>}
      <button type="button" className="resource-summary" disabled={!onViewActivity} onClick={() => navigate(onViewActivity)}>
        <ListChecks size={16} aria-hidden="true"/>查看执行轨迹
      </button>
    </footer>
  </div>;
}
