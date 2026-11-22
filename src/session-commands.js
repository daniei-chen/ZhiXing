export const NATIVE_COMMAND_IDS = Object.freeze({
  plan: '@deepseek-ai/dsh-plan-mode',
  goal: '@deepseek-ai/dsh-command-goal',
  compact: '@deepseek-ai/dsh-command-compact',
});

const names = new Map([
  ['plan', 'plan'], ['计划', 'plan'],
  ['goal', 'goal'], ['目标', 'goal'],
  ['compact', 'compact'], ['压缩', 'compact'],
]);

export function parseSessionCommand(input) {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/u.exec(input.trim());
  const name = names.get(match?.[1]);
  if (!name) return null;
  const argument = match[2]?.trim() || '';
  if (name === 'compact') {
    return { name, argument: '', error: argument ? '使用 /compact 压缩当前会话。此命令无需参数。' : null };
  }
  if (name === 'plan') {
    return argument === 'off' ? { name, verb: 'off', argument: '' } : { name, argument };
  }
  const control = argument.toLowerCase();
  if (['pause', 'resume', 'clear'].includes(control)) return { name, verb: control, argument: '' };
  return /^edit(?=\s|$)/iu.test(argument) ? { name, verb: 'edit', argument: argument.slice(4).trim() } : { name, argument };
}

export function formatSessionCommand(command, argument = command.argument) {
  return [`/${command.name}`, command.verb, argument].filter(Boolean).join(' ');
}

export function acceptsGoalImages(command) {
  return command?.name === 'goal' && Boolean(command.argument);
}

export function matchesSessionCommandPrefix(command, prefix) {
  return [...names].some(([alias, name]) => name === command && `/${alias}`.startsWith(prefix));
}
