export const PRIVACY_ENGINE_VERSION = '0.12.0-local-v2';
export const PRIVACY_TYPES = [
  ['PERSON','姓名','带姓名、联系人、经办人等字段的人名'],
  ['ORG','机构名称','公司、机关和机构字段及常见单位名称'],
  ['PHONE','电话号码','中国大陆手机、座机及带字段的国际电话'],
  ['EMAIL','电子邮箱','常见电子邮件地址'],
  ['ID','身份证号','通过校验的中国大陆居民身份证号'],
  ['ACCOUNT','银行卡与账户','通过 Luhn 校验的卡号、带字段的账户与 IBAN'],
  ['PASSPORT','护照号码','护照或 passport 字段中的证件号'],
  ['ADDRESS','详细地址','住址、收件地址等字段及带门牌号的地址'],
  ['BIRTHDATE','出生日期','生日、出生日期或 DOB 字段中的日期'],
  ['IP','IP 地址','IPv4 和常见 IPv6 地址'],
  ['MAC','MAC 地址','网络设备的硬件地址'],
  ['PATH','本机路径','Windows 用户目录、绝对路径及 Unix 用户目录'],
  ['SERIAL','设备与内部编号','序列号、工号、内部编号等明确字段'],
  ['SECRET','密钥与密码','私钥、API Key、JWT、密码和凭证字段'],
  ['TERM','自定义词','你添加的人名、项目代号和其他敏感词'],
];

export const DEFAULT_PRIVACY_POLICY = {
  actions: Object.fromEntries(PRIVACY_TYPES.map(([id]) => [id,id === 'SECRET' ? 'block' : 'mask'])),
  neverMask: [], caseInsensitive: true, secretPrefixes: [],
};

export function normalisePrivacyPolicy(value) {
  const actions = Object.fromEntries(PRIVACY_TYPES.map(([id]) => [id,['mask','allow','block'].includes(value?.actions?.[id]) ? value.actions[id] : DEFAULT_PRIVACY_POLICY.actions[id]]));
  // Credentials may be masked or blocked, but cannot silently bypass the boundary.
  if(actions.SECRET === 'allow')actions.SECRET = 'block';
  const words = list => Array.isArray(list) ? [...new Set(list.filter(word => typeof word === 'string' && word.trim() && word.length <= 120).map(word => word.trim()))].slice(0,100) : [];
  return {actions,neverMask:words(value?.neverMask),caseInsensitive:value?.caseInsensitive !== false,secretPrefixes:words(value?.secretPrefixes).filter(word => word.length >= 4)};
}
