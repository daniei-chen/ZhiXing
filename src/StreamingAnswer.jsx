import { useLayoutEffect } from 'react';
import { AnswerText } from './AnswerText.jsx';
import { useKeyedValue } from './use-keyed-value.js';

export function StreamingAnswer({ store, runId, initialText = '', onOpenUrl, onProgress }) {
  const text = useKeyedValue(store, runId, initialText);
  useLayoutEffect(() => {
    if (text) onProgress?.();
  }, [text, onProgress]);
  return text ? <AnswerText text={text} onOpenUrl={onOpenUrl} /> : null;
}
