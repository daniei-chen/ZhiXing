import { useLayoutEffect, useRef } from 'react';
import {
  ChartBar,
  ChatCircle,
  CircleNotch,
  FileCode,
  Files,
  FileText,
  FolderOpen,
  Globe,
  TerminalWindow,
} from '@phosphor-icons/react';
import './workbench-tabs.css';

export const workbenchPages = [
  { id: 'browser', label: '浏览器', icon: Globe },
  { id: 'files', label: '文件', icon: FolderOpen },
  { id: 'terminal', label: '终端', icon: TerminalWindow },
  { id: 'chat', label: '侧边聊天', icon: ChatCircle },
  { id: 'activity', label: '执行', icon: CircleNotch },
  { id: 'review', label: '改动', icon: FileCode },
  { id: 'deliverables', label: '产出', icon: Files },
  { id: 'stats', label: '统计', icon: ChartBar },
  { id: 'details', label: '详情', icon: FileText },
];

export function WorkbenchTabs({ page, setPage, idPrefix, visible }) {
  const list = useRef(null);
  const tabs = useRef(new Map());

  function reveal(tab) {
    const container = list.current;
    if (!container || !tab || container.clientWidth === 0) return;
    const viewport = container.getBoundingClientRect();
    const bounds = tab.getBoundingClientRect();
    // Scroll only this strip. scrollIntoView would also move the chat or window.
    if (bounds.left < viewport.left) container.scrollLeft += bounds.left - viewport.left;
    else if (bounds.right > viewport.right) container.scrollLeft += bounds.right - viewport.right;
  }

  useLayoutEffect(() => {
    if (!visible) return;
    const update = () => reveal(tabs.current.get(page));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list.current);
    return () => observer.disconnect();
  }, [page, visible]);

  function navigate(event, index) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % workbenchPages.length;
    else if (event.key === 'ArrowLeft')
      next = (index - 1 + workbenchPages.length) % workbenchPages.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = workbenchPages.length - 1;
    else return;
    event.preventDefault();
    const id = workbenchPages[next].id;
    setPage(id);
    const tab = tabs.current.get(id);
    tab?.focus({ preventScroll: true });
    reveal(tab);
  }

  return (
    <div
      className="workbench-tablist"
      role="tablist"
      aria-label="工作面板视图"
      aria-orientation="horizontal"
      ref={list}
    >
      {workbenchPages.map(({ id, label, icon: Icon }, index) => (
        <button
          key={id}
          type="button"
          className="workbench-tab"
          role="tab"
          id={`${idPrefix}-tab-${id}`}
          aria-controls={`${idPrefix}-panel-${id}`}
          aria-selected={page === id}
          tabIndex={page === id ? 0 : -1}
          data-workbench-page={id}
          ref={(node) => {
            if (node) tabs.current.set(id, node);
            else tabs.current.delete(id);
          }}
          onClick={() => setPage(id)}
          onFocus={(event) => reveal(event.currentTarget)}
          onKeyDown={(event) => navigate(event, index)}
        >
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
