import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
import{spawnSync}from'node:child_process';
import{floatWorkerWorkflow}from'./helpers/float-pixels';
test('actual float worker preserves independent masked blend and affine samples beside byte processing',async({page},info)=>{await floatWorkerWorkflow(page,info);});
for(const file of['rgba-raw-le.tif','native-50mp.tif'])test('internal float source/ICC/adjustment/composition/TIFF pipeline retains real precision: '+file,async({page},info)=>{
 test.setTimeout(480000);await page.goto('/');const input='tests/fixtures/tiff-float/'+file,bytes=[...await readFile(input)];const result=await page.evaluate(async bytes=>{
  const source=new Blob([new Uint8Array(bytes)],{type:'image/tiff'}),editor=window.luma.editor,before=JSON.stringify(editor.document.toJSON()),worker=new Worker('/tests/helpers/float-pipeline.worker.ts',{type:'module'});
  try{const result=await new Promise<any>((resolve,reject)=>{worker.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data);worker.onerror=()=>reject(new Error('Native float pipeline worker failed'));worker.postMessage({source});});(window as any).floatPipelineFile=result.tiff;return{width:result.width,height:result.height,windows:result.windows,extended:result.extended,sourceBytes:result.sourceBytes,modelUnchanged:before===JSON.stringify(editor.document.toJSON())};}finally{worker.terminate();}
 },bytes);expect(result.modelUnchanged).toBe(true);expect(result.extended).toBeGreaterThan(0);expect(result.sourceBytes).toBe(bytes.length);
 const pending=page.waitForEvent('download');await page.evaluate(()=>{const a=document.createElement('a');a.href=URL.createObjectURL((window as any).floatPipelineFile);a.download='float-processing.tif';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});const path=info.outputPath(file.replace('.tif','-processed.tif'));await(await pending).saveAs(path);const checked=spawnSync('python3',['scripts/check-float-pipeline.py',path,'--source',input,'--native-lcms','/tmp/canoli-color-lcms2.19.1-native.so'],{encoding:'utf8',timeout:180000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);await writeFile(info.outputPath(file.replace('.tif','-processing.json')),JSON.stringify({...result,independent:JSON.parse(checked.stdout)},null,2));
});
