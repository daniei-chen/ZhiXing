import { ArrowsOutSimple, ArrowLeft, CircleNotch } from '@phosphor-icons/react';
import { FileCoverage } from './FileCoverage.jsx';
import { deliverableName } from './deliverable-cards.js';
import { IconButton } from './ui.jsx';
import './delivery-preview.css';

const PREVIEW_CHARACTERS = 12000;

export function DeliveryPreview({ preview, onBack, onRetry, onEnlarge }) {
  const ready = preview.status === 'ready';
  const material = preview.material;
  const name = material?.name || deliverableName(preview.file);
  const text = ready ? material.text : '';
  const size = Number.isFinite(material?.size) ? material.size : null;
  return (
    <div
      className="delivery-preview"
      aria-label="交付文件预览"
      aria-busy={preview.status === 'loading'}
    >
      <header className="delivery-preview-heading">
        <IconButton icon={ArrowLeft} label="返回产出列表" onClick={onBack} />
        <strong title={name}>{name}</strong>
        {ready && (
          <button type="button" className="secondary-button" onClick={() => onEnlarge(material)}>
            <ArrowsOutSimple size={14} aria-hidden="true" />
            放大预览
          </button>
        )}
      </header>
      {preview.status === 'loading' && (
        <p className="workbench-loading" role="status">
          <CircleNotch size={16} aria-hidden="true" />
          正在本机读取交付文件…
        </p>
      )}
      {preview.status === 'failed' && (
        <div className="delivery-preview-failure">
          <p className="workbench-error" role="alert">
            {preview.error}
          </p>
          <button type="button" className="secondary-button" onClick={onRetry}>
            重试预览
          </button>
        </div>
      )}
      {ready && (
        <div className="delivery-preview-content" key={preview.request}>
          <p className="delivery-preview-meta">
            本机提取文字{size === null ? '' : ` · ${(size / 1024).toFixed(1)} KB`}
          </p>
          <FileCoverage file={material} />
          {text ? (
            <pre className="delivery-preview-text">{text.slice(0, PREVIEW_CHARACTERS)}</pre>
          ) : (
            <p className="muted">未提取到可预览的文字。</p>
          )}
          {text.length > PREVIEW_CHARACTERS && (
            <p className="delivery-preview-limit">仅预览前 12,000 字符。</p>
          )}
        </div>
      )}
    </div>
  );
}
