import {reviewCounts,reviewEmptyCopy,reviewFileLabel,reviewRowType,reviewSkipCopy,reviewTitle} from './review-view.js';

// 改动对比：左边文件列表，右边选中文件的逐行对比（对标桌面版 changes-review tab）。
export function ReviewPanel({files,diffs,selected,onSelect}) {
 const list=Array.isArray(files)?files:[];
 const segments=Array.isArray(diffs)?diffs:[];
 if(!list.length) return <div className="review-panel"><div className="workbench-empty"><strong>{reviewTitle(list)}</strong><span>{reviewEmptyCopy(list)}</span></div></div>;
 const active=list.find(file=>file.path===selected)||list[0];
 const diff=segments.find(item=>item.path===active?.path);
 return <div className="review-panel">
  <div className="review-head"><strong>{reviewTitle(list)}</strong><small>{list.reduce((sum,file)=>sum+(Number.isSafeInteger(file?.added)?file.added:0),0)} 行新增 · {list.reduce((sum,file)=>sum+(Number.isSafeInteger(file?.deleted)?file.deleted:0),0)} 行删除</small></div>
  <ul className="review-files" aria-label="本轮改动的文件">
   {list.map(file=><li key={file.path}>
    <button type="button" className={file.path===active?.path?'active':''} aria-pressed={file.path===active?.path} title={file.path} onClick={()=>onSelect?.(file.path)}>
     <span>{reviewFileLabel(file)}</span><small>{reviewCounts(file)}</small>
    </button>
   </li>)}
  </ul>
  <div className="review-diff" role="table" aria-label={`${reviewFileLabel(active)}的改动`}>
   {reviewSkipCopy(diff)&&<p className="review-note">{reviewSkipCopy(diff)}</p>}
   {!diff&&<p className="review-note">这次改动没有保留逐行内容。</p>}
   {diff?.rows?.map((row,index)=>{
    const type=reviewRowType(row);
    if(type==='gap')return <div className="review-line gap" key={`gap-${index}`} aria-hidden="true">⋯</div>;
    return <div className={`review-line ${type}`} data-type={type} key={`${type}-${index}`}>
     <span className="review-number">{row.beforeLine??''}</span>
     <span className="review-number">{row.afterLine??''}</span>
     <code>{row.text===''?' ':row.text}</code>
    </div>;
   })}
   {diff?.truncated&&<p className="review-note">对比行数超过上限，只显示前面一部分。</p>}
  </div>
 </div>;
}
