import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packaged = process.env.ZHIXING_TEST_PACKED_APP;
const { nextOccurrence, localDate } = await import(packaged ? pathToFileURL(path.join(packaged, 'src/scheduler.js')).href : '../src/scheduler.js');
const { applyAutomationResults, automationInput } = await import(packaged ? pathToFileURL(path.join(packaged, 'src/automation-core.js')).href : '../src/automation-core.js');
const loadElectron = name => import(packaged ? pathToFileURL(path.join(packaged, 'electron', name)).href : `../electron/${name}`);
const { AutomationService } = await loadElectron('automation-service.mjs');
const { automationTool } = await loadElectron('automation-tools.mjs');
const { previewTiming } = await loadElectron('schedule-rules.mjs');

function fixture() {
  let clock = +new Date(2026, 10, 19, 8, 0);
  let saved = null;
  const context = {
    settings: { persist: true, privacyMode: 'redact', model: 'fixture', reasoning: 'off', customTerms: [], notifications: false },
    workspaces: [{ id: 'office', type: 'office' }, { id: 'government', type: 'government' }],
    projects: [{ id: 'project', workspaceId: 'office', instructions: '说明统计口径。' }],
    documents: [{ id: 'doc', workspaceId: 'office', status: 'ready', name: '资料.txt', text: '联系人：张三，电话 13800000000。' }],
  };
  const config = { baseUrl: 'http://127.0.0.1/fixture', model: 'fixture', credentialRevision: 1 };
  const calls = [], previews = new Map(), waits = new Map();
  let hold = false;
  const runtime = {
    async preview(options) {
      const preparationId = crypto.randomUUID(); previews.set(preparationId, options);
      return { text: `预览：${options.prompt}`, original: options.prompt, preparationId, privacyMode: options.privacyMode, model: config.model, baseUrl: config.baseUrl, entities: [] };
    },
    async run(options) {
      calls.push(options);
      if (hold) await new Promise((resolve, reject) => waits.set(options.runId, { resolve, reject }));
      return { text: '计算完成：6。', masked: '计算完成：6。', modelInput: options.prompt, sessionId: options.sessionId, privacyMode: options.privacyMode, finishReason: 'completed' };
    },
    async runPrepared({ runId, preparationId }) {
      const options = previews.get(preparationId); assert(options); previews.delete(preparationId);
      return runtime.run({ ...options, runId });
    },
    async cancel(runId) { waits.get(runId)?.reject(new Error('取消')); },
  };
  const create = () => new AutomationService({ read: async () => structuredClone(saved), write: async value => { saved = structuredClone(value); }, getContext: () => context,
    getConfiguration: () => config, getKey: async () => 'fixture-only', runtime, now: () => clock });
  const value = { name: '周报核对', description: '核对数字 1、2、3。', kind: 'agent', workspaceId: 'office', projectId: 'project', documentIds: ['doc'], frequency: '每天', time: '09:00', anchorDate: '2026-11-19' };
  return { create, value, context, config, calls, waits, setClock: value => { clock = value; }, hold: value => { hold = value; }, get saved() { return saved; }, setSaved: value => { saved = value; } };
}

async function drain(service) {
  for (let n = 0; n < 20; n++) {
    await service.tail;
    await new Promise(resolve => setImmediate(resolve));
    if (!service.active.size) return;
  }
  throw new Error('Test did not drain its running task.');
}

test('过期隐私引擎授权在重启时暂停，规范化后的模型凭证不能进入自动化预览',async()=>{
 const f=fixture(),service=f.create();await service.initialise();await service.save(f.value);
 const id=service.snapshot().tasks[0].id;
 const preview=await service.prepare(id,'enable');await service.confirm(preview.approvalId);await service.close();
 const saved=structuredClone(f.saved);saved.tasks[0].approval.privacyEngineVersion='0.12.0-local-v2';f.setSaved(saved);
 const restarted=f.create();await restarted.initialise();assert.equal(restarted.task(id).enabled,false);assert.equal(restarted.task(id).approval,null);
 f.context.documents[0].text='f\u200bｉｘｔｕｒｅ－ｏｎｌｙ';
 await assert.rejects(restarted.prepare(id,'run'),/模型凭证/);await restarted.close();
});

test('Agent 定时任务工具复用同一调度器、草稿暂停及项目隔离',async()=>{
 const f=fixture(),s=f.create();await s.initialise();const scope={workspaceId:'office',projectId:'project'};
 try{
  const created=await automationTool(s,scope,{operation:'create',title:'月度复核',prompt:'核对所选材料',frequency:'每月',time:'09:00',anchor_date:'2026-12-01',document_ids:['doc']});
  assert.equal(created.task.enabled,false);assert.equal(created.task.title,'月度复核');assert.equal(f.calls.length,0);
  assert.equal((await automationTool(s,{workspaceId:'government'},{operation:'list'})).tasks.length,0);
  await assert.rejects(automationTool(s,{workspaceId:'government'},{operation:'delete',id:created.task.id}),/当前项目/);
  await automationTool(s,scope,{operation:'edit',id:created.task.id,title:'复核草稿'});assert.equal(s.task(created.task.id).name,'复核草稿');assert.equal(s.task(created.task.id).enabled,false);
  await assert.rejects(automationTool(s,scope,{operation:'enable',id:created.task.id}),/不支持/);
  await automationTool(s,scope,{operation:'delete',id:created.task.id});assert.equal(s.snapshot().tasks.length,0);
 }finally{await s.close();}
});

test('日期计算遵守未来起始日、工作日、单次、月末和闰年', () => {
  const task = { frequency: '每天', time: '09:00', anchorDate: '2026-12-01' };
  assert.equal(localDate(new Date(nextOccurrence(task, +new Date(2026, 10, 19, 8)))), '2026-12-01');
  assert.equal(localDate(new Date(nextOccurrence({ ...task, anchorDate: '2026-11-20', frequency: '工作日' }, +new Date(2026, 10, 20, 10)))), '2026-11-23');
  assert.equal(nextOccurrence({ ...task, frequency: '仅一次' }, +new Date(2026, 11, 1, 9)), null);
  assert.equal(localDate(new Date(nextOccurrence({ ...task, frequency: '每月', anchorDate: '2026-01-31' }, +new Date(2026, 0, 31, 10)))), '2026-02-28');
  assert.equal(localDate(new Date(nextOccurrence({ ...task, frequency: '每年', anchorDate: '2024-02-29' }, +new Date(2026, 2, 1)))), '2027-02-28');
  assert.throws(() => nextOccurrence({ ...task, anchorDate: '2026-02-30' }), /有效/);
  assert.throws(() => nextOccurrence({ ...task, frequency: '每秒' }), /重复/);
});

test('资料与项目限定在同一工作空间，任务包含实际选定资料', async () => {
  const f = fixture();
  assert(automationInput(f.value, f.context).prompt.includes('13800000000'));
  assert(automationInput(f.value, f.context).prompt.includes('说明统计口径'));
  assert.throws(() => automationInput({ ...f.value, workspaceId: 'government' }, f.context), /项目/);
  assert.throws(() => automationInput({ ...f.value, projectId: null, workspaceId: 'government' }, f.context), /资料/);
  const s = f.create(); await s.initialise();
  await assert.rejects(s.save({ ...f.value, anchorDate: '2026-02-30' }), /有效/);
  await s.save(f.value); assert.equal(s.snapshot().tasks[0].enabled, false);
  await s.close();
});

test('主机审阅单次使用，资料、模型连接或发送方式变更使授权失效', async () => {
  for (const change of [f => { f.context.settings.privacyMode = 'raw'; }, f => { f.config.credentialRevision++; }, f => { f.context.documents[0].text = '更新后的材料'; }, f => { f.context.projects[0].instructions = '说明变更'; }]) {
    const f = fixture(), s = f.create(); await s.initialise(); await s.save(f.value);
    const task = s.snapshot().tasks[0], preview = await s.prepare(task.id, 'enable');
    change(f); await assert.rejects(s.confirm(preview.approvalId), /变化/); assert.equal(f.calls.length, 0);
    await s.close();
  }
  const f = fixture(), s = f.create(); await s.initialise(); await s.save(f.value);
  const task = s.snapshot().tasks[0];
  await assert.rejects(s.toggle(task.id, true), /审阅/);
  const p = await s.prepare(task.id, 'enable'); await s.confirm(p.approvalId);
  await assert.rejects(s.confirm(p.approvalId), /过期/);
  assert.equal(s.snapshot().tasks[0].enabled, true);
  f.context.settings.customTerms = ['内部项目'];
  await s.tick(); assert.equal(s.snapshot().tasks[0].enabled, false); assert.equal(f.calls.length, 0);
  await s.close();
});

test('到期任务先持久化再执行，重开仅补最近一次，单次执行后关闭', async () => {
  const f = fixture(), s = f.create(); await s.initialise(); await s.save(f.value);
  const task = s.snapshot().tasks[0];
  await s.confirm((await s.prepare(task.id, 'enable')).approvalId);
  f.setClock(+new Date(2026, 10, 24, 10));
  await s.tick(); await drain(s);
  assert.equal(f.calls.length, 1); assert.equal(s.snapshot().runs[0].status, 'completed');
  assert.equal(localDate(new Date(s.snapshot().tasks[0].nextRun)), '2026-11-25');
  const restarted = f.create(); await restarted.initialise(); await restarted.tick(); await drain(restarted);
  assert.equal(f.calls.length, 1); await s.close(); await restarted.close();

  const once = fixture(), one = once.create(); await one.initialise();
  await one.save({ ...once.value, frequency: '仅一次', kind: 'reminder', documentIds: [] });
  await one.toggle(one.snapshot().tasks[0].id, true); once.setClock(+new Date(2026, 10, 19, 9));
  await one.tick(); await drain(one);
  assert.equal(one.snapshot().runs[0].status, 'completed'); assert.equal(one.snapshot().tasks[0].enabled, false);
  await one.tick(); assert.equal(one.snapshot().runs.length, 1); await one.close();
});

test('运行可取消、禁止运行时编辑，失败与中断不会伪装成功', async () => {
  const f = fixture(), s = f.create(); await s.initialise(); await s.save(f.value); f.hold(true);
  const task = s.snapshot().tasks[0];
  await s.confirm((await s.prepare(task.id, 'run')).approvalId);
  for (let i = 0; i < 20 && !f.waits.size; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.snapshot().runs[0].status, 'running');
  await assert.rejects(s.save({ ...f.value, id: task.id }), /停止/);
  await assert.rejects(s.remove(task.id), /停止/);
  await s.cancel(task.id); assert.equal(s.snapshot().runs[0].status, 'stopped'); assert(!s.snapshot().runs[0].result);
  await s.close();
  f.setSaved({ version: 1, revision: 1, tasks: [], runs: [{ id: 'interrupted', status: 'running' }] });
  const recovered = f.create(); await recovered.initialise(); assert.equal(recovered.snapshot().runs[0].status, 'interrupted'); await recovered.close();
});

test('写入失败不会启用计划或调用模型', async () => {
  const f = fixture(), s = f.create(); await s.initialise(); await s.save(f.value);
  const id = s.snapshot().tasks[0].id, preview = await s.prepare(id, 'enable');
  s.write = async () => { throw new Error('磁盘不可写'); };
  await assert.rejects(s.confirm(preview.approvalId), /不可写/);
  assert.equal(s.snapshot().tasks[0].enabled, false); assert.equal(f.calls.length, 0);
  await s.close();
});

test('Harness Cron 核对指定时区和夏令时，RRULE 只预览剩余有效日期', () => {
  const before = Date.parse('2026-03-06T14:01Z');
  const cron = { rule: { kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'America/New_York' } };
  assert.deepEqual(previewTiming(cron, before).occurrences.map(ms => new Date(ms).toISOString()), [
    '2026-03-09T13:00:00.000Z', '2026-03-10T13:00:00.000Z', '2026-03-11T13:00:00.000Z',
  ]);
  const rrule = { rule: { kind: 'rrule', expression: 'DTSTART;TZID=Asia/Shanghai:20261119T090000\r\nRRULE:FREQ=DAILY;COUNT=2' } };
  const preview = previewTiming(rrule, Date.parse('2026-11-19T01:00Z'));
  assert.deepEqual(preview.occurrences, [Date.parse('2026-11-20T01:00Z')]);
  assert.throws(() => previewTiming({ rule: { ...cron.rule, timeZone: 'Bad/Zone' } }, before), /时区无效/);
  assert.throws(() => previewTiming({ rule: { kind: 'every', seconds: 59 } }, before), /60/);
});

test('RRULE 到期只补最近一次，固定间隔保留节拍，延迟规则只执行一次', async () => {
  for (const [rule, now, due, next] of [
    [{ kind: 'rrule', expression: 'DTSTART:20261119T090000Z\nRRULE:FREQ=DAILY;COUNT=3' },
      '2026-11-24T15:30Z', '2026-11-21T09:00Z', null],
    [{ kind: 'every', seconds: 900 }, '2026-11-19T08:51Z', '2026-11-19T08:45Z', '2026-11-19T09:00Z'],
    [{ kind: 'after', seconds: 90 }, '2026-11-19T08:05Z', '2026-11-19T08:01:30Z', null],
  ]) {
    const f = fixture(), s = f.create();
    f.setClock(Date.parse('2026-11-19T08:00Z'));
    await s.initialise();
    await s.save({ ...f.value, rule, kind: 'reminder' });
    const { id } = s.snapshot().tasks[0];
    await s.toggle(id, true);
    await s.close();
    const restarted = f.create();
    f.setClock(Date.parse(now));
    await restarted.initialise();
    await restarted.tick();
    await drain(restarted);
    const { runs, tasks } = restarted.snapshot();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].scheduledAt, Date.parse(due));
    assert.equal(tasks[0].nextRun, next ? Date.parse(next) : null);
    assert.equal(tasks[0].enabled, Boolean(next));
    await restarted.tick();
    assert.equal(restarted.snapshot().runs.length, 1);
    await restarted.close();
  }
});

test('同一条任务聊天使用同一 Harness 会话，材料变更重新审阅后隔离旧会话', async () => {
  const f = fixture(), s = f.create();
  await s.initialise();
  const scope = { workspaceId: 'office', projectId: 'project' };
  const { task } = await automationTool(s, scope, {
    operation: 'create', title: '项目检查', prompt: '核对工作进度',
    rule_kind: 'every', seconds: 3600, target_kind: 'new_once', document_ids: ['doc'],
  });
  assert(!task.enabled);
  for (let n = 0; n < 2; n++) {
    await s.confirm((await s.prepare(task.id, 'run')).approvalId);
    await drain(s);
  }
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].sessionId, f.calls[1].sessionId);
  const [first, second] = s.snapshot().runs;
  assert.equal(first.result.chatId, second.result.chatId);
  assert.equal(second.result.chatId, s.task(task.id).resultChatId);
  f.context.documents[0].text = '新材料';
  await s.confirm((await s.prepare(task.id, 'run')).approvalId);
  await drain(s);
  assert.notEqual(f.calls[1].sessionId, f.calls[2].sessionId);
  assert.equal(s.snapshot().runs[2].result.chatId, first.result.chatId);
  await s.close();
});

test('已有聊天把审阅过的消息纳入指令，结果按次送达，新增上下文使计划暂停', async () => {
  const f = fixture(), s = f.create();
  f.context.chats = [{ id: 'target-chat', title: '销售会议', workspaceId: 'office', projectId: 'project',
    messages: [{ id: 'm1', role: 'user', text: '使用本周统计口径。' }] }];
  await s.initialise();
  await s.save({ ...f.value, target: { kind: 'session', chatId: 'target-chat' } });
  const { id } = s.snapshot().tasks[0];
  const first = await s.prepare(id, 'enable');
  assert.equal(first.targetTitle, '销售会议');
  assert.match(first.original, /本周统计口径/);
  await s.confirm(first.approvalId);
  f.setClock(+new Date(2026, 10, 19, 9));
  await s.tick();
  await drain(s);
  const runs = s.snapshot().runs;
  assert.equal(runs[0].result.chatId, 'target-chat');
  assert.notEqual(runs[0].result.sessionId, 'target-chat');
  const state = applyAutomationResults(f.context, runs);
  assert.equal(state.chats[0].messages.length, 3);
  assert.equal(applyAutomationResults(state, runs), state);
  f.context.chats = state.chats;
  await s.tick();
  assert(s.task(id).enabled);
  f.context.chats[0].messages.push({ id: 'm2', role: 'user', text: '增加一个未审阅的统计口径。' });
  await s.tick();
  assert(!s.task(id).enabled);
  assert.equal(f.calls.length, 1);
  f.context.chats[0].archived = true;
  await assert.rejects(s.prepare(id, 'run'), /已归档/);
  await s.close();
});
