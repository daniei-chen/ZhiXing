import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ExcelJS from 'exceljs';
import {officeZip,makePdf,makeUnicodePdf} from './fixtures/documents.mjs';
const {parseOfficeFile}=await import(process.env.ZHIXING_TEST_PACKED_APP?pathToFileURL(path.join(process.env.ZHIXING_TEST_PACKED_APP,'electron','office-files.mjs')).href:'../electron/office-files.mjs');
import {PrivacySession} from '../src/privacy-core.js';
import {composePrompt} from '../src/office-workflows.js';
import {recognizeImage} from '../electron/ocr-service.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
test('Word 提取正文、页眉页脚、修订和批注，图片只记录范围',async()=>{
 const file=officeZip({'word/document.xml':`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>正文电话 13800000000</w:t></w:r><w:del><w:r><w:delText>已删除内容</w:delText></w:r></w:del><w:ins><w:r><w:t>新内容</w:t></w:r></w:ins></w:p></w:body></w:document>`,'word/header1.xml':`<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>页眉电话 13911112222</w:t></w:r></w:p></w:hdr>`,'word/comments.xml':`<w:comments xmlns:w="${W}"><w:comment><w:p><w:r><w:t>批注电话 13611112222</w:t></w:r></w:p></w:comment></w:comments>`,'word/media/image1.png':new Uint8Array([0,1,2,3])});
 const result=await parseOfficeFile('有批注的材料.docx',file);assert.equal(result.coverage.images,1);assert(result.text.includes('【删除修订】已删除内容【/修订】'));assert(result.text.includes('【插入修订】新内容【/修订】'));assert(result.text.includes('页眉电话'));assert(result.text.includes('批注电话'));assert.equal(result.coverage.kind,'extracted-text');
 const prompt=composePrompt('整理材料',[result]);assert(prompt.includes('原始文件和图片不会上传'));const protectedText=new PrivacySession('document-fixture').protect(prompt);assert(!protectedText.text.includes('13800000000'));assert(!protectedText.text.includes('13911112222'));assert(!protectedText.text.includes('13611112222'));
});
test('Excel 包含隐藏区域、合并单元格、批注和公式缓存，避免误报重算',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('预算');sheet.addRow([1,2]);sheet.getCell('C1').value={formula:'SUM(A1:B1)',result:3};sheet.mergeCells('A2:B2');sheet.getCell('A2').value='合并说明';sheet.getCell('A1').note='口径：不含税';sheet.getRow(3).values=['隐藏明细'];sheet.getRow(3).hidden=true;const hidden=book.addWorksheet('底表',{state:'veryHidden'});hidden.addRow(['内部口径']);
 const value=await parseOfficeFile('预算.xlsx',Buffer.from(await book.xlsx.writeBuffer()));assert(value.text.includes('SUM(A1:B1)'));assert(value.text.includes('缓存值：3'));assert(value.text.includes('【合并至 A2】'));assert(value.text.includes('隐藏明细'));assert(value.text.includes('内部口径'));assert(value.text.includes('不含税'));assert(value.coverage.hiddenItems>=2);assert(value.warnings.some(text=>text.includes('尚未重算')));
});
test('PPTX 按真实目录顺序读取幻灯片、隐藏页与演讲者备注',async()=>{
 const ns='http://schemas.openxmlformats.org/presentationml/2006/main',drawing='http://schemas.openxmlformats.org/drawingml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const slide=(text,hidden=false)=>`<p:sld xmlns:p="${ns}" xmlns:a="${drawing}"${hidden?' show="0"':''}><p:cSld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:cSld></p:sld>`;
 const buffer=officeZip({'ppt/presentation.xml':`<p:presentation xmlns:p="${ns}" xmlns:other="${rel}"><p:sldIdLst><p:sldId id="2" other:id="rId2"/><p:sldId id="1" other:id="rId1"/></p:sldIdLst></p:presentation>`,'ppt/_rels/presentation.xml.rels':'<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="/ppt/slides/slide2.xml"/></Relationships>','ppt/slides/slide1.xml':slide('后展示'),'ppt/slides/slide2.xml':slide('先展示',true),'ppt/slides/_rels/slide1.xml.rels':'<Relationships><Relationship Id="note" Target="../notesSlides/notesSlide1.xml"/></Relationships>','ppt/notesSlides/notesSlide1.xml':slide('演讲备注：电话 13800000000'),'ppt/media/image1.png':new Uint8Array([0])});
 const result=await parseOfficeFile('项目汇报.pptx',buffer);assert(result.text.indexOf('先展示')<result.text.indexOf('后展示'));assert(result.text.includes('隐藏幻灯片'));assert(result.text.includes('演讲备注'));assert.equal(result.coverage.pages,2);assert.equal(result.coverage.notes,1);assert.equal(result.coverage.images,1);
});
test('文字 PDF 在独立进程本机读取，链接和文档脚本不会访问网络',async()=>{
 let requests=0;const server=http.createServer((_request,response)=>{requests++;response.end('should not load');});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const result=await parseOfficeFile('文字资料.pdf',makePdf('LOCAL DOCUMENT TEST',`http://127.0.0.1:${server.address().port}/not-visited`));assert(result.text.includes('LOCAL DOCUMENT TEST'));assert.equal(result.coverage.pages,1);assert(result.text.includes('未访问'));assert.equal(requests,0);assert(result.warnings.some(text=>text.includes('扫描区域')));await assert.rejects(parseOfficeFile('扫描资料.pdf',makePdf('')),/没有可提取文字/);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
},{timeout:45000});
test('异常压缩包、DTD、宏及取消均拒绝；UTF-16 文本可本机读取',async()=>{
 await assert.rejects(parseOfficeFile('broken.docx',Buffer.from('invalid')),/有效/);
 await assert.rejects(parseOfficeFile('dtd.docx',officeZip({'word/document.xml':`<!DOCTYPE x [<!ENTITY x "not allowed">]><w:document xmlns:w="${W}"><w:body/></w:document>`})),/XML 声明/);
 await assert.rejects(parseOfficeFile('macro.docx',officeZip({'word/document.xml':`<w:document xmlns:w="${W}"/>`,'word/vbaProject.bin':new Uint8Array([0])})),/宏/);
 const controller=new AbortController();controller.abort();await assert.rejects(parseOfficeFile('cancel.txt',Buffer.from('data'),{signal:controller.signal}));
 const text=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('中文办公资料','utf16le')]);assert.equal((await parseOfficeFile('unicode.txt',text)).text,'中文办公资料');
});
test('中文 PDF 的 ToUnicode 文字映射可本机读取',async()=>{
 const result=await parseOfficeFile('中文.pdf',makeUnicodePdf());assert(result.text.replace(/\s/g,'').includes('中文办公'));
});
test('图片型 PPTX 不会把生成的页码误当作已提取正文',async()=>{
 const file=officeZip({'ppt/presentation.xml':'<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="1" r:id="rId1"/></p:sldIdLst></p:presentation>','ppt/_rels/presentation.xml.rels':'<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>','ppt/slides/slide1.xml':'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld/></p:sld>','ppt/media/image1.png':new Uint8Array([0])});
 await assert.rejects(parseOfficeFile('图片演示.pptx',file),/没有可提取文字/);
});
test('Windows 图片 OCR 返回本机文字覆盖范围，不返回原始图片字节',{skip:process.platform!=='win32',timeout:35000},async t=>{
 const file=new URL('./fixtures/ocr-office-read.png',import.meta.url);
 try {
  const result=await recognizeImage('ocr-office-read.png',await (await import('node:fs/promises')).readFile(file));
  assert.equal(result.coverage.kind,'ocr-text');
  assert.match(result.text,/13800000000/);
  assert.match(result.coverage.notice,/本机 OCR/);
  assert.equal(result.image,undefined);
 } catch(error) {
  if(error.message.includes('安装具有文字识别功能的语言'))return t.skip('Windows 未安装 OCR 语言');
  throw error;
 }
});
