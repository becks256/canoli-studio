import{test}from'@playwright/test';
import{floatColorWorkflow}from'./helpers/float-color';
test('float HSL, Color Balance and Vibrance controls, isolated example, cancellation, native files and originals',async({page},info)=>{await floatColorWorkflow(page,info);});
