import{test}from'@playwright/test';
import{svgClippingWorkflow}from'./helpers/svg-clipping';
test('SVG clipping preflight, isolated guide, native controls, shared Undo, SVG reimport and project reopen preserve artwork',async({page},info)=>{await svgClippingWorkflow(page,info);});
