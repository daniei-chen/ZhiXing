import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DELIVERABLE_VISIBLE_LIMIT,
  deliverableCaption,
  deliverableMoreLabel,
  deliverableName,
  deliverableType,
  splitDeliverables,
} from '../src/deliverable-cards.js';

test('文件名取路径末段，路径缺失时给出占位名', () => {
  assert.equal(deliverableName({ path: '成果\\季度报告.docx' }), '季度报告.docx');
  assert.equal(deliverableName({ path: '/tmp/export/清单.xlsx' }), '清单.xlsx');
  assert.equal(deliverableName({}), '成果文件');
  assert.equal(deliverableName({ path: '   ' }), '成果文件');
});

test('按扩展名给出文件类型', () => {
  assert.equal(deliverableType({ path: 'a报告.dochm' }), '文件');
  assert.equal(deliverableType({ path: '报告.docx' }), 'Word 文档');
  assert.equal(deliverableType({ path: '清单.XLSX' }), '表格');
  assert.equal(deliverableType({ path: '汇报.pptx' }), '演示文稿');
  assert.equal(deliverableType({ path: '说明.pdf' }), 'PDF 文档');
  assert.equal(deliverableType({ path: '封面.png' }), '图片');
  assert.equal(deliverableType({ path: '纪要.md' }), '纯文本');
  assert.equal(deliverableType({ path: '打包.zip' }), '压缩包');
  assert.equal(deliverableType({ path: 'config.json' }), '代码或结构化文本');
});

test('有说明用说明，没有说明用类型', () => {
  assert.equal(deliverableCaption({ path: 'a.docx', description: ' 季度汇总 ' }), '季度汇总');
  assert.equal(deliverableCaption({ path: 'a.docx', description: '   ' }), 'Word 文档');
  assert.equal(deliverableCaption({ path: 'b.pdf' }), 'PDF 文档');
});

test('超过四个才折叠，四个以内全部展示', () => {
  const five = Array.from({ length: 5 }, (_, index) => ({ path: `${index}.pdf` }));
  const four = five.slice(0, 4);
  const many = splitDeliverables(five);
  assert.equal(many.total, 5);
  assert.equal(many.visible.length, DELIVERABLE_VISIBLE_LIMIT);
  assert.equal(many.hidden.length, 1);
  assert.equal(many.collapsible, true);
  assert.equal(splitDeliverables(four).collapsible, false);
  assert.equal(splitDeliverables(undefined).total, 0);
  assert.equal(splitDeliverables([{ path: 'a.pdf' }], 0).visible.length, 0);
});

test('展开提示带上总数，展开后是收起', () => {
  assert.equal(deliverableMoreLabel(5), '展开全部 5 个交付');
  assert.equal(deliverableMoreLabel(5, 4, true), '收起');
  assert.equal(deliverableMoreLabel(3), '');
});
