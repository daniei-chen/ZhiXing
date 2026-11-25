import {createContext,useContext} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Copy} from '@phosphor-icons/react';
import {IconButton} from './ui.jsx';
import {referenceTitle,referenceResolver} from './inline-references.js';

// pre 里渲染的 code 一定是围栏代码块，和行内代码分开，避免把代码块里的单行内容当成文件引用。
const BlockCode = createContext(false);

export function AnswerText({text='',onOpenUrl,references,onOpenFile}){
 const block = useContext(BlockCode);
 const resolve = references?.length && onOpenFile ? referenceResolver(references) : null;
 const renderCode = (children,className) => {
  const content = String(Array.isArray(children) ? children.join('') : children ?? '');
  const target = resolve && !block && !className && !content.includes('\n') ? resolve(content) : null;
  if (!target) return <code>{children}</code>;
  return <code className="inline-file-ref" role="link" tabIndex={0} title={referenceTitle(target)} onClick={()=>onOpenFile(target)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpenFile(target);}}}>{children}</code>;
 };
 return <div className="answer-text"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
  a:({href,children})=>/^https?:\/\//i.test(href||'')?<a href={href} onClick={event=>{event.preventDefault();onOpenUrl?.(href);}}>{children}</a>:<span>{children}</span>,
  img:({alt})=><span className="markdown-image-note">{alt?`图片：${alt}`:'图片附件'}</span>,
  pre:({children})=><div className="answer-code"><div><span>代码</span><IconButton icon={Copy} label="复制代码" onClick={event=>navigator.clipboard.writeText(event.currentTarget.closest('.answer-code').querySelector('pre').textContent).catch(()=>{})}/></div><pre><BlockCode.Provider value>{children}</BlockCode.Provider></pre></div>,
  code:({children,className})=>renderCode(children,className),
  table:({children})=><div className="answer-table-scroll"><table>{children}</table></div>
 }}>{text}</ReactMarkdown></div>;
}
