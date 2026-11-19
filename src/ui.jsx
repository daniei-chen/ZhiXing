import { useEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';

export function BrandMark({className=''}) {
  return <span className={`brand-mark ${className}`} aria-hidden="true"><img src="./brand/zhixing-bamboo.png" alt="" draggable={false}/></span>;
}

export function IconButton({icon:Icon,label,onClick,className='',children,...rest}) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick} {...rest}>{Icon&&<Icon size={17}/ >}{children}</button>;
}
export function MenuItem({icon:Icon,children,onClick,danger=false,hint,disabled}) {
  return <button type="button" className={`menu-item ${danger?'danger':''}`} onClick={onClick} disabled={disabled}>{Icon&&<Icon size={16}/>}<span>{children}</span>{hint&&<small>{hint}</small>}</button>;
}
export function Modal({title,onClose,className='',children}) {
  const ref=useRef(null);
  useEffect(()=>{
    const previous=document.activeElement;
    const first=className.includes('settings-modal')?ref.current:ref.current?.querySelector('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')||ref.current?.querySelector('button:not(:disabled)');
    first?.focus({preventScroll:true});
    return ()=>previous?.focus?.();
  },[]);
  function trap(e){
    if(e.key!=='Tab')return;
    const items=[...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(item=>item.getClientRects().length);
    const first=items[0],last=items.at(-1);
    if(!items.length){e.preventDefault();return;}
    if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===ref.current)){e.preventDefault();first?.focus();}
  }
  return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={ref} tabIndex={-1} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={trap}><header className="modal-heading"><h2>{title}</h2><IconButton icon={X} label="关闭对话框" onClick={onClose}/></header>{children}</section></div>;
}
export function Switch({value,onChange,label,disabled=false}) {
  return <button type="button" role="switch" disabled={disabled} aria-checked={value} aria-label={label} className={`switch ${value?'on':''}`} onClick={()=>onChange(!value)}><span/></button>;
}
