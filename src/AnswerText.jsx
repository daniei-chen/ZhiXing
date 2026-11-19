import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Copy} from '@phosphor-icons/react';
import {IconButton} from './ui.jsx';
export function AnswerText({text='',onOpenUrl}){
 return <div className="answer-text"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
  a:({href,children})=>/^https?:\/\//i.test(href||'')?<a href={href} onClick={event=>{event.preventDefault();onOpenUrl?.(href);}}>{children}</a>:<span>{children}</span>,
  img:({alt})=><span className="markdown-image-note">{alt?`图片：${alt}`:'图片附件'}</span>,
  pre:({children})=><div className="answer-code"><div><span>代码</span><IconButton icon={Copy} label="复制代码" onClick={event=>navigator.clipboard.writeText(event.currentTarget.closest('.answer-code').querySelector('pre').textContent).catch(()=>{})}/></div><pre>{children}</pre></div>,
  table:({children})=><div className="answer-table-scroll"><table>{children}</table></div>
 }}>{text}</ReactMarkdown></div>;
}
