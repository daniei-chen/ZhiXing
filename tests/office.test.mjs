import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {calculate,checkTable} from '../harness/office-tools.mjs';
import {parseOfficeFile,exportOfficeFile} from '../electron/office-files.mjs';
import {nextOccurrence} from '../src/scheduler.js';
test('办公计算与重复缺失检查',()=>{
 assert.equal(calculate([1,2,3],'sum').value,6);assert.equal(calculate([2,4],'average').value,3);assert.throws(()=>calculate([Infinity],'sum'));
 const r=checkTable([['姓名','金额'],['甲',1],['甲',1],['乙',null]]);assert.equal(r.duplicateRows[0].row,3);assert.equal(r.missingCells[0].row,4);
});
test('文本、纯值表格与可编辑成果导出',async()=>{
 const raw='事项\t负责人\n测试\t待确认';assert.equal((await parseOfficeFile('test.txt',Buffer.from(raw))).text,raw);
 const xlsx=await exportOfficeFile(raw,'xlsx');assert((await parseOfficeFile('test.xlsx',xlsx)).text.includes('负责人'));
 const docx=await exportOfficeFile('# 工作报告\n正文','docx');assert.equal(docx.subarray(0,2).toString(),'PK');
 assert.equal((await parseOfficeFile('test.docx',docx)).text,'工作报告\n正文');
 await assert.rejects(parseOfficeFile('test.pdf',Buffer.from('synthetic')),/PDF/);
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('隐藏');sheet.state='hidden';sheet.addRow(['敏感']);const hidden=await parseOfficeFile('hidden.xlsx',Buffer.from(await book.xlsx.writeBuffer()));assert(hidden.text.includes('隐藏工作表'));assert(hidden.warnings.some(text=>text.includes('隐藏')));
 sheet.state='visible';sheet.getCell('A1').value={formula:'1+2',result:3};const formula=await parseOfficeFile('formula.xlsx',Buffer.from(await book.xlsx.writeBuffer()));assert(formula.text.includes('缓存值：3'));assert(formula.warnings.some(text=>text.includes('尚未重算')));
});
test('月末与每周调度按本机日历计算',()=>{
 const anchor=new Date(2026,0,31,10),task={frequency:'每月',time:'09:00',anchorDate:anchor.toISOString()};
 const next=new Date(nextOccurrence(task,+anchor));assert.equal(next.getMonth(),1);assert.equal(next.getDate(),28);
 const week=new Date(nextOccurrence({...task,frequency:'每周'},+anchor));assert.equal(week.getDay(),anchor.getDay());assert(+week>+anchor);
});
