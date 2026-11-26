import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { ErrorBoundary, reportRenderError } from './ErrorBoundary.jsx';
import { bindRendererDurability, flushRendererDurability } from './renderer-durability.js';
import './styles.css';
import './desktop-ui.css';
import './model-controls.css';

bindRendererDurability(window.zhixing);

createRoot(document.getElementById('root'), { onCaughtError: reportRenderError }).render(
  <React.StrictMode>
    <ErrorBoundary scope="application" beforeRestore={flushRendererDurability}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
