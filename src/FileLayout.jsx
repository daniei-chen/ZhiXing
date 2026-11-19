import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, CircleNotch} from '@phosphor-icons/react';
import {FileCoverage} from './FileCoverage.jsx';
import {IconButton} from './ui.jsx';
import {officeConversions, officeExtension, officeRecalculationFormats, officeWorkbookFormats} from '../electron/office-formats.mjs';

export const supportsLayout = name => Object.hasOwn(officeConversions, officeExtension(name));
const errorMessage = error => error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');

export function FileLayout({context, file, text, textError, attach}) {
 const extension = officeExtension(file.name);
 const [view, setView] = useState(text ? 'text' : 'layout');
 const [layout, setLayout] = useState(null);
 const [ocr, setOcr] = useState(null);
 const [pending, setPending] = useState('');
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');
 const [operation, setOperation] = useState('');
 const [sheet, setSheet] = useState('');
 const active = useRef(true);
 useEffect(() => {
  active.current = true;
  return () => { active.current = false; };
 }, []);

 async function run(action, options) {
  setPending(action);
  setError('');
  setNotice('');
  try {
   const result = await window.zhixing.officeLayout({...context, path: file.path, action, ...options});
   if (!active.current) return;
   if (action === 'preview') {setLayout(result);setOcr(null);}
   else if(action==='ocr')setOcr(result);
   else if (result.saved) {
    const fonts = result.missingFonts?.slice(0, 6).join('、');
    setNotice(`已另存为 ${result.name}${fonts ? `。缺少字体 ${fonts}` : ''}`);
    setOperation('');
   }
  } catch (cause) {
   if (active.current) setError(errorMessage(cause));
  } finally {
   if (active.current) setPending('');
  }
 }
 function showLayout() {
  setView('layout');
  if (!layout && !pending) void run('preview', {page: 1});
 }
 const canRecalculate = officeWorkbookFormats.includes(extension);
 const [action, format] = operation.split('/');
 return <>
  <div className="file-layout-tools">
   <div className="file-view-switch" aria-label="文件预览方式">
    <button type="button" aria-pressed={view === 'text'} onClick={() => setView('text')}>文字</button>
    <button type="button" aria-pressed={view === 'layout'} onClick={showLayout}>版面</button>
   </div>
   {!!(officeConversions[extension].length || canRecalculate) && <select aria-label="转换或重算文件" value={operation} disabled={!!pending} onChange={event => {setOperation(event.target.value); setNotice(''); setError('');}}>
    <option value="">转换或重算…</option>
    {officeConversions[extension].map(value => <option value={`convert/${value}`} key={value}>转换为 {value.toUpperCase()}</option>)}
    {canRecalculate && officeRecalculationFormats.map(value => <option value={`recalculate/${value}`} key={value}>重算并另存 {value.toUpperCase()}</option>)}
   </select>}
  </div>
  {operation && <form className="file-export-options" onSubmit={event => {event.preventDefault();void run(action,{format,...(format === 'csv' && sheet.trim() ? {sheet:sheet.trim()} : {})});}}>
   {format === 'csv' && <input aria-label="CSV 工作表名称" placeholder="工作表名称（多表时必填）" maxLength={100} value={sheet} disabled={!!pending} onChange={event => setSheet(event.target.value)}/>}
   <button className="secondary-button" type="submit" disabled={!!pending}>另存文件</button>
   <button className="text-button" type="button" disabled={!!pending} onClick={() => setOperation('')}>取消</button>
  </form>}
  {pending && <p className="workbench-loading" role="status"><CircleNotch size={14}/>{pending === 'preview' ? '正在生成本机预览…' : pending==='ocr' ? '正在本机识别文字…' : '正在处理文件…'}</p>}
  {notice && <p className="settings-note file-layout-note" role="status">{notice}</p>}
  {error && <p className="workbench-error" role="alert">{error}</p>}
  {view === 'text' ? (text ? <><FileCoverage file={text}/><pre>{text.text}</pre></> : <p className="settings-note file-layout-note">{textError || '没有可提取的文字。'}</p>) : <>
   {layout ? <>
    <div className="file-layout-pages" aria-label="预览分页">
     <IconButton icon={ArrowLeft} label="上一页" disabled={!!pending || layout.page <= 1} onClick={() => run('preview', {page:layout.page-1, version:layout.version})}/>
     <span>第 {layout.page} / {layout.pageCount} 页</span>
     <IconButton icon={ArrowRight} label="下一页" disabled={!!pending || layout.page >= layout.pageCount} onClick={() => run('preview', {page:layout.page+1, version:layout.version})}/>
     <button className="secondary-button" disabled={!!pending} onClick={()=>run('ocr',{page:layout.page,version:layout.version})}>识别本页文字</button>
    </div>
    {!!layout.missingFonts?.length && <p className="settings-note file-layout-note">本机缺少字体 {layout.missingFonts.slice(0,6).join('、')}</p>}
    {ocr?<div className="file-ocr-result">
     <FileCoverage file={ocr}/>
     <div><button className="text-button" onClick={()=>setOcr(null)}>返回版面</button><button className="secondary-button" onClick={()=>attach(ocr)}>将识别文字加入交办</button></div>
     <pre>{ocr.text}</pre>
    </div>:<div className="file-layout-image"><img src={`data:image/png;base64,${layout.png}`} alt={`${file.name} 第 ${layout.page} 页`}/></div>}
   </> : !pending && <div className="file-layout-start"><button className="secondary-button" onClick={showLayout}>{error ? '重试版面预览' : '生成版面预览'}</button></div>}
  </>}
 </>;
}
