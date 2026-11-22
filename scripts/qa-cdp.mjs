import { once } from 'node:events';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Local test connection. The application never imports this module. */
export async function connectUi(port = 9333, mainProcess = false) {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(item => mainProcess ? item.type === 'node' : item.type === 'page' && item.url === 'zhixing://app/index.html');
  if (!target) throw new Error('The ZhiXing renderer is not available.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, 'open');
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeoutMs = method === 'Page.captureScreenshot' ? 90000 : 30000;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result?.value;
  }
  async function waitFor(expression, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await evaluate(`Boolean(${expression})`);
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw new Error(`UI condition not reached: ${expression}`);
  }
  async function click(text, selector = 'button') {
    const expression = `(() => { const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getClientRects().length&&(e.getAttribute('aria-label')===${JSON.stringify(text)}||e.textContent.trim()===${JSON.stringify(text)})); if(nodes.length!==1) throw Error('Expected one visible control '+${JSON.stringify(text)}+', found '+nodes.length); const e=nodes[0];if(e.disabled)throw Error('Disabled control '+${JSON.stringify(text)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();const x=(Math.max(r.left,0)+Math.min(r.right,innerWidth))/2,y=(Math.max(r.top,0)+Math.min(r.bottom,innerHeight))/2;const hit=document.elementFromPoint(x,y);if(!hit||!e.contains(hit))throw Error('Control is obscured '+${JSON.stringify(text)});return {x,y};})()`;
    const point = await evaluate(expression);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  async function fill(selector, value) {
    await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input '+${JSON.stringify(selector)});e.focus();const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  async function screenshot(file) {
    try {
      const response = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(response.data, 'base64'));
      return { status: 'captured' };
    } catch (error) {
      if (process.env.ZHIXING_QA_SCREENSHOT_BEST_EFFORT !== '1') throw error;
      return { status: 'timeout', error: error.message };
    }
  }
  return { send, evaluate, waitFor, click, fill, screenshot, close: () => socket.close() };
}

if (process.argv[1] === import.meta.filename) {
  const ui = await connectUi(Number(process.env.ZHIXING_QA_PORT || 9333));
  try {
    console.log(JSON.stringify(await ui.evaluate(process.argv[2] || '({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,text:document.body.innerText})'), null, 2));
  } finally { ui.close(); }
}
