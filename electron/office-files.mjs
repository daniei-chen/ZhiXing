import ExcelJS from 'exceljs';
import {Document,Packer,Paragraph,TextRun,HeadingLevel} from 'docx';
import {parseDocumentFile} from './document-service.mjs';
import {recognizeImage,supportsOcrImage} from './ocr-service.mjs';
export {parseDocumentFile as parseOfficeFile};
export const parseLocalMaterial=(name,bytes,options={})=>supportsOcrImage(name)?recognizeImage(name,bytes,options):parseDocumentFile(name,bytes,options);

export async function exportOfficeFile(text,format){
 if(format==='txt')return Buffer.from(text,'utf8');
 if(format==='docx'){
  const children=text.split(/\r?\n/).map(line=>{const match=line.match(/^(#{1,3})\s+(.*)/);return new Paragraph({heading:match?[HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3][match[1].length-1]:undefined,children:[new TextRun({text:match?match[2]:line,font:'Microsoft YaHei',size:22})],spacing:{after:120}});});
  return Packer.toBuffer(new Document({creator:'知行',title:'办公成果',sections:[{children}]}));
 }
 if(format==='xlsx'){
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('成果');book.creator='知行';
  text.split(/\r?\n/).filter(Boolean).forEach(line=>{const row=line.includes('\t')?line.split('\t'):line.startsWith('|')?line.replace(/^\||\|$/g,'').split('|').map(x=>x.trim()):[line];if(!row.every(cell=>/^:?-{3,}:?$/.test(cell)))sheet.addRow(row);});
  sheet.columns.forEach(column=>{column.width=32;column.alignment={vertical:'top',wrapText:true};});sheet.getRow(1).font={bold:true};return Buffer.from(await book.xlsx.writeBuffer());
 }
 throw new Error('导出格式不支持。');
}
