// Recognition uses a canonical view; replacements always use original UTF-16
// offsets. The source and the reversible mapping are never normalized in place.
const INVISIBLE = /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
export function canonicalText(value) {
  return String(value??'').normalize('NFKC').replace(/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu,'').replace(/[‐‑‒–−]/g,'-');
}
export function containsCredential(value, credential) {
  if(typeof credential!=='string'||credential.length<12)return false;
  const source=String(value??'');
  return source.includes(credential)||canonicalText(source).includes(canonicalText(credential));
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
