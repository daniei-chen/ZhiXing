import { useEffect, useId, useRef, useState } from 'react';
import { runtimeApprovals } from './runtime-approvals.js';
import './approval-panel.css';

function ApprovalRequest({ hostEpoch, request, connection, onAnswer, onRefresh }) {
  const [phase, setPhase] = useState('idle');
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(true);
  const waiting = useRef(false);
  const composing = useRef(false);
  const compositionEnded = useRef(false);
  const descriptionId = useId();
  const detail = request.presentation;
  const disabled = connection !== 'ready' || ['submitting', 'syncing', 'stale'].includes(phase);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function decide(outcome) {
    if (waiting.current || disabled) return;
    waiting.current = true;
    setPhase('submitting');
    try {
      const result = await onAnswer({
        hostEpoch,
        requestId: request.requestId,
        runId: request.runId,
        rootSessionId: request.rootSessionId,
        outcome,
      });
      if (active.current) setPhase(result?.accepted === true ? 'syncing' : 'stale');
    } catch {
      if (active.current) {
        waiting.current = false;
        setPhase('failed');
      }
    }
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
      if (active.current && !['submitting', 'syncing'].includes(phase)) {
        waiting.current = false;
        setPhase('idle');
      }
    } catch {
      if (active.current) setPhase('failed');
    } finally {
      if (active.current) setRefreshing(false);
    }
  }

  function keydown(event) {
    const element = event.target;
    if (
      event.defaultPrevented ||
      !event.currentTarget.contains(document.activeElement) ||
      element.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') ||
      !['Enter', 'Escape'].includes(event.key) ||
      (event.key === 'Enter' && element.closest('button, a[href], [role="button"]')) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (
      event.repeat ||
      composing.current ||
      compositionEnded.current ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    ) {
      return;
    }
    void decide(event.key === 'Enter' ? 'allowed-once' : 'rejected');
  }

  const notice =
    phase === 'submitting'
      ? '正在提交决定…'
      : phase === 'syncing'
        ? '主机已收到决定，正在同步操作状态…'
        : phase === 'stale'
          ? '这项请求已结束或发生变化，请同步待批准操作。'
          : phase === 'failed'
            ? '决定尚未确认，请同步状态后重试。'
            : connection !== 'ready'
              ? '待批准操作暂未同步，请刷新后再决定。'
              : '';

  return (
    <div
      className="approval-request"
      data-approval-request={request.requestId}
      aria-busy={phase === 'submitting'}
      onKeyDown={keydown}
      onKeyUpCapture={() => {
        compositionEnded.current = false;
      }}
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
        compositionEnded.current = true;
      }}
    >
      <div className="approval-detail" role="group" aria-label="待批准操作详情" tabIndex={0}>
        {request.sourceSessionId !== request.rootSessionId && (
          <p className="approval-origin">子任务请求</p>
        )}
        <p className="approval-operation">{detail.operation}</p>
        <dl className="approval-fields">
          <dt>操作对象</dt>
          <dd>
            <pre data-approval-field="path">{detail.path}</pre>
          </dd>
          {detail.command !== undefined && (
            <>
              <dt>待执行命令</dt>
              <dd>
                <pre data-approval-field="command">{detail.command}</pre>
              </dd>
            </>
          )}
          {detail.network !== undefined && (
            <>
              <dt>联网范围</dt>
              <dd>
                <pre data-approval-field="network">{detail.network}</pre>
              </dd>
            </>
          )}
        </dl>
        {detail.overwrite && <p className="approval-overwrite">此操作会覆盖已有文件。</p>}
        <p className="approval-policy" id={descriptionId}>
          {detail.command !== undefined
            ? '命令可访问项目外文件和网络，请核对后批准。'
            : detail.network !== undefined
              ? '仅批准本次联网操作。'
              : '只批准本次操作，不改变权限模式。'}
        </p>
      </div>
      {notice && (
        <div className="approval-notice" role="status">
          <span>{notice}</span>
          {phase !== 'submitting' && (
            <button type="button" disabled={refreshing} onClick={() => void refresh()}>
              {refreshing ? '正在同步…' : '同步状态'}
            </button>
          )}
        </div>
      )}
      <div className="approval-decisions" aria-describedby={descriptionId}>
        <button type="button" disabled={disabled} onClick={() => void decide('rejected')}>
          拒绝
        </button>
        <button
          type="button"
          className="approval-allow"
          disabled={disabled}
          onClick={() => void decide('allowed-once')}
        >
          仅允许本次
        </button>
      </div>
    </div>
  );
}

export function ApprovalPanel({
  hostEpoch,
  requests = [],
  connection = 'ready',
  onAnswer = runtimeApprovals.answer,
  onRefresh = runtimeApprovals.refresh,
  onStop,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [stopping, setStopping] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  const active = useRef(true);
  const headingId = useId();
  const selected = requests.find((request) => request.requestId === selectedId) || requests[0];
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function stop() {
    if (stopping || !onStop) return;
    setStopping(true);
    setStopFailed(false);
    try {
      await onStop();
    } catch {
      if (active.current) setStopFailed(true);
    } finally {
      if (active.current) setStopping(false);
    }
  }

  if (!selected) return null;
  return (
    <section className="approval-panel" aria-labelledby={headingId}>
      <header className="approval-heading">
        <h2 id={headingId}>等待你批准</h2>
        <span>{requests.length} 项待批准</span>
      </header>
      {requests.length > 1 && (
        <nav className="approval-queue" aria-label="选择待批准操作">
          {requests.map((request, index) => (
            <button
              type="button"
              key={request.requestId}
              aria-pressed={request.requestId === selected.requestId}
              onClick={() => setSelectedId(request.requestId)}
            >
              操作 {index + 1}
            </button>
          ))}
        </nav>
      )}
      <ApprovalRequest
        key={`${hostEpoch}:${selected.requestId}`}
        hostEpoch={hostEpoch}
        request={selected}
        connection={connection}
        onAnswer={onAnswer}
        onRefresh={onRefresh}
      />
      {onStop && (
        <div className="approval-stop">
          <button type="button" disabled={stopping} onClick={() => void stop()}>
            {stopping ? '正在请求停止…' : '停止本次任务'}
          </button>
          {stopFailed && <span role="status">停止状态尚未确认，请重试。</span>}
        </div>
      )}
    </section>
  );
}
