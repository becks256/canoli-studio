import{test}from'@playwright/test';
import{floatPaletteWorkflow}from'./helpers/float-palette';
test('float Gradient Map and Color Lookup controls, isolated example, Cube files, cancellation, overflow recovery and native delivery',async({page},info)=>{await floatPaletteWorkflow(page,info);});
