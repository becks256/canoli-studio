import{test}from'@playwright/test';
import{floatDocumentWorkflow}from'./helpers/float-document';
test('normal UI float import, documented exposure, Undo and precise TIFF delivery preserve originals',async({page},info)=>{await floatDocumentWorkflow(page,info);});
