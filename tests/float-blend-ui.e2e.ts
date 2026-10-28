import{test}from'@playwright/test';
import{floatBlendWorkflow,floatBlendDomainWorkflow}from'./helpers/float-blend';
test('ordinary normalized float blend controls display and export every native mode with shared Undo and original-bearing reopening',async({page},info)=>{await floatBlendWorkflow(page,info,process.env.CANOLI_FLOAT_BLEND_PRODUCTION==='1');});
test('float blend domain failures hide stale artwork, disclose failed previews and recover through Normal and Undo',async({page},info)=>{await floatBlendDomainWorkflow(page,info,process.env.CANOLI_FLOAT_BLEND_PRODUCTION==='1');});
