import { randomUUID } from 'node:crypto';
import { WorkspaceSaveQueue } from './workspace-save-queue.mjs';

const MAX_BYTES = 12 * 1024 * 1024;
const EPOCH = /^[a-zA-Z0-9_-]{1,100}$/;
const record = (value) =>
  value !== null &&
  typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const failure = (code, message) => Object.assign(new Error(message), { code });

function draftMap(value = {}) {
  if (
    !record(value) ||
    Object.values(value).some(
      (draft) => !record(draft) || typeof draft.text !== 'string' || !Array.isArray(draft.files),
    )
  ) {
    throw failure('DRAFT_FORMAT', '本机草稿格式不正确，原记录没有被替换。');
  }
  return value;
}

/**
 * A workspace is the durable baseline. Only an overlay written for its epoch
 * may replace its drafts; an empty matching overlay is authoritative too.
 * Legacy workspaces have no epoch and are read without consulting a sidecar.
 */
export async function loadWorkspacePersistence({ readWorkspace, readDrafts }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const body = await readWorkspace();
    if (body === null) return { state: null, epoch: null };
    let decoded;
    try {
      decoded = JSON.parse(body);
    } catch {
      throw failure('WORKSPACE_READ_FAILED', '本地工作空间无法读取，原文件已保留。');
    }
    if (!record(decoded) || decoded.draftEpoch === undefined)
      return { state: decoded, epoch: null };
    if (typeof decoded.draftEpoch !== 'string' || !EPOCH.test(decoded.draftEpoch)) {
      throw failure('DRAFT_EPOCH', '本机草稿与工作空间的关联无效，原文件已保留。');
    }
    const { draftEpoch: epoch, ...state } = decoded;
    const overlayBody = await readDrafts();
    // A full commit may replace the baseline while the sidecar is being read.
    // Never combine files from that crossing; an unchanged epoch/body anchors
    // a matching overlay or the absence of one to the same baseline.
    if ((await readWorkspace()) !== body) continue;
    if (overlayBody !== null) {
      let overlay;
      try {
        overlay = JSON.parse(overlayBody);
      } catch {
        throw failure('DRAFT_READ_FAILED', '本机草稿无法读取，原文件已保留。');
      }
      if (
        !record(overlay) ||
        typeof overlay.draftEpoch !== 'string' ||
        !EPOCH.test(overlay.draftEpoch)
      ) {
        throw failure('DRAFT_FORMAT', '本机草稿格式不正确，原文件已保留。');
      }
      if (overlay.draftEpoch === epoch) {
        if (overlay.version !== 1)
          throw failure('DRAFT_VERSION', '本机草稿版本暂不支持，原文件已保留。');
        if (!Object.hasOwn(overlay, 'drafts'))
          throw failure('DRAFT_FORMAT', '本机草稿缺少内容记录，原文件已保留。');
        state.drafts = draftMap(overlay.drafts);
      }
    }
    if (state.settings?.persist === false) state.drafts = {};
    return { state, epoch };
  }
  throw failure('WORKSPACE_READ_BUSY', '工作空间正在保存，请稍后重试读取。');
}

/**
 * One queue owns both durable files. Each queued value captures the newest
 * structural intent and draft map, so coalescing a draft after a full save
 * cannot discard the structural save. The base is committed only after the
 * injected writer (including its cleanup) succeeds.
 */
export class WorkspacePersistence {
  constructor({ initialState, initialEpoch = null, write, onState, createEpoch = randomUUID }) {
    if (typeof write !== 'function')
      throw new TypeError('Workspace persistence writer is required.');
    this.write = write;
    this.createEpoch = createEpoch;
    this.epoch = initialEpoch;
    this.base = { state: initialState };
    this.committedBase = this.base;
    this.drafts = initialState.settings?.persist === false ? {} : draftMap(initialState.drafts);
    this.queue = new WorkspaceSaveQueue({ write: (snapshot) => this.commit(snapshot), onState });
  }

  state() {
    return this.queue.state();
  }
  flush() {
    return this.queue.flush();
  }
  retry() {
    return this.queue.retry();
  }

  saveWorkspace(state) {
    const drafts = state.settings?.persist === false ? {} : draftMap(state.drafts);
    this.base = { state };
    this.drafts = drafts;
    return this.enqueue();
  }

  saveDrafts(drafts) {
    // An IPC caller cannot bypass the host's current no-persistence intent.
    if (this.base.state.settings?.persist === false) return this.flush();
    this.drafts = draftMap(drafts);
    return this.enqueue();
  }

  enqueue() {
    const revision = this.queue.requestedRevision + 1;
    return this.queue.save(revision, { base: this.base, drafts: this.drafts, revision });
  }

  async commit(snapshot) {
    // The first save after a legacy read establishes the baseline and epoch.
    const kind = snapshot.base !== this.committedBase || !this.epoch ? 'workspace' : 'drafts';
    const epoch = kind === 'workspace' ? this.createEpoch() : this.epoch;
    if (typeof epoch !== 'string' || !EPOCH.test(epoch)) throw new Error('Invalid draft epoch.');
    const state = { ...snapshot.base.state, drafts: snapshot.drafts };
    const payload =
      kind === 'workspace'
        ? { ...state, draftEpoch: epoch }
        : { version: 1, draftEpoch: epoch, drafts: snapshot.drafts };
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
      throw failure(
        kind === 'workspace' ? 'WORKSPACE_LIMIT' : 'DRAFT_LIMIT',
        kind === 'workspace'
          ? '本地工作空间超过 12 MiB，请先导出部分资料后再保存。'
          : '本机草稿超过 12 MiB，请先减少未发送的附件或草稿内容后再保存。',
      );
    }
    await this.write({ kind, state, body, epoch, revision: snapshot.revision });
    this.committedBase = snapshot.base;
    this.epoch = epoch;
  }
}
