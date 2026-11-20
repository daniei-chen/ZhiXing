import {startToolBridge} from './tool-bridge.mjs';
import {writeBridge} from '../harness/privacy-bridge.mjs';

export const name = 'zhixing-runtime-cancellation';
export const inject = ['agents', 'subagents'];

export function apply(ctx) {
 const {ZHIXING_CANCEL_FILE: file, ZHIXING_CANCEL_KEY: key, ZHIXING_CANCEL_SESSION: sessionId} = process.env;
 delete process.env.ZHIXING_CANCEL_FILE;
 delete process.env.ZHIXING_CANCEL_KEY;
 delete process.env.ZHIXING_CANCEL_SESSION;
 if (!file || !key || !sessionId) return;

 const controller = new AbortController();
 let cancellation;
 const server = startToolBridge({
  route: '/runtime-cancel',
  signal: controller.signal,
  async invoke(input, signal) {
   signal.throwIfAborted();
   if (input.sessionId !== sessionId) throw new Error('停止请求不属于当前交办。');
   const agent = ctx.agents.get(sessionId);
   if (!agent) return {admitted: false};
   cancellation ??= (async () => {
    agent.cancel({kind: 'user'}, {keepInbox: true});
    await Promise.all([agent.whenIdle(), ctx.subagents.drainDescendants([agent])]);
    return {admitted: true, settled: true};
   })();
   return cancellation;
  },
 });
 const ready = server.then(({url, token}) => writeBridge(file, key, {url, token}));
 ready.catch(() => ctx.logger.warn('知行运行取消通道未能启动。'));
 ctx.on('dispose', async () => {
  controller.abort();
  await ready.catch(() => {});
  const handle = await server.catch(() => null);
  await handle?.close();
 });
}
