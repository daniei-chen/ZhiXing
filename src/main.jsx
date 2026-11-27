import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { ErrorBoundary, reportRenderError } from './ErrorBoundary.jsx';
import { bindRendererDurability, recoverRenderer } from './renderer-durability.js';
import { bindRuntimeApprovals } from './runtime-approvals.js';
import './styles.css';
import './desktop-ui.css';
import './model-controls.css';

bindRendererDurability(window.zhixing);
bindRuntimeApprovals(window.zhixing);

createRoot(document.getElementById('root'), { onCaughtError: reportRenderError }).render(
  <React.StrictMode>
    <ErrorBoundary scope="application" stopsRuns beforeRestore={() => recoverRenderer(window.zhixing)}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
