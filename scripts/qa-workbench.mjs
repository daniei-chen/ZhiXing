// UI-only driver for the visible workbench tabs. It never changes React state
// or invokes the panel's service APIs on behalf of the application.
import assert from 'node:assert/strict';

const pages = new Set([
  'browser',
  'files',
  'terminal',
  'chat',
  'activity',
  'review',
  'deliverables',
  'stats',
  'details',
]);

export const workbenchTablist = '[role="tablist"][aria-label="工作面板视图"]';

export async function selectWorkbenchTab(ui, page) {
  assert.ok(pages.has(page), 'Unknown workbench page');
  const selector = `${workbenchTablist} [role="tab"][data-workbench-page="${page}"]`;
  await ui.waitFor(
    `Boolean(document.querySelector(${JSON.stringify(selector)})?.getClientRects().length)`,
    30000,
  );
  const label = await ui.evaluate(
    `(() => { const tab = document.querySelector(${JSON.stringify(selector)}); return tab.getAttribute('aria-label') || tab.textContent.trim(); })()`,
  );
  await ui.click(label, selector);
  await ui.waitFor(
    `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-selected') === 'true' && document.querySelector('[role="tabpanel"][data-workbench-panel="${page}"]')?.hidden === false`,
    15000,
  );
}
