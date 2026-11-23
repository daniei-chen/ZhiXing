import path from 'node:path';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {officeConversions, officeRecalculationFormats} from '../electron/office-formats.mjs';
import {runOfficeLayout} from '../electron/office-layout.mjs';
import {workspaceTarget, workspaceWriteTarget} from '../electron/workspace-files.mjs';
import {nextOfficePath, writeOfficeFile} from './file-policy.mjs';

export const OFFICE_DOCUMENT_TOOLS = ['office_convert', 'office_recalculate', 'office_render'];
const formats = [...new Set(Object.values(officeConversions).flat())];
const output = {
 schema: {type:'object', additionalProperties:true},
 render: (_args, receipt) => [{type:'text', text:JSON.stringify(receipt)}],
};

export function registerOfficeDocumentTools(ctx, {root, restoreValue, permit, protectedValue}) {
 const deliveries = new WeakMap();
 for (const action of ['convert', 'recalculate']) {
  const recalculate = action === 'recalculate';
  const label = recalculate ? '重算工作簿' : '转换办公文档';
  const parameters = {
   input: {type:'string', required:true, description:'项目内源文件路径。源文件保留。'},
   format: {type:'string', required:true, enum:recalculate ? officeRecalculationFormats : formats},
   destination: {type:'string', description:'可选的项目内新文件路径。扩展名须与 format 一致，已有同名文件时自动编号。'},
   ...recalculate ? {} : {sheet:{type:'string', description:'导出 CSV 时可指定准确的工作表名称。'}},
  };
  ctx.tools.register(defineTool({
   name:`office_${action}`,
   description:`在本机用 DeepSeek Harness 的 OfficeKit ${label}，将结果另存到项目内并登记为当前会话成果。返回路径、格式和字节数，不上传文档。`,
   parameters, output, isConcurrencySafe:() => false,
   async execute(args, exec) {
    exec.signal.throwIfAborted();
    if (Object.keys(args).some(key => !Object.hasOwn(parameters,key))) throw new Error('本次 Office 操作收到不支持的参数。');
    const session = exec.agent?.session;
    const turn = session && ctx.agents.turnBoundaryOf(session);
    if (!turn || turn.openTurnStartSeq === null) throw new Error('Office 成果需要在当前交办中生成。');
    try {
     const {input, format, sheet, destination} = args;
     const source = await workspaceTarget(root, await restoreValue(input));
     const defaultName = path.join(path.dirname(source.target), `${path.parse(source.target).name}${recalculate ? '-重算' : ''}.${format}`);
     const requested = destination === undefined ? defaultName : await restoreValue(destination);
     if (path.extname(requested).toLowerCase() !== `.${format}`) throw new Error('保存文件的扩展名必须与所选格式一致。');
     const {target} = await workspaceWriteTarget(root, requested);
     const candidate = await nextOfficePath(target);
     // Keep the path supplied by the caller so a changed directory alias is detected after approval.
     const outputPath = path.join(path.dirname(requested), path.basename(candidate));
     const approved = await workspaceWriteTarget(root, outputPath);
     if (approved.target !== candidate) throw new Error('保存位置已变化，请重新操作。');
     await permit(exec, approved, label);
     const result = await runOfficeLayout(root, {action, path:source.target, format, sheet:sheet === undefined ? undefined : await restoreValue(sheet)}, {signal:exec.signal});
     const bytes = Buffer.from(result.bytes, 'base64');
     const receipt = await protectedValue({operation:action, path:source.target, file:approved.target, format, bytes:bytes.length,
      ...(result.pageCount === undefined ? {} : {pageCount:result.pageCount}), missingFonts:result.missingFonts});
     const latest = await workspaceWriteTarget(root, outputPath);
     if (latest.target !== approved.target || latest.device !== approved.device || latest.inode !== approved.inode) throw new Error('保存位置已变化，请重新操作。');
     exec.signal.throwIfAborted();
     await writeOfficeFile(approved.target, bytes);
     deliveries.set(exec, {session, turn:turn.lastTurn, files:[{path:approved.target, description:label}]});
     return receipt;
    } catch (error) {
     if (/^E[A-Z0-9]+$/.test(error.code)) throw new Error('无法读取项目文件或保存 Office 成果，请检查文件位置和权限。');
     throw error;
    }
   },
  }));
 }
 ctx.on('tools/result', (exec, result) => {
  const delivery = deliveries.get(exec);
  deliveries.delete(exec);
  if (!delivery || result.isError) return;
  delivery.session.append('deliverables/presented', {turn:delivery.turn, callId:exec.callId, files:delivery.files});
 });
 const {ZHIXING_OFFICE_VISION_URL:url, ZHIXING_OFFICE_VISION_TOKEN:token} = process.env;
 if (url && token) registerOfficeRender(ctx, {url, token, root, restoreValue, protectedValue});
}

function registerOfficeRender(ctx, {url, token, root, restoreValue, protectedValue}) {
 const parameters = {
  input: {type:'string', required:true, description:'项目内的 Word、Excel、PowerPoint、OpenDocument 或 PDF 文件。'},
  pages: {type:'array', items:{type:'integer'}, description:'文档或幻灯片的页码，从 1 开始。可发送的页数受当前会话剩余图片名额限制。'},
  sheet: {type:'string', description:'工作表准确名称。工作簿采用工作表和单元格区域，省略时尝试所有可见工作表。'},
  range: {type:'string', description:'A1 区域，例如 A1:H40。须同时指定工作表。'},
  dpi: {type:'integer', description:'24 至 600 DPI，默认由 OfficeKit 决定。'},
 };
 ctx.tools.register(defineTool({
  name:'office_render',
  description:'渲染项目内的办公文档或 PDF 页面。图片经过本机 OCR 和当前隐私规则处理后交给视觉模型。分批次数受当前会话剩余图片名额限制。',
  parameters,
  output:{
   schema:output.schema,
   render:(_args, receipt)=>[
    {type:'text',text:JSON.stringify(receipt)},
    ...receipt.images.map(({attachmentId,mediaType,bytes,width,height})=>({type:'image',attachment:{attachmentId,mediaType,bytes,width,height}})),
   ],
  },
  isConcurrencySafe:()=>false,
  async execute(args, exec) {
   exec.signal.throwIfAborted();
   if (Object.keys(args).some(key=>!Object.hasOwn(parameters,key))) throw new Error('版面渲染收到不支持的参数。');
   const agent=exec.agent;
   const header=agent?.session.requestHeader()?.config;
   const provider=header?.provider??agent?.options.provider, model=header?.model??agent?.options.model;
   const attachments=ctx.get('attachments');
   if (!attachments||!provider||!model) throw new Error('当前会话未准备模型视觉附件服务。');
   const info=await ctx.llm.resolveModelInfo(provider,model,exec.signal);
   if (!info.inputModalities?.includes('image')) throw new Error('当前模型未声明图片输入能力。');
   const input=await restoreValue(args.input);
   const {target}=await workspaceTarget(root,input);
   const sheet=args.sheet===undefined?undefined:await restoreValue(args.sheet);
   const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify({input:target,sheet,pages:args.pages,range:args.range,dpi:args.dpi}),signal:exec.signal,redirect:'error'});
   const body=await response.json();
   if (!response.ok) throw new Error(body.error||'办公页面未能生成视觉副本。');
   const {receipt,records}=body.value;
   const safe=await protectedValue(receipt);
   const refs=await attachments.saveImages(records.map(({data,mediaType},index)=>({data:Buffer.from(data,'base64'),mediaType,name:`office-page-${index+1}.${mediaType==='image/jpeg'?'jpg':'png'}`})));
   exec.signal.throwIfAborted();
   return {...safe,images:safe.images.map((image,index)=>({...image,...refs[index]}))};
  },
 }));
}
