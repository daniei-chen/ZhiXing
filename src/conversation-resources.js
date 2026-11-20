const webTools = new Set(['web_search', 'web_fetch']);

function rows(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function fileName(file) {
  return text(file.name) || text(file.path).split(/[\\/]/).at(-1) || '未命名文件';
}

function fileIdentity(value) {
  const path = value.replaceAll('\\', '/');
  return /^(?:[a-z]:\/|\/\/)/i.test(path) ? path.toLowerCase() : path;
}

function webUrl(value) {
  if (!text(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function keepLatest(map, key, value) {
  map.delete(key);
  map.set(key, value);
}

function webTool(event) {
  if (!['tool/call', 'tool/result'].includes(event.type)) return null;
  if (webTools.has(event.toolName)) return event.toolName;
  if (event.category !== 'tools') return null;
  if (/^(?:调用 · )?网页搜索(?: · (?:完成|失败))?$/.test(event.label)) return 'web_search';
  if (/^(?:调用 · )?读取网页(?: · (?:完成|失败))?$/.test(event.label)) return 'web_fetch';
  return null;
}

function traceStatus(event) {
  if (text(event.status)) return event.status;
  if (event.type !== 'tool/result') return undefined;
  if (/ · 失败$/.test(event.label)) return 'failed';
  if (/ · 完成$/.test(event.label)) return 'completed';
  return undefined;
}

/** Aggregate recorded resources only. Message bodies and tool summaries are never parsed for URLs. */
export function aggregateConversationResources(messages = [], liveTrace = []) {
  const deliverables = new Map();
  const sources = new Map();
  const agents = new Map();
  const jobs = new Map();

  function addWebSource(url, source) {
    const id = `web:${url}`;
    const previous = sources.get(id);
    keepLatest(sources, id, {
      ...previous, ...source, id, kind: 'web', url, canOpen: true,
      name: text(source.name) || previous?.name || new URL(url).hostname,
      status: source.status ?? previous?.status,
    });
  }

  function addActivitySource(tool, owner, event) {
    const id = `activity:${owner}:${event.childSessionId || 'root'}:${tool}`;
    const previous = sources.get(id);
    keepLatest(sources, id, {
      id,
      kind: 'activity',
      name: tool === 'web_search' ? '网页搜索记录' : '网页读取记录',
      description: '记录未保存网页地址，可查看执行轨迹。',
      status: traceStatus(event) ?? previous?.status,
      event,
      canOpen: false,
    });
  }

  function addTrace(events, owner) {
    for (const event of rows(events)) {
      const runId = text(event.runId) || owner;
      const tool = webTool(event);
      if (tool) {
        const url = webUrl(event.url);
        if (url) {
          addWebSource(url, {
            name: text(event.title),
            description: tool === 'web_search' ? '搜索记录中的网页地址' : '网页读取记录',
            status: traceStatus(event),
            event,
          });
        } else addActivitySource(tool, runId, event);
      }
      if (event.type === 'subagents') {
        for (const child of rows(event.children)) {
          if (text(child.id)) agents.set(child.id, { ...child });
        }
        if (text(event.childSessionId)) {
          const previous = agents.get(event.childSessionId);
          agents.set(event.childSessionId, { ...previous, id: event.childSessionId, status: event.status ?? previous?.status });
        }
      }
      if (text(event.type).startsWith('job/') && text(event.itemId)) {
        const id = `${runId}:${event.childSessionId || event.sessionId || 'root'}:${event.itemId}`;
        jobs.set(id, { ...event, id });
      }
    }
  }

  rows(messages).forEach((message, messageIndex) => {
    const owner = text(message.runId) || text(message.id) || `message-${messageIndex}`;
    for (const file of rows(message.deliverables)) {
      if (!text(file.path)) continue;
      const id = `deliverable:${fileIdentity(file.path)}`;
      keepLatest(deliverables, id, { id, name: fileName(file), file, messageId: message.id });
    }
    if (message.role === 'user') {
      rows(message.files).forEach((file, fileIndex) => {
        const url = webUrl(file.sourceUrl);
        if (url) {
          addWebSource(url, { name: fileName(file), description: '加入交办的网页资料', file });
          return;
        }
        const reference = text(file.path) ? `path:${fileIdentity(file.path)}` : text(file.id) || `${owner}:${fileIndex}`;
        const id = `file:${reference}`;
        const hasContent = !file.unavailable && Boolean(text(file.path) || typeof file.text === 'string'
          || (text(file.image?.data) && text(file.image?.format).startsWith('image/')));
        keepLatest(sources, id, {
          id,
          kind: 'file',
          name: fileName(file),
          description: hasContent ? '交办附件' : '附件记录，未保存可打开的文件内容或路径。',
          file,
          messageId: message.id,
          recordOnly: !hasContent,
          canOpen: true,
        });
      });
    }
    rows(message.importedTools).forEach(tool => {
      if (!webTools.has(tool.name)) return;
      const url = webUrl(tool.url);
      if (url) {
        addWebSource(url, {
          name: text(tool.title),
          description: tool.failed ? '导入的失败工具记录' : '导入的网页工具记录',
          status: tool.failed ? 'failed' : undefined,
          tool,
          messageId: message.id,
        });
      }
    });
    addTrace(message.trace, owner);
    for (const child of rows(message.children)) {
      if (text(child.id)) agents.set(child.id, { ...child });
    }
  });
  addTrace(liveTrace, 'live');

  return {
    deliverables: [...deliverables.values()].reverse(),
    sources: [...sources.values()].reverse(),
    agents: [...agents.values()],
    jobs: [...jobs.values()],
  };
}
