import {FileCode} from '@phosphor-icons/react';
import {changeCounts,changedFilesLabel,changedFilesTotalLabel,displayPath} from './changed-files.js';

// 收尾正文之后的改动文件卡片：先列文件与行数，再出现交付卡片。
export function ChangedFiles({files,onOpen}) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return <></>;
  return <section className="change-files" data-count={list.length}>
    <header><FileCode size={15}/><strong>{changedFilesLabel(list.length)}</strong><small>{changedFilesTotalLabel(list)}</small></header>
    <ul>{list.map((file,index)=><li key={`${file?.path||''}:${index}`}>
      <button type="button" title={displayPath(file)} onClick={()=>onOpen?.()}>
        <span>{displayPath(file)}</span><small>{changeCounts(file).label}</small>
      </button>
    </li>)}</ul>
  </section>;
}
