import{test}from'@playwright/test';
import{floatWhiteBalanceWorkflow}from'./helpers/float-white-balance';
test('float White Balance controls, isolated example, preview cancellation, native files, palette and original-bearing reopening',async({page},info)=>{await floatWhiteBalanceWorkflow(page,info);});
