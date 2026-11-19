import {PRIVACY_TYPES,normalisePrivacyPolicy} from './privacy-policy.js';
export const TYPE_LABELS = Object.fromEntries(PRIVACY_TYPES.map(([id,label]) => [id,label]));
const TOKEN = /⟦ZX-[^⟧\r\n]+⟧/g;
const RULES = [
  ['SECRET', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ['SECRET', /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer[ \t]+[A-Za-z0-9._~+\/-]{12,})\b/g],
  ['SECRET', /\b(?:ghp_|github_pat_|glpat-|AIza|xox[baprs]-|sk_live_|hf_|gsk_|xai-|npm_|pypi-|dop_v1_|cfut_)[A-Za-z0-9_-]{12,}\b/g],
  ['SECRET', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['SECRET', /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g],
  ['SECRET', /(?:api[_ -]?key|密码|password|token|secret)["']?[ \t]*[=:：][ \t]*(?:"[^"\r\n]{4,}"|'[^'\r\n]{4,}'|[^\s"',;，；]{6,})/gi],
  ['EMAIL', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  ['PHONE', /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?!\d)/g],
  ['PHONE', /(?<!\d)0\d{2,3}-\d{7,8}(?!\d)/g],
  ['MAC', /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi],
  ['IP', /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g],
  ['IP', /(?<![\w:])(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi],
  ['PATH', /[A-Z]:\\(?:[^\\\s"<>|\r\n]+\\)*[^\\\s"<>|\r\n，。；]*/gi],
  ['PATH', /\/(?:Users|home)\/[^\s"<>|\r\n，。；]+/g],
];

function validId(value) {
  const weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
  const date=`${value.slice(6,10)}-${value.slice(10,12)}-${value.slice(12,14)}`;
  const parsed=new Date(`${date}T00:00:00Z`);
  return Number.isFinite(+parsed)&&parsed.toISOString().slice(0,10)===date&&'10X98765432'[[...value.slice(0,17)].reduce((sum,n,i)=>sum+Number(n)*weights[i],0)%11]===value.at(-1).toUpperCase();
}
function validCard(value) {
  const digits=value.replace(/[ -]/g,'');
  if(digits.length<13||digits.length>19||/^(\d)\1+$/.test(digits))return false;
  return [...digits].reverse().reduce((sum,n,i)=>{let digit=Number(n)*(i%2?2:1);return sum+(digit>9?digit-9:digit);},0)%10===0;
}

export class PrivacySession {
  #entries = new Map();
  #values = new Map();
  #prefix;
  constructor(id, saved = null) {
    this.id = id;
    this.#prefix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    if (!saved) return;
    if (saved.id !== id || !/^[a-f0-9]{12}$/.test(saved.prefix) || !Array.isArray(saved.entries)) throw new Error('任务脱敏映射无效。');
    this.#prefix = saved.prefix;
    const pattern = new RegExp(`^⟦ZX-${this.#prefix}-([A-Z]+)-\\d+⟧$`);
    for (const entry of saved.entries) {
      if (typeof entry.value !== 'string' || !Object.hasOwn(TYPE_LABELS, entry.type) || pattern.exec(entry.token)?.[1] !== entry.type) throw new Error('脱敏映射损坏，已停止恢复。');
      this.#entries.set(entry.token, { ...entry });
      this.#values.set(`${entry.type}\0${entry.value}`, entry.token);
    }
  }
  exportState() { return { id: this.id, prefix: this.#prefix, entries: this.entries({ reveal: true }) }; }
  protect(input, terms = [], configuration = {}) {
    const source = String(input ?? '');
    const policy=normalisePrivacyPolicy(configuration);
    const reserved = [...source.matchAll(TOKEN)].map(m => ({ start: m.index, end: m.index + m[0].length, type: null }));
    const candidates = [...reserved];
    const push = (start, value, type) => { if (value && policy.actions[type] !== 'allow' && !(type!=='SECRET'&&policy.neverMask.some(word => policy.caseInsensitive ? word.toLowerCase()===value.toLowerCase() : word===value))) candidates.push({ start, end: start + value.length, value, type }); };
    for (const [type, re] of RULES) for (const m of source.matchAll(re)) {if(type==='IP'&&m[0].includes(':')&&!m[0].includes('::')&&(m[0].match(/:/g)||[]).length<7)continue;push(m.index, m[0], type);}
    for(const m of source.matchAll(/(?<!\d)[1-9]\d{16}[\dXx](?!\d)/g))if(validId(m[0]))push(m.index,m[0],'ID');
    for(const m of source.matchAll(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g))if(validCard(m[0]))push(m.index,m[0],'ACCOUNT');
    for(const m of source.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g))push(m.index,m[0],'ACCOUNT');
    const dict = new Map([...terms.filter(t => typeof t === 'string' && t).map(t => [t, 'TERM']), ...Array.from(this.#entries.values(), e => [e.value, e.type])]);
    for (const [type, re] of [
      ['PERSON', /(?:姓名|联系人|负责人|经办人|申请人|收件人|员工姓名|客户姓名)["']?[：:\t ]+["'「]?([\u3400-\u9fff]{2,4})(?=[，,。\s；;"'」\]}]|$)/g],
      ['PERSON', /(?:full[_ ]?name|contact[_ ]?name)["']?[：:\t ]+["']?([A-Z][A-Za-z'-]+(?: [A-Z][A-Za-z'-]+){1,3})/g],
      ['ACCOUNT', /(?:银行账号|银行卡号|银行账户|收款账号)[：:\t ]+["']?([\d -]{12,28})(?=[，,。\s；;"']|$)/g],
      ['ORG', /(?:单位名称|所属单位|公司名称|机构名称|客户单位)["']?[：:\t ]+["'「]?([^\r\n，,；;"'」]{2,60})/g],
      ['ORG', /(?:^|[\s：:，,。；;])([\u3400-\u9fffA-Za-z0-9（）()]{2,35}(?:有限责任公司|股份有限公司|有限公司|人民政府|管理委员会|研究院|事务所))(?=[\s，,。；;：:]|$)/g],
      ['ADDRESS', /(?:住址|详细地址|收件地址|办公地址|通讯地址|家庭地址|address)["']?[：:\t ]+["']?([^\r\n"'，,；;]{5,100})/gi],
      ['BIRTHDATE', /(?:出生日期|生日|birth(?:day|date)|DOB)["']?[：:\t ]+["']?((?:19|20)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)/gi],
      ['PASSPORT', /(?:护照(?:号(?:码)?)?|passport(?:[_ ]?(?:number|no))?)["']?[：:\t ]+["']?([A-Z0-9]{5,15})/gi],
      ['SERIAL', /(?:序列号|工号|内部编号|设备编号|S\/N|serial(?:[_ ]?number)?)["']?[：:\t ]+["']?([A-Z0-9][A-Z0-9._-]{3,60})/gi],
      ['PHONE', /(?:联系电话|电话|phone|mobile)["']?[：:\t ]+["']?(\+\d[\d ()-]{7,22}\d)/gi],
    ]) for (const m of source.matchAll(re)) {const value=m[1].trimEnd();push(m.index+m[0].indexOf(m[1]),value,type);dict.set(value,type);}
    for(const prefix of policy.secretPrefixes){let from=0,at;while((at=source.indexOf(prefix,from))>=0){const value=source.slice(at).match(/^[^\s"',;，；]+/)?.[0];push(at,value,'SECRET');from=at+prefix.length;}}
    for (const [value, type] of dict) {
      if (!value) continue;
      const haystack=policy.caseInsensitive?source.toLowerCase():source,needle=policy.caseInsensitive?value.toLowerCase():value;
      for (let from = 0, at; (at = haystack.indexOf(needle, from)) >= 0; from = at + value.length) push(at, source.slice(at,at+value.length), type);
    }
    // Merge overlapping spans so a phone or email inside a longer dictionary term cannot leave a partial value behind.
    const spans = [];
    for (const item of candidates.sort((a, b) => a.start - b.start || b.end - a.end)) {
      if(item.type&&reserved.some(span=>item.start<span.end&&item.end>span.start))continue;
      const last = spans.at(-1);
      if (!last || item.start >= last.end) { spans.push({ ...item }); continue; }
      last.end = Math.max(last.end, item.end);
      if (!last.type || item.type === 'SECRET') last.type = item.type || last.type;
    }
    const used = new Map(), parts = [];
    let offset = 0;
    for (const span of spans) {
      if (!span.type) continue;
      const value = source.slice(span.start, span.end), key = `${span.type}\0${value}`;
      let token = this.#values.get(key);
      if (!token) {
        token = `⟦ZX-${this.#prefix}-${span.type}-${this.#entries.size + 1}⟧`;
        this.#entries.set(token, { token, type: span.type, value, label: TYPE_LABELS[span.type] });
        this.#values.set(key, token);
      }
      used.set(token, { token, type: span.type, label: TYPE_LABELS[span.type] });
      parts.push(source.slice(offset, span.start), token);
      offset = span.end;
    }
    parts.push(source.slice(offset));
    return { text: parts.join(''), entities: [...used.values()], blocked: spans.some(s => policy.actions[s.type] === 'block') };
  }
  protectValue(value, terms=[], configuration={}) {
    const entities=new Map();let blocked=false;
    const visit=(item,depth)=>{
      if(depth>40)throw new Error('请求结构过深，已停止发送。');
      if(typeof item==='string') { const checked=this.protect(item,terms,configuration);blocked ||= checked.blocked;for(const entity of checked.entities)entities.set(entity.token,entity);return checked.text; }
      if(typeof item==='number'&&Number.isInteger(item)&&String(item).length>=11){const checked=this.protect(String(item),terms,configuration);blocked ||= checked.blocked;for(const entity of checked.entities)entities.set(entity.token,entity);return checked.entities.length?checked.text:item;}
      if(Array.isArray(item))return item.map(child=>visit(child,depth+1));
      if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,child])=>{
        if(typeof child==='string'&&/^(?:姓名|联系人|负责人|经办人|申请人|收件人|单位名称|公司名称|机构名称|地址|住址|出生日期|生日|护照号|工号|银行账号|full_name|contact_name|address|passport|phone|mobile|password|api_key|token|secret)$/i.test(key)){
          const label=key==='地址'?'详细地址':key;
          const checked=this.protect(`${label}: ${child}`,terms,configuration);blocked ||= checked.blocked;for(const entity of checked.entities)entities.set(entity.token,entity);
          return [key,checked.text.startsWith(`${label}: `)?checked.text.slice(label.length+2):checked.text];
        }
        return [key,visit(child,depth+1)];
      }));
      return item;
    };
    return {value:visit(value,0),entities:[...entities.values()],blocked};
  }
  restore(input, { allowedTypes = null, allowedTokens = null } = {}) {
    const source = String(input ?? ''), unknown = [];
    const text = source.replace(TOKEN, token => {
      const entry = this.#entries.get(token);
      if (!entry) { unknown.push(token); return token; }
      return entry.type !== 'SECRET' && (!allowedTypes || allowedTypes.includes(entry.type)) && (!allowedTokens || allowedTokens.has(token)) ? entry.value : token;
    });
    if (/⟦ZX-/i.test(source.replace(TOKEN, ''))) unknown.push('未闭合或无效的占位符');
    return { text, unknown };
  }
  entries({ reveal = false } = {}) {
    return [...this.#entries.values()].map(({ value, ...entry }) => reveal ? { ...entry, value } : entry);
  }
  clear() { this.#entries.clear(); this.#values.clear(); }
}

export class RestorationStream {
  constructor(session, options) { this.session = session; this.options = options; this.pending = ''; }
  push(chunk) {
    this.pending += chunk;
    const start = this.pending.lastIndexOf('⟦');
    const length = start >= 0 && !this.pending.slice(start).includes('⟧') ? start : this.pending.length;
    const output = this.pending.slice(0, length);
    this.pending = this.pending.slice(length);
    if (this.pending.length > 512) throw new Error('占位符片段过长，已停止还原。');
    return this.session.restore(output, this.options);
  }
  finish() {
    if (this.pending.includes('⟦')) throw new Error('输出包含未闭合占位符，需重新检查。');
    const output = this.session.restore(this.pending, this.options);
    this.pending = '';
    return output;
  }
}
