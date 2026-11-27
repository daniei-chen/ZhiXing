import { useRef, useState } from 'react';
import { Modal } from './ui.jsx';
import './agent-question.css';

export function AgentQuestion({ request, onAnswer, inline = false, onStop, count = 1 }) {
  const [answers, setAnswers] = useState(() =>
    Object.fromEntries(
      request.questions.map((question) => [
        question.id,
        { id: question.id, selected: [], custom: '' },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  async function submit(cancelled = false) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await onAnswer({
        requestId: request.requestId,
        cancelled,
        answers: Object.values(answers).map(({ custom, ...answer }) => ({
          ...answer,
          ...(custom.trim() ? { custom: custom.trim() } : {}),
        })),
      });
    } catch (cause) {
      setError(cause.message);
      submitting.current = false;
      setBusy(false);
    }
  }

  const form = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="agent-question-fields">
        {request.questions.map((question) => (
          <fieldset className="agent-question" key={question.id}>
            <legend>{question.question}</legend>
            {question.detail && <pre className="question-detail">{question.detail}</pre>}
            {question.options?.map((option) => (
              <label key={option.label}>
                <input
                  type={question.multiSelect ? 'checkbox' : 'radio'}
                  name={question.id}
                  checked={answers[question.id].selected.includes(option.label)}
                  disabled={busy}
                  onChange={(event) =>
                    setAnswers((previous) => ({
                      ...previous,
                      [question.id]: {
                        ...previous[question.id],
                        selected: question.multiSelect
                          ? event.target.checked
                            ? [...previous[question.id].selected, option.label]
                            : previous[question.id].selected.filter(
                                (label) => label !== option.label,
                              )
                          : [option.label],
                      },
                    }))
                  }
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
              </label>
            ))}
            <textarea
              aria-label={`补充：${question.question}`}
              rows={2}
              maxLength={4000}
              placeholder="补充说明（可选）"
              disabled={busy}
              value={answers[question.id].custom}
              onChange={(event) =>
                setAnswers((previous) => ({
                  ...previous,
                  [question.id]: { ...previous[question.id], custom: event.target.value },
                }))
              }
            />
          </fieldset>
        ))}
      </div>
      {error && (
        <p className="callout bad" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        {inline && onStop && (
          <button type="button" className="secondary-button" onClick={() => void onStop()}>
            停止任务
          </button>
        )}
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void submit(true)}
        >
          跳过
        </button>
        <button className="primary-button" disabled={busy}>
          {busy ? '正在继续…' : '提交并继续'}
        </button>
      </div>
    </form>
  );

  if (inline)
    return (
      <section className="agent-question-inline" aria-label="需要你补充">
        <header>
          <h2>需要你补充</h2>
          {count > 1 && <span>{count} 项待回答</span>}
        </header>
        {form}
      </section>
    );
  return (
    <Modal title="需要你补充" onClose={() => submit(true)} className="agent-question-modal">
      {form}
    </Modal>
  );
}
