import {useEffect,useRef,useState} from 'react';
import {DotsThree,FileText} from '@phosphor-icons/react';
import {deliverableCaption,deliverableMoreLabel,deliverableName,splitDeliverables} from './deliverable-cards.js';
import {FILE_ACTIONS,actionPendingLabel} from './file-actions.js';

// 轮次末尾的交付卡片：文件名 + 说明（没有说明用文件类型），超过四个默认收起。
// 每张卡片的「⋯」给出与桌面版一致的文件动作：预览、在默认应用中打开、在文件管理器中显示。
export function DeliveryCards({files,onOpen,onAction,pending}) {
 const [expanded,setExpanded] = useState(false);
 const [menu,setMenu] = useState('');
 const boxRef = useRef(null);
 const {total,visible,hidden,collapsible} = splitDeliverables(files);
 useEffect(()=>{
  if (!menu) return undefined;
  const close = event => { if (!boxRef.current?.contains(event.target)) setMenu(''); };
  const escape = event => { if (event.key === 'Escape') setMenu(''); };
  document.addEventListener('pointerdown', close);
  document.addEventListener('keydown', escape);
  return ()=> { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
 },[menu]);
 if (!total) return null;
 const shown = expanded ? [...visible,...hidden] : visible;
 return <div className="deliverable-files" data-count={total} ref={boxRef}>
  {shown.map((file,index)=>{
   const key = `${file?.path||''}:${index}`;
   const busy = pending?.[file?.path] || '';
   return <div className="deliverable-slot" key={key}>
    <button type="button" className="deliverable-card" title={file?.path||''} onClick={()=>void onOpen(file)}>
     <FileText size={18}/>
     <span><strong>{deliverableName(file)}</strong><small>{busy ? actionPendingLabel(busy) : deliverableCaption(file)}</small></span>
    </button>
    <button type="button" className="deliverable-actions" aria-label={`${deliverableName(file)}的文件操作`} aria-expanded={menu===key} title="文件操作" onClick={()=>setMenu(value=>value===key?'':key)}>
     <DotsThree size={17} weight="bold"/>
    </button>
    {menu===key && <div className="file-action-menu" role="menu" aria-label={`${deliverableName(file)}的文件操作`}>
     {FILE_ACTIONS.map(item=><button type="button" role="menuitem" key={item.id} disabled={busy!==''} onClick={()=>{setMenu('');if(item.id==='preview')void onOpen(file);else void onAction?.(file,item.id);}}>{item.label}</button>)}
    </div>}
   </div>;
  })}
  {collapsible && <button type="button" className="text-button deliverable-more" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{deliverableMoreLabel(total,undefined,expanded)}</button>}
 </div>;
}
