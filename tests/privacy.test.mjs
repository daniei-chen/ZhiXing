import test from 'node:test';
import assert from 'node:assert/strict';
import {PrivacySession,RestorationStream} from '../src/privacy-core.js';
import {normalisePrivacyPolicy} from '../src/privacy-policy.js';
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
