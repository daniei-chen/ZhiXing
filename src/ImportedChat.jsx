import {ArrowUpRight,FileText} from '@phosphor-icons/react';

const imageFormats=new Set(['image/png','image/jpeg','image/webp','image/gif']);
export function ChatAttachments({files}){
 return files?.map((file,index)=>{
  const image=file.image;
  if(imageFormats.has(image?.format))return <img key={index} className="imported-image" alt={file.name} src={`data:${image.format};base64,${image.data}`}/>;
  return <span className="attachment-inline" key={index}><FileText size={14}/>{file.name}{file.unavailable&&<small>仅文件记录</small>}</span>;
 });
}

export function ImportedActivity({message,onOpenUrl}){
 return <>
  {message.importedThinking&&<details className="imported-activity">
   <summary>导出的思考记录</summary><pre>{message.importedThinking}</pre>
  </details>}
  {message.importedTools?.map((tool,index)=><details className="imported-activity" key={index}>
   <summary>{tool.name==='web_search'?'联网搜索':'打开网页'}{tool.failed?' · 失败':' · 导入记录'}</summary>
   {tool.detail&&<pre>{tool.detail}</pre>}
   {/^https?:\/\//i.test(tool.url||'')&&<button className="text-button" onClick={()=>onOpenUrl(tool.url)}>在浏览器打开 <ArrowUpRight size={13}/></button>}
  </details>)}
 </>;
}
