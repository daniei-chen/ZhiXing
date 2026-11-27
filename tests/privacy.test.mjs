import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const moduleUrl=name=>process.env.ZHIXING_TEST_PACKED_APP?pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP,name)).href:new URL(`../${name}`,import.meta.url).href;
const {PrivacySession,RestorationStream}=await import(moduleUrl('src/privacy-core.js'));
const {normalisePrivacyPolicy}=await import(moduleUrl('src/privacy-policy.js'));
test('同任务复用、跨任务隔离、可保存映射',()=>{
 const a=new PrivacySession('a'),raw='姓名：张三，手机 13800000000，邮箱 name@example.test';
 const masked=a.protect(raw);assert(!masked.text.includes('13800000000'));assert(!masked.text.includes('张三'));
 assert.equal(a.protect(raw).text,masked.text);assert.equal(a.restore(masked.text).text,raw);
 assert.equal(new PrivacySession('b').restore(masked.text).unknown.length,3);
 assert.equal(new PrivacySession('a',a.exportState()).restore(masked.text).text,raw);
 assert(!JSON.stringify(masked.entities).includes('张三'));
});
test('扩展规则、校验位、排除词、大小写和分类动作',()=>{
 const raw='姓名：张三，单位名称：星河有限公司；住址：上海市长宁区测试路88号；生日：1990-01-02；护照号：E12345678；工号：ZX-2026；192.168.20.21；AA:BB:CC:DD:EE:FF；C:\\Users\\test\\report.txt；身份证：11010519491231002X；卡号4111111111111111；NIGHTJAR';
 const session=new PrivacySession('types'),masked=session.protect(raw,['Nightjar']);
 for(const type of ['PERSON','ORG','ADDRESS','BIRTHDATE','PASSPORT','SERIAL','IP','MAC','PATH','ID','ACCOUNT','TERM'])assert(masked.entities.some(entity=>entity.type===type),type);
 assert.equal(session.restore(masked.text).text,raw);assert.equal(masked.blocked,false);
 const policy=normalisePrivacyPolicy({actions:{PHONE:'allow',PERSON:'block'},neverMask:['Nightjar']});
 const result=new PrivacySession('rules').protect('姓名：张三，电话13800000000，NIGHTJAR',['Nightjar'],policy);
 assert(result.blocked);assert(result.text.includes('13800000000'));assert(result.text.includes('NIGHTJAR'));
 assert.equal(new PrivacySession('invalid').protect('110105194912310020').entities.length,0);
 assert.equal(new PrivacySession('time').protect('会议时间09:30:00').entities.length,0);
 assert(new PrivacySession('prefix').protect('custom-key-abcdefgh',[],{secretPrefixes:['custom-key-']}).blocked);
});
test('嵌套请求和 JSON 字段逐值脱敏，保持结构和占位符完整',()=>{
 const session=new PrivacySession('nested'),input={items:[{姓名:'张三',phone:'+1 202 555 0199',notes:'电话 13800000000',ok:true}],count:3};
 const checked=session.protectValue(input);assert(!JSON.stringify(checked.value).includes('张三'));assert(!JSON.stringify(checked.value).includes('13800000000'));assert.equal(checked.value.count,3);assert.equal(checked.value.items[0].ok,true);
 const twice=session.protectValue(checked.value);assert.deepEqual(twice.value,checked.value);
 assert.equal(session.restore(JSON.stringify(checked.value)).text,JSON.stringify(input));
 assert(new PrivacySession('nested-secret').protectValue({settings:{api_key:'sk-abcdefghijklmnopqrstuvwxyz'}}).blocked);
});
test('逐字符流及所有分块边界不暴露残缺占位符',()=>{
 const a=new PrivacySession('a'),raw='电话 13800000000。',masked=a.protect(raw).text;
 for(let split=0;split<=masked.length;split++){
  const s=new RestorationStream(a);const result=s.push(masked.slice(0,split)).text+s.push(masked.slice(split)).text+s.finish().text;assert.equal(result,raw);
 }
 const stream=new RestorationStream(a);assert.equal([...masked].map(c=>stream.push(c).text).join('')+stream.finish().text,raw);
 assert.throws(()=>{const s=new RestorationStream(a);s.push('⟦ZX-abc');s.finish();});
});
test('凭证阻止发送且永不还原；既有占位符不被二次破坏',()=>{
 const a=new PrivacySession('a');for(const secret of ['sk-abcdefghijklmnopqrstuvwxyz','password=abcdef12345','-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----']){const p=a.protect(secret);assert(p.blocked);assert(!a.restore(p.text).text.includes(secret));}
 const p=a.protect('13800000000');assert.equal(a.protect(p.text).text,p.text);
 assert.deepEqual(a.restore('⟦ZX-foreign-PERSON-1⟧').unknown,['⟦ZX-foreign-PERSON-1⟧']);
});
test('全角、零宽和方向控制字符以原始位置替换并精确还原',()=>{
 const vault=new PrivacySession('unicode');
 for(const raw of ['电话：１３８００００００００','phone: +１ ２０２ ５５５ ０１９９','手机 138\u200b0000\u20600000','📄 联系人：张三，电话 １３８００００００００。']){
  const result=vault.protect(raw);assert(result.entities.length>0);assert.equal(vault.restore(result.text).text,raw);assert(!result.text.includes('１３８'));assert.equal(vault.protect(result.text).text,result.text);
  for(const finding of result.findings){assert(finding.start>=0&&finding.end<=raw.length);assert(!Object.hasOwn(finding,'value'));}
 }
 for(const secret of ['ｐａｓｓｗｏｒｄ＝synthetic-pass','pass\u200bword=123456','ＡＰＩ＿ＫＥＹ：synthetic-key'])assert(vault.protect(secret).blocked,secret);
});
test('格式字符、变体选择符和谚文填充符不能拆开手机号或身份证',()=>{
 const vault=new PrivacySession('invisible-fillers');
 for(const [raw,type] of [['138\u316412345678','PHONE'],['138\u115f12345678','PHONE'],['138\ufe0f12345678','PHONE'],['138\uffa012345678','PHONE'],['110101\u3164199001011237','ID']]){
  const result=vault.protect(raw);assert(result.entities.some(entity=>entity.type===type),`${type} ${JSON.stringify(raw)}`);
  assert(!result.text.includes(raw));assert(!result.text.includes('138'));assert(!result.text.includes('110101'));assert.equal(vault.restore(result.text).text,raw);
 }
});
test('凭证检查与识别共用同一份隐藏字符集合',async()=>{
 const {containsCredential}=await import(moduleUrl('src/privacy-recognizers.js'));
 const key='sk-live-synthetic-abcdef123456';
 assert(containsCredential(`header ${key.slice(0,10)}\ufe0f${key.slice(10)} trailer`,key));
 assert(containsCredential(`header ${key.slice(0,4)}\u3164${key.slice(4)} trailer`,key));
 assert(!containsCredential(`header ${key.slice(0,10)}x${key.slice(10)} trailer`,key));
});
test('伪造占位符不能隐藏凭证和手机号，只有本任务签发的占位符受保留',()=>{
 const vault=new PrivacySession('forged');
 for(const secret of ['⟦ZX-password=synthetic-secret-123⟧','⟦ZX-ｐａｓｓｗｏｒｄ＝123456⟧','⟦ZX-api_key=synthetic-secret⟧']){
  const result=vault.protect(secret);assert(result.blocked);assert(!result.text.includes('synthetic-secret'));
 }
 const result=vault.protect('⟦ZX-13800000000⟧');assert(!result.text.includes('13800000000'));assert.equal(vault.restore(result.text).text,'⟦ZX-13800000000⟧');
 const own=vault.protect('13800000000').text;assert.equal(vault.protect(own).text,own);
 assert(vault.protect(`password="${own}synthetic-extra-secret"`).blocked);
 const masked=vault.protectValue({api_key:'synthetic-secret'},[],{actions:{SECRET:'mask'}});assert.deepEqual(vault.protectValue(masked.value,[],{actions:{SECRET:'mask'}}).value,masked.value);
});
test('重叠自定义词不能降低内部实体的拦截动作，凭证永不还原',()=>{
 const vault=new PrivacySession('overlap');
 const result=vault.protect('客户13800000000档案',['客户13800000000档案'],{actions:{PHONE:'block',TERM:'mask'}});
 assert(result.blocked);assert.equal(result.findings[0].action,'block');assert(!result.text.includes('13800000000'));
 const secret=vault.protect('账号password=123456资料',['账号password=123456资料'],{actions:{TERM:'mask'}});assert(secret.blocked);assert(!vault.restore(secret.text).text.includes('123456'));
});
test('结构化字段识别大小写别名及数字凭证，不改变非敏感值的类型',()=>{
 const vault=new PrivacySession('fields');
 const input={fullName:'Jane Example',phoneNumber:2025550199,quantity:12,phone:12,description:'ordinary text'};
 const result=vault.protectValue(input);assert(!JSON.stringify(result.value).includes('Jane Example'));assert(!JSON.stringify(result.value).includes('2025550199'));assert.equal(result.value.phone,12);assert.equal(result.value.quantity,12);
 assert.deepEqual(JSON.parse(vault.restore(JSON.stringify(result.value)).text),{...input,phoneNumber:String(input.phoneNumber)});
 for(const value of [{accessToken:'abc'},{refresh_token:123456},{clientSecret:'xy'},{settings:{API_KEY:'short'}}])assert(new PrivacySession('secret-fields').protectValue(value).blocked);
});
test('IBAN 通过 MOD-97 才作为无字段账户识别，错误校验不误报',async()=>{
 const {validIban}=await import(moduleUrl('src/privacy-recognizers.js'));
 assert(validIban('GB82 WEST 1234 5698 7654 32'));assert(!validIban('GB83 WEST 1234 5698 7654 32'));
 const vault=new PrivacySession('iban');assert(vault.protect('GB82 WEST 1234 5698 7654 32').entities.some(entity=>entity.type==='ACCOUNT'));
 assert.equal(new PrivacySession('invalid-iban').protect('GB83 WEST 1234 5698 7654 32').entities.length,0);
});
