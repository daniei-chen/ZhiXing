import {HARNESS_PERMISSION_PRESETS} from '../src/permissions.js';

export const name = 'zhixing-permission-sync';
export const inject = ['permissionPresets'];

export function apply(ctx, {preset}) {
 if (!Object.hasOwn(HARNESS_PERMISSION_PRESETS, preset)) throw new Error('内核执行权限预设无效。');
 ctx.on('agent/created', ({agent}) => {
  if (agent.session.header.origin === 'subagent') return;
  ctx.permissionPresets.set(agent.session, preset);
  if (ctx.permissionPresets.current(agent.session) !== preset) throw new Error('内核执行权限与当前会话选择不一致。');
 });
}
