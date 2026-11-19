export const officeConversions = {
 doc: ['pdf','docx','odt','txt'], docx: ['pdf','odt','txt'], odt: ['pdf','docx','txt'],
 xls: ['pdf','xlsx','ods','csv'], xlsx: ['pdf','ods','csv'], ods: ['pdf','xlsx','csv'],
 ppt: ['pdf','pptx','odp'], pptx: ['pdf','odp'], odp: ['pdf','pptx'], pdf: [],
};
export const officeWorkbookFormats = ['xls','xlsx','ods'];
export const officeRecalculationFormats = ['xlsx','ods'];
export const officeExtension = name => name.includes('.') ? name.split('.').at(-1).toLowerCase() : '';
