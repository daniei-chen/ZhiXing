import {useState} from 'react';
import {FileText} from '@phosphor-icons/react';
import {deliverableCaption,deliverableMoreLabel,deliverableName,splitDeliverables} from './deliverable-cards.js';

// 轮次末尾的交付卡片：文件名 + 说明（没有说明用文件类型），超过四个默认收起。
export function DeliveryCards({files,onOpen}) {
 const [expanded,setExpanded] = useState(false);
 const {total,visible,hidden,collapsible} = splitDeliverables(files);
 if (!total) return null;
 const shown = expanded ? [...visible,...hidden] : visible;
 return <div className="deliverable-files" data-count={total}>
  {shown.map((file,index)=><button type="button" className="deliverable-card" key={`${file?.path||''}:${index}`} title={file?.path||''} onClick={()=>void onOpen(file)}>
   <FileText size={18}/>
   <span><strong>{deliverableName(file)}</strong><small>{deliverableCaption(file)}</small></span>
  </button>)}
  {collapsible && <button type="button" className="text-button deliverable-more" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{deliverableMoreLabel(total,undefined,expanded)}</button>}
 </div>;
}
