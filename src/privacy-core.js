import {SECRET_RULES} from './secret-redact.js';
import {PRIVACY_TYPES,normalisePrivacyPolicy} from './privacy-policy.js';
import {detectionView, validIban, fieldLabel, literalPattern, fixedStructureKey, childPrivacyContext} from './privacy-recognizers.js';
export const TYPE_LABELS = Object.fromEntries(PRIVACY_TYPES.map(([id,label]) => [id,label]));
const TOKEN = /⟦ZX-[^⟧\r\n]+⟧/g;
const RULES = [
  ...SECRET_RULES,
  ['EMAIL', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  ['PHONE', /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?!\d)/g],
  ['PHONE', /(?<!\d)0\d{2,3}-\d{7,8}(?!\d)/g],
  ['MAC', /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi],
  ['IP', /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g],
  ['IP', /(?<![\w:])(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi],
  ['PATH', /[A-Z]:\\(?:[^\\\s"<>|\r\n，。；,;:]+\\)*[^\\\s"<>|\r\n，。；,;:]*/gi],
  ['PATH', /\/(?:Users|home)\/[^\s"<>|\r\n，。；,;:]+/g],
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
    const view = detectionView(source), inspected = view.text;
    const policy=normalisePrivacyPolicy(configuration);
    // Only this vault's issued tokens are trusted. Arbitrary token-looking
    // strings must not create blind spots for credentials or personal data.
    const tokenSpans=[...source.matchAll(TOKEN)].map(m=>({start:m.index,end:m.index+m[0].length,type:null,trusted:this.#entries.has(m[0])}));
    const reserved = tokenSpans.filter(span=>span.trusted);
    const candidates = [...reserved];
    const equivalent = value => {const normalized=detectionView(value).text;return policy.caseInsensitive?normalized.toLowerCase():normalized;};
    const neverMask = new Set(policy.neverMask.map(equivalent));
    const push = (start, value, type, method='pattern') => {
      if(!value||policy.actions[type]==='allow'||type!=='SECRET'&&neverMask.has(equivalent(value)))return;
      const range=view.range(start,value.length);
      for(const span of tokenSpans)if(!span.trusted&&range.start<span.end&&range.end>span.start){range.start=Math.min(range.start,span.start);range.end=Math.max(range.end,span.end);}
      const protectedContext=type==='SECRET'&&value.match(/^[^:=：\r\n]+["']?\s*[:=：]\s*["']?\s*(⟦ZX-[^⟧]+⟧)\s*["']?$/u);
      if(protectedContext&&this.#entries.has(protectedContext[1]))return;
      candidates.push({...range,type,method,blocked:policy.actions[type]==='block'});
    };
    for (const [type, re] of RULES) for (const m of inspected.matchAll(re)) {if(type==='IP'&&m[0].includes(':')&&!m[0].includes('::')&&(m[0].match(/:/g)||[]).length<7)continue;push(m.index, m[0], type);}
    for(const m of inspected.matchAll(/(?<!\d)[1-9]\d{16}[\dXx](?!\d)/g))if(validId(m[0]))push(m.index,m[0],'ID','checksum');
    for(const m of inspected.matchAll(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g))if(validCard(m[0]))push(m.index,m[0],'ACCOUNT','checksum');
    for(const m of inspected.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gi))if(validIban(m[0]))push(m.index,m[0],'ACCOUNT','checksum');
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
      ['PHONE', /(?:联系电话|电话|phone|mobile)["']?[：:\t ]+["']?(\+?\d[\d ()-]{6,22}\d)/gi],
    ]) for (const m of inspected.matchAll(re)) {const value=m[1].trimEnd();push(m.index+m[0].lastIndexOf(m[1]),value,type,'context');dict.set(value,type);}
    for(const rawPrefix of policy.secretPrefixes){const prefix=detectionView(rawPrefix).text;if(!prefix)continue;for(const match of inspected.matchAll(literalPattern(prefix,policy.caseInsensitive))){const value=inspected.slice(match.index).match(/^[^\s"',;，；⟦⟧]+/)?.[0];push(match.index,value,'SECRET','custom');}}
    for (const [value, type] of dict) {
      if (!value) continue;
      const needle=detectionView(value).text;if(!needle)continue;
      for (const match of inspected.matchAll(literalPattern(needle,policy.caseInsensitive))) push(match.index,match[0],type,'dictionary');
    }
    // Merge overlapping spans so a phone or email inside a longer dictionary term cannot leave a partial value behind.
    const spans = [];
    for (const item of candidates.sort((a, b) => a.start - b.start || b.end - a.end)) {
      if(item.type&&reserved.some(span=>item.start>=span.start&&item.end<=span.end))continue;
      const last = spans.at(-1);
      if (!last || item.start >= last.end) { spans.push({ ...item }); continue; }
      last.end = Math.max(last.end, item.end);
      if (!last.type || item.type === 'SECRET' || item.blocked && !last.blocked && last.type !== 'SECRET') {last.type = item.type || last.type;last.method=item.method;}
      last.blocked ||= item.blocked;
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
    return { text: parts.join(''), entities: [...used.values()], blocked: spans.some(s => s.blocked), findings:spans.filter(span=>span.type).map(({start,end,type,method,blocked})=>({start,end,type,label:TYPE_LABELS[type],method,action:blocked?'block':policy.actions[type]})) };
  }
  assertSafeKeys(value, terms=[], configuration={}, {context='data',privacyMode='redact'}={}) {
    const inspect=(text,code='SENSITIVE_DYNAMIC_KEY')=>{
      const checked=this.protect(text,terms,configuration);
      if(checked.blocked||privacyMode!=='raw'&&checked.entities.length)throw Object.assign(new Error(code==='SENSITIVE_DYNAMIC_KEY'?'SENSITIVE_DYNAMIC_KEY: 结构化字段名称包含需保护的信息，请使用不含敏感值的字段名。':'SENSITIVE_SCHEMA_VALUE: 工具约束含需保护的信息，无法安全改写。'),{code});
    };
    const visit=(item,kind,depth)=>{
      if(depth>40)throw new Error('请求结构过深，已停止发送。');
      if(kind==='schemaDependency')kind=Array.isArray(item)?'schemaIdentity':'schema';
      if(kind==='jsonArguments'&&typeof item==='string'){visit(JSON.parse(item||'{}'),'data',depth+1);return;}
      if((kind==='schemaIdentity'||kind==='schemaLiteral')&&typeof item==='string'){inspect(item,kind==='schemaIdentity'?'SENSITIVE_DYNAMIC_KEY':'SENSITIVE_SCHEMA_VALUE');return;}
      if(kind==='schemaLiteral'&&typeof item==='number'&&Number.isInteger(item)&&String(item).length>=11)inspect(String(item),'SENSITIVE_SCHEMA_VALUE');
      if(kind==='schemaFixed'&&typeof item==='string'&&!['array','boolean','integer','null','number','object','string'].includes(item))inspect(item,'SENSITIVE_SCHEMA_VALUE');
      if(Array.isArray(item)){for(const child of item)visit(child,kind==='schemaDependencies'?'schemaIdentity':kind,depth+1);return;}
      if(item&&typeof item==='object')for(const [key,child]of Object.entries(item)){
        if(!fixedStructureKey(kind,key))inspect(key);
        if(['schemaLiteral','schemaFixed','schemaIdentity'].includes(kind)&&(typeof child==='string'||typeof child==='number'&&Number.isFinite(child))){
          const field=fieldLabel(key),label=field==='姓名'&&/^[A-Z]/i.test(String(child))?'full_name':field;
          if(label)inspect(`${label}: ${child}`,'SENSITIVE_SCHEMA_VALUE');
        }
        visit(child,childPrivacyContext(kind,key),depth+1);
      }
    };
    visit(value,context,0);
  }
  protectValue(value, terms=[], configuration={}, options={}) {
    this.assertSafeKeys(value,terms,configuration,options);
    const entities=new Map();let blocked=false;
    const visit=(item,depth,context='data')=>{
      if(depth>40)throw new Error('请求结构过深，已停止发送。');
      if(context==='schemaDependency')context=Array.isArray(item)?'schemaIdentity':'schema';
      // These are executable schema identities/constraints, not prose. Their
      // sensitivity was checked above; changing them would break tool meaning.
      if(['schemaFixed','schemaIdentity','schemaLiteral'].includes(context))return item;
      if(typeof item==='string') { const checked=this.protect(item,terms,configuration);blocked ||= checked.blocked;for(const entity of checked.entities)entities.set(entity.token,entity);return checked.text; }
      if(typeof item==='number'&&Number.isInteger(item)&&String(item).length>=11){const checked=this.protect(String(item),terms,configuration);blocked ||= checked.blocked;for(const entity of checked.entities)entities.set(entity.token,entity);return checked.entities.length?checked.text:item;}
      if(Array.isArray(item))return item.map(child=>visit(child,depth+1,context));
      if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,child])=>{
        const field=fixedStructureKey(context,key)?null:fieldLabel(key),label=field==='姓名'&&/^[A-Z]/i.test(String(child))?'full_name':field;
        if(label&&(typeof child==='string'||typeof child==='number'&&Number.isFinite(child))){
          const checked=this.protect(`${label}: ${child}`,terms,configuration);blocked ||= checked.blocked;for(const entity of checked.entities)entities.set(entity.token,entity);
          return [key,checked.entities.length?(checked.text.startsWith(`${label}: `)?checked.text.slice(label.length+2):checked.text):child];
        }
        return [key,visit(child,depth+1,childPrivacyContext(context,key))];
      }));
      return item;
    };
    return {value:visit(value,0,options.context),entities:[...entities.values()],blocked};
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
