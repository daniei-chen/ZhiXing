import {useState} from 'react';
import {PrivacySession} from './privacy-core.js';
import {privacyPolicyForMode} from './privacy-policy.js';

const samples=[
 ['联系信息','联系人：张三，电话：13800000000；邮箱：contact@example.test'],
 ['全角与零宽','电话：１３８００００００００；手机：139\u200b0000\u20600000'],
 ['凭证拦截','⟦ZX-password=synthetic-secret-123⟧'],
 ['校验号码','身份证：11010519491231002X；IBAN：GB82 WEST 1234 5698 7654 32'],
];
const methods={pattern:'格式规则',context:'字段上下文',checksum:'校验位',dictionary:'已知词与映射',custom:'自定义规则'};
const actions={mask:'替换',block:'拦截',allow:'原样'};

export default function PrivacyTest({terms,policy,privacyMode='redact'}) {
 const [sample,setSample]=useState(''),[result,setResult]=useState(null);
 const sourceKey=JSON.stringify({terms,policy,privacyMode});
 const current=result?.sourceKey===sourceKey?result.checked:null;
 function change(value){setSample(value);setResult(null);}
 function run(){
  const checked=new PrivacySession('local-sample').protect(sample,terms,privacyPolicyForMode(policy,privacyMode));
  setResult({sourceKey,checked:privacyMode==='raw'&&!checked.blocked?{...checked,text:sample,entities:[],findings:[]}:checked});
 }
 const grouped=new Map();
 for(const finding of current?.findings||[]){const key=`${finding.type}:${finding.method}:${finding.action}`,row=grouped.get(key);if(row)row.count++;else grouped.set(key,{...finding,count:1});}
 return <div className="setting-section privacy-test"><h3>在本机试一试</h3>
  <p>测试内容仅在当前页面内存中处理，不保存、不发送。当前按{privacyMode==='raw'?'非脱敏模式检查，普通信息保留原文，识别到的凭证仍会拦截':'脱敏模式检查，识别全角与隐藏字符，替换和还原保留原文'}。</p>
  <div className="privacy-test-examples" aria-label="合成脱敏示例">{samples.map(([label,value])=><button type="button" className="secondary-button" key={label} onClick={()=>change(value)}>{label}</button>)}</div>
  <label className="form-label">测试原文<textarea className="privacy-sample" aria-label="脱敏测试原文" rows={4} maxLength={60000} value={sample} onChange={event=>change(event.target.value)} placeholder="粘贴一段合成测试文字"/></label>
  <button type="button" className="secondary-button" disabled={!sample.trim()} onClick={run}>测试脱敏</button>
  {current&&<><p className="settings-note" role="status">{current.blocked?'将被拦截':'本次规则检查未触发拦截'} · 识别 {current.findings.length} 处 · 替换 {current.entities.length} 个不同值</p>
   <pre className="privacy-sample-result" aria-label="脱敏测试结果">{current.text}</pre>
   {grouped.size>0&&<div className="privacy-findings"><table aria-label="脱敏识别依据"><thead><tr><th scope="col">类别</th><th scope="col">识别依据</th><th scope="col">处理</th><th scope="col">处数</th></tr></thead><tbody>{[...grouped].map(([key,finding])=><tr key={key}><td>{finding.label}</td><td>{methods[finding.method]||'格式规则'}</td><td>{actions[finding.action]}</td><td>{finding.count}</td></tr>)}</tbody></table></div>}
   <p className="settings-note">这是规则检查结果，不代表全部敏感信息均被识别。未标注字段的人名、地址、图片和扫描内容仍可能漏检；凭证不会在回复中自动还原。本地测试不读取已保存的 API Key，实际发送另有主进程凭证检查。</p>
  </>}
 </div>;
}
