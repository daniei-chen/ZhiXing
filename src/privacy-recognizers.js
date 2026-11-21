// Recognition uses a canonical view; replacements always use original UTF-16
// offsets. The source and the reversible mapping are never normalized in place.
const INVISIBLE = /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
export function canonicalText(value) {
  return String(value??'').normalize('NFKC').replace(/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu,'').replace(/[‐‑‒–−]/g,'-');
}
export function containsCredential(value, credential) {
  if(typeof credential!=='string'||!credential)return false;
  const source=String(value??'');
  const key=canonicalText(credential);
  return source.includes(credential)||!!key&&canonicalText(source).includes(key);
}
// Inspect decoded values as well as property names. JSON stringification alone
// changes quotes and backslashes inside otherwise valid API keys.
export function containsCredentialValue(value, credential, depth = 0) {
  if (depth > 40) throw new Error('凭证检查结构过深，已停止处理。');
  if (Array.isArray(value)) return value.some(item=>containsCredentialValue(item,credential,depth+1));
  if (value && typeof value === 'object') return Object.entries(value).some(([key,item])=>containsCredential(key,credential)||containsCredentialValue(item,credential,depth+1));
  return containsCredential(value,credential);
}

// Context belongs to the serialization boundary, never to data supplied by a
// model/tool. Only keys defined by that protocol are structural. A property
// named "type" inside an ordinary dictionary is still a dynamic data key.
const STRUCTURE_KEYS = Object.fromEntries(Object.entries({
  openai: 'model messages tools tool_choice parallel_tool_calls max_tokens max_completion_tokens temperature top_p stream stop presence_penalty frequency_penalty seed n user metadata response_format stream_options logprobs top_logprobs logit_bias reasoning_effort reasoning service_tier store modalities prediction audio verbosity',
  anthropic: 'model messages system tools tool_choice max_tokens temperature top_p top_k stream stop_sequences metadata thinking output_config service_tier container context_management',
  message: 'role content name tool_calls tool_call_id reasoning_content reasoning refusal function_call',
  block: 'type text name id input content tool_use_id is_error thinking signature data cache_control',
  openaiTool: 'type function',
  tool: 'name description parameters input_schema strict cache_control',
  toolCall: 'id type function',
  functionCall: 'name arguments',
  toolChoice: 'type name function mode disable_parallel_tool_use',
  responseFormat: 'type json_schema',
  jsonSchema: 'name description strict schema',
  thinkingConfig: 'type budget_tokens display',
  reasoningConfig: 'effort summary max_tokens',
  outputConfig: 'effort format',
  streamOptions: 'include_usage continuous_usage_stats',
  cacheControl: 'type ttl',
  schema: '$schema $id $ref $anchor $dynamicRef $dynamicAnchor $vocabulary $comment $defs definitions type properties patternProperties additionalProperties unevaluatedProperties propertyNames required dependentRequired dependentSchemas dependencies items prefixItems additionalItems unevaluatedItems contains minContains maxContains allOf anyOf oneOf not if then else enum const default examples title description format pattern minLength maxLength minimum maximum exclusiveMinimum exclusiveMaximum multipleOf minItems maxItems uniqueItems minProperties maxProperties readOnly writeOnly deprecated contentEncoding contentMediaType contentSchema discriminator',
}).map(([context, keys])=>[context,new Set(keys.split(' '))]));
export const fixedStructureKey = (context, key) => STRUCTURE_KEYS[context]?.has(key) === true;
export function childPrivacyContext(context, key) {
  if(context === 'schemaMap')return 'schema';
  if(context === 'requiredMap')return 'schemaIdentity';
  if(context === 'schemaIdentity'||context === 'schemaLiteral')return context;
  if(context === 'schema') {
    if(['properties','patternProperties','$defs','definitions','dependentSchemas'].includes(key))return 'schemaMap';
    if(key === 'dependentRequired')return 'requiredMap';
    if(key === 'dependencies')return 'schemaDependencies';
    if(['required','$ref','$dynamicRef','$id','$anchor','$dynamicAnchor','$schema','format','pattern'].includes(key))return 'schemaIdentity';
    if(['enum','const','default'].includes(key))return 'schemaLiteral';
    if(key==='type')return 'schemaFixed';
    if(['items','prefixItems','additionalItems','additionalProperties','unevaluatedProperties','unevaluatedItems','propertyNames','contains','allOf','anyOf','oneOf','not','if','then','else','contentSchema'].includes(key))return 'schema';
    return 'data';
  }
  if(context === 'schemaDependencies')return 'schemaDependency';
  if(context === 'openai'||context === 'anthropic') {
    if(key === 'messages')return 'message';
    if(key === 'system')return 'block';
    if(key === 'tools')return context === 'openai'?'openaiTool':'tool';
    return ({tool_choice:'toolChoice',response_format:'responseFormat',thinking:'thinkingConfig',reasoning:'reasoningConfig',output_config:'outputConfig',stream_options:'streamOptions'})[key]||'data';
  }
  if(key==='cache_control'&&['tool','block'].includes(context))return 'cacheControl';
  if(context==='toolChoice'&&key==='function')return 'functionCall';
  if(context==='responseFormat'&&key==='json_schema')return 'jsonSchema';
  if(context==='jsonSchema'&&key==='schema')return 'schema';
  if(context==='outputConfig'&&key==='format')return 'responseFormat';
  if(context === 'message') {
    if(key === 'content')return 'block';
    if(key === 'tool_calls')return 'toolCall';
  }
  if(context === 'block'&&key === 'content')return 'block';
  if(context === 'openaiTool'&&key === 'function')return 'tool';
  if(context === 'toolCall'&&key === 'function')return 'functionCall';
  if(context === 'functionCall'&&key === 'arguments')return 'jsonArguments';
  if(context === 'tool'&&['parameters','input_schema'].includes(key))return 'schema';
  return 'data';
}
export function detectionView(source) {
  const parts = [], starts = [], ends = [];
  for (let offset = 0; offset < source.length;) {
    const character = String.fromCodePoint(source.codePointAt(offset));
    const end = offset + character.length;
    if (!INVISIBLE.test(character)) {
      const normalized = character.charCodeAt(0)<128?character:character.normalize('NFKC').replace(/[‐‑‒–−]/g, '-');
      parts.push(normalized);
      for (let i = 0; i < normalized.length; i++) { starts.push(offset); ends.push(end); }
    }
    offset = end;
  }
  return {text: parts.join(''), range(start, length) { return {start: starts[start], end: ends[start + length - 1]}; }};
}

export function validIban(value) {
  const iban = value.replace(/ /g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  let remainder = 0;
  for (const character of iban.slice(4) + iban.slice(0,4)) {
    for (const digit of /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

export const FIELD_LABELS = new Map([
  ...['fullname','contactname','personname','姓名','联系人','负责人','经办人','申请人','收件人'].map(key => [key, '姓名']),
  ...['email','emailaddress','邮箱','电子邮箱'].map(key => [key, '邮箱']),
  ...['phone','phonenumber','mobile','mobilenumber','telephone','电话','手机','手机号','联系电话'].map(key => [key, '电话']),
  ...['organization','organisation','companyname','单位名称','公司名称','机构名称'].map(key => [key, '公司名称']),
  ...['address','streetaddress','homeaddress','地址','住址','详细地址'].map(key => [key, '详细地址']),
  ...['birthday','birthdate','dateofbirth','dob','出生日期','生日'].map(key => [key, '出生日期']),
  ...['passport','passportnumber','护照号'].map(key => [key, '护照号']),
  ...['bankaccount','bankaccountnumber','accountnumber','银行账号','银行卡号'].map(key => [key, '银行账号']),
  ...['employeeid','serialnumber','工号','设备编号'].map(key => [key, '工号']),
  ...['password','passwd','pwd','apikey','accesstoken','refreshtoken','token','secret','clientsecret','privatekey','authorization','密码','密钥'].map(key => [key, 'password']),
]);
export const fieldLabel = key => FIELD_LABELS.get(detectionView(key).text.replace(/[\s_-]/g, '').toLowerCase());
export const literalPattern = (value, insensitive) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), insensitive ? 'giu' : 'gu');
