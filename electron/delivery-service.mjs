import {createHash, createHmac, randomBytes, randomUUID} from 'node:crypto';
import {PrivacySession, TYPE_LABELS} from '../src/privacy-core.js';
import {PRIVACY_ENGINE_VERSION, normalisePrivacyPolicy, privacyPolicyForMode} from '../src/privacy-policy.js';
import {containsCredential} from '../src/privacy-recognizers.js';

const formats = new Set(['txt', 'docx', 'xlsx']);
const hideTokens = text => text.replace(/⟦ZX-[^⟧\r\n]+-([A-Z]+)-\d+⟧/g, (_token, type) => `【${TYPE_LABELS[type] || '敏感信息'}已隐藏】`);
const failure = (code, message) => Object.assign(new Error(message), {code, stage: 'delivery'});

// The renderer can request a review, but only this host-owned snapshot supplies
// bytes to file/clipboard adapters. Settings and credentials are read afresh at
// execution, including after a native save dialog has been open.
export class DeliveryService {
  constructor({getSettings, getSecrets = () => [], now = Date.now, maxSnapshots = 24, ttlMs = 10 * 60 * 1000}) {
    this.getSettings = getSettings;
    this.getSecrets = getSecrets;
    this.now = now;
    this.maxSnapshots = maxSnapshots;
    this.ttlMs = ttlMs;
    this.snapshots = new Map();
    this.inflight = new Set();
    this.revisionKey = randomBytes(32);
  }

  context() {
    const settings = this.getSettings() || {};
    const secrets = this.getSecrets().filter(value => typeof value === 'string' && value);
    const policy = normalisePrivacyPolicy(settings.privacyPolicy);
    const terms = Array.isArray(settings.customTerms) ? settings.customTerms.filter(value => typeof value === 'string') : [];
    const mode = settings.privacyMode === 'raw' ? 'raw' : 'redact';
    const policyRevision = createHmac('sha256', this.revisionKey).update(JSON.stringify({engine: PRIVACY_ENGINE_VERSION, policy, terms, mode, secrets})).digest('hex');
    return {policy, terms, mode, secrets, policyRevision};
  }

  prepare({original, masked, title, action = 'export', recipientScope = 'recipient', format = 'txt'} = {}) {
    if (typeof original !== 'string' || Buffer.byteLength(original, 'utf8') > 2 * 1024 * 1024 ||
        masked !== undefined && (typeof masked !== 'string' || Buffer.byteLength(masked, 'utf8') > 2 * 1024 * 1024) ||
        !['export', 'share'].includes(action) || !['recipient', 'self'].includes(recipientScope) || !formats.has(format) || action === 'share' && format !== 'txt') {
      throw failure('DELIVERY_INPUT_INVALID', '交付审阅内容、格式或接收范围无效。');
    }
    const context = this.context();
    // Self retains ordinary values, but neither scope can bypass credentials or
    // any currently configured block rule by reusing an older masked message.
    const policy = privacyPolicyForMode(context.policy, 'raw');
    const checked = new PrivacySession('delivery-review').protect(original, context.terms, policy);
    const credentialBlocked = context.secrets.some(key => [original, masked, title].some(value => typeof value === 'string' && containsCredential(value, key)));
    const blocked = checked.blocked || credentialBlocked;
    const text = credentialBlocked ? '检测到已配置凭据，交付已阻断。请从内容中移除后重新审阅。' : recipientScope === 'recipient' ? hideTokens(checked.text) : blocked ? hideTokens(checked.text) : original;
    const reviewId = randomUUID();
    const contentHash = createHash('sha256').update(JSON.stringify({reviewId, text, action, recipientScope, format})).digest('hex');
    const snapshot = {
      reviewId, contentHash, policyRevision: context.policyRevision, recipientScope, action, format,
      text,
      findings: checked.findings,
      blocked,
      ...(credentialBlocked ? {blockedReason: 'CONFIGURED_CREDENTIAL'} : checked.blocked ? {blockedReason: 'PRIVACY_POLICY_BLOCK'} : {}),
      allowedActions: blocked ? [] : [action],
      name: recipientScope === 'recipient' ? '知行交付（对外版）' : '知行交付（本人版）',
      expiresAt: this.now() + this.ttlMs,
    };
    for (const [id, row] of this.snapshots) if (row.expiresAt <= this.now()) this.snapshots.delete(id);
    if (this.snapshots.size >= this.maxSnapshots) this.snapshots.delete(this.snapshots.keys().next().value);
    this.snapshots.set(reviewId, structuredClone(snapshot));
    return structuredClone(snapshot);
  }

  resolve(binding = {}, action) {
    const snapshot = this.snapshots.get(binding.reviewId);
    if (!snapshot || snapshot.expiresAt <= this.now()) throw failure('DELIVERY_REVIEW_EXPIRED', '交付审阅已过期，请重新审阅。');
    if (snapshot.policyRevision !== this.context().policyRevision) throw failure('DELIVERY_POLICY_CHANGED', '隐私规则、发送模式或凭据已变化，请重新审阅交付内容。');
    if (snapshot.contentHash !== binding.contentHash || snapshot.policyRevision !== binding.policyRevision ||
        snapshot.recipientScope !== binding.recipientScope || snapshot.format !== (binding.format || 'txt') || snapshot.action !== action ||
        Object.hasOwn(binding, 'text')) throw failure('DELIVERY_REVIEW_MISMATCH', '交付内容、格式或接收范围与已审阅快照不一致，请重新审阅。');
    if (snapshot.blocked || !snapshot.allowedActions.includes(action)) throw failure('DELIVERY_BLOCKED', '当前隐私规则阻止交付，请修改内容后重新审阅。');
    return structuredClone(snapshot);
  }

  invalidateAll() {this.snapshots.clear();}

  async execute(binding, action, adapter) {
    const snapshot = this.resolve(binding, action);
    if (this.inflight.has(snapshot.reviewId)) throw failure('DELIVERY_REVIEW_BUSY', '这份交付正在处理，请等待当前操作结束。');
    this.inflight.add(snapshot.reviewId);
    try {
      const result = await adapter(snapshot, () => this.resolve(binding, action));
      if (!result?.cancelled) this.snapshots.delete(snapshot.reviewId);
      return result;
    } finally {this.inflight.delete(snapshot.reviewId);}
  }
}
