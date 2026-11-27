import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DeliveryPreview } from '../../src/DeliveryPreview.jsx';
import { useDeliveryPreview } from '../../src/use-delivery-preview.js';
import '../../src/styles.css';

const calls = [];
const pending = new Map();
const config = { sessionId: 'first-chat', epoch: 0, mounted: true };
const root = createRoot(document.getElementById('root'));
let enlarged;
function request(method, options) {
  const index = calls.push({ method, options }) - 1;
  return new Promise((resolve, reject) => pending.set(index, { resolve, reject }));
}
const api = {
  listDeliverables: (options) => request('list', options),
  readDeliverable: (options) => request('read', options),
};

function Preview({ sessionId, epoch }) {
  const preview = useDeliveryPreview({
    api,
    context: { workspaceId: 'office-home', projectId: 'same-project', sessionId },
    scopeKey: `${sessionId}:${epoch}`,
  });
  const [draft, setDraft] = useState('');
  return (
    <div className="app-shell">
      <textarea aria-label="独立聊天草稿" value={draft} readOnly />
      <button id="edit-draft" onClick={() => setDraft('查看文件时仍可编辑的草稿')}>
        编辑草稿
      </button>
      <button id="open-a" onClick={() => void preview.open({ path: 'C:\\qa\\a.txt' })}>
        打开 A
      </button>
      <button id="open-b" onClick={() => void preview.open({ path: 'C:\\qa\\b.txt' })}>
        打开 B
      </button>
      <button id="close-panel" onClick={preview.close}>
        关闭工作面板
      </button>
      {preview.preview ? (
        <DeliveryPreview
          preview={preview.preview}
          onBack={preview.close}
          onRetry={preview.retry}
          onEnlarge={(material) => {
            enlarged = material;
          }}
        />
      ) : (
        <div id="empty-preview">产出列表</div>
      )}
    </div>
  );
}

function render() {
  flushSync(() =>
    root.render(
      <StrictMode>
        {config.mounted ? <Preview {...config} /> : <div id="unmounted">已卸载</div>}
      </StrictMode>,
    ),
  );
}

window.deliveryQA = {
  get calls() {
    return calls;
  },
  get enlarged() {
    return enlarged;
  },
  configure(next) {
    Object.assign(config, next);
    render();
  },
  click(selector) {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing control: ${selector}`);
    flushSync(() => element.click());
  },
  resolve(index, value) {
    const operation = pending.get(index);
    if (!operation) throw new Error(`Missing pending request ${index}`);
    pending.delete(index);
    operation.resolve(value);
  },
  reject(index, message) {
    const operation = pending.get(index);
    if (!operation) throw new Error(`Missing pending request ${index}`);
    pending.delete(index);
    operation.reject(new Error(message));
  },
  async settle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {});
  },
};
render();
