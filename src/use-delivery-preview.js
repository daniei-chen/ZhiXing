import { useLayoutEffect, useRef, useState } from 'react';
import { errorText } from './error-copy.js';

// This state is deliberately transient. Previewing a file does not attach it to
// a prompt, add it to the document library, or write its contents to a chat.
export function useDeliveryPreview({ api, context, scopeKey }) {
  const [preview, setPreview] = useState(null);
  const generation = useRef(0);
  const scope = useRef(scopeKey);
  const live = useRef(false);

  useLayoutEffect(() => {
    live.current = true;
    scope.current = scopeKey;
    setPreview(null);
    return () => {
      live.current = false;
      generation.current += 1;
    };
  }, [scopeKey]);

  function close() {
    generation.current += 1;
    setPreview(null);
  }

  async function open(file) {
    const request = ++generation.current;
    const current = () =>
      live.current && scope.current === scopeKey && generation.current === request;
    const requestedFile = { path: file?.path, name: file?.name, description: file?.description };
    const snapshot = { ...context };
    setPreview({ status: 'loading', scopeKey, request, file: requestedFile });
    try {
      if (!api?.listDeliverables || !api?.readDeliverable || !snapshot.sessionId) {
        throw new Error('交付预览需要在桌面版的所属会话中打开。');
      }
      const references = await api.listDeliverables(snapshot);
      // Navigation, closing the panel, or a newer click can invalidate the list
      // request itself. Do not start a file read after any of those transitions.
      if (!current()) return;
      const reference = references.findLast((item) => item.path === requestedFile.path);
      if (!reference?.available || !reference.id) {
        throw new Error(
          reference?.reason || '没有找到可核验的原生交付记录，请在原会话中重新交付。',
        );
      }
      const parsed = await api.readDeliverable({ ...snapshot, id: reference.id });
      if (!current()) return;
      const material = {
        ...parsed,
        status: 'ready',
        text: typeof parsed.text === 'string' ? parsed.text : '',
        size: parsed.size ?? reference.size,
      };
      setPreview({ status: 'ready', scopeKey, request, file: requestedFile, material });
    } catch (error) {
      if (current()) {
        setPreview({
          status: 'failed',
          scopeKey,
          request,
          file: requestedFile,
          error: `打开交付文件失败：${errorText(error)}`,
        });
      }
    }
  }

  const currentPreview = preview?.scopeKey === scopeKey ? preview : null;
  return {
    preview: currentPreview,
    open,
    close,
    retry() {
      if (currentPreview) return open(currentPreview.file);
    },
  };
}
