import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{createHash}from'node:crypto';
import{spawnSync}from'node:child_process';
import{floatDocumentWorkflow}from'./helpers/float-document';
const base='tests/fixtures/uint16-float/';
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');

test('normal uint16 import UI preserves every low-order level through documented exposure, Undo, precision delivery and project reopening',async({page},info)=>{await floatDocumentWorkflow(page,info,false,base+'u16-all-levels.tif');});

test('unprofiled uint16 UI requires interpretation only for float editing and keeps explicit byte-conversion consent',async({page},info)=>{
 await page.goto('/');await page.getByTestId('import-input').setInputFiles(base+'u16-gray-black.tif');const dialog=page.getByRole('dialog',{name:'Import TIFF',exact:true}),accept=dialog.getByRole('button',{name:'Import TIFF page',exact:true});await expect(accept).toBeDisabled();await expect(dialog.getByLabel('TIFF color interpretation',{exact:true})).toHaveCount(0);await dialog.getByLabel('Convert this page to 8-bit editing precision').check();await expect(accept).toBeEnabled();
 await dialog.getByLabel('TIFF editing precision',{exact:true}).selectOption('float32');await expect(dialog.getByLabel('Convert this page to 8-bit editing precision')).toHaveCount(0);await expect(accept).toBeDisabled();await dialog.getByLabel('TIFF color interpretation',{exact:true}).selectOption('linear-srgb');await expect(accept).toBeEnabled();await accept.click();await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>({precision:window.luma.editor.document.precision,color:window.luma.editor.assetStore.values()[0].tiffColor?.source}))).toMatchObject({precision:'float32',color:{kind:'assumed',id:'linear-srgb'}});await page.screenshot({path:info.outputPath('uint16-explicit-color.png')});
});

test('real uint16 source and document workers retain every independent native word across ten source layouts',async({page},info)=>{
 test.setTimeout(240000);await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const manifest=JSON.parse(await readFile(base+'manifest.json','utf8')),results=[];
 for(const row of manifest.cases.filter((r:{width:number})=>r.width<10000)){
  const raw=gunzipSync(await readFile(base+row.reference)),expected=new Float32Array(new Uint8Array(raw).buffer);for(let i=0;i<expected.length;i+=4)if(!expected[i+3])expected.fill(0,i,i+3);
  const actual=await page.evaluate(async({bytes,row})=>{
   const{editor}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],row.file,{type:'image/tiff'}),{editingPrecision:'float32',...(row.assumption?{floatColorSpace:row.assumption}:{})});
   const before=editor.document.toJSON(),read=async()=>{const scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);try{const pixels=await scene.read({x:0,y:0,width:row.width,height:row.height});return[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels.buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');}finally{scene.dispose();}},digest=await read(),project=await editor.saveProject();
   await editor.openProject(new File([project],'unsigned-source.luma'));const reopened=await read(),asset=editor.assetStore.values()[0],originalHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
   return{digest,reopened,originalHash,modelExact:JSON.stringify(before)===JSON.stringify(editor.document.toJSON()),precision:editor.document.precision,dimensions:[asset.width,asset.height],preview:[asset.bitmap.width,asset.bitmap.height]};
  },{bytes:[...await readFile(base+row.file)],row});
  expect(actual).toMatchObject({digest:hash(new Uint8Array(expected.buffer)),reopened:hash(new Uint8Array(expected.buffer)),originalHash:row.sourceSha256,modelExact:true,precision:'float32',dimensions:[row.width,row.height]});expect(Math.max(...actual.preview)).toBeLessThanOrEqual(96);results.push({file:row.file,...actual});
 }
 await writeFile(info.outputPath('uint16-original-layouts.json'),JSON.stringify(results,null,2));
});

test('genuine 50 MP uint16 original retains native geometry, precision, source bytes and exact independent files through edits and reopening',async({page},info)=>{
 test.setTimeout(600000);await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const file='u16-native-50mp.tif';
 const result=await page.evaluate(async bytes=>{
  const{editor,RasterLayer,ToneAdjustment}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],'50 MP unsigned original.tif',{type:'image/tiff'}),{editingPrecision:'float32'});
  const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),initial=editor.document.toJSON(),asset=editor.assetStore.values()[0],originalHash=await hash(asset.blob),layer=editor.document.layers.at(0);if(!(layer instanceof RasterLayer))throw new Error('Expected raster');layer.adjustments.add(new ToneAdjustment({exposure:1}));const edited=editor.document.toJSON();editor.document.undo();const undo=JSON.stringify(editor.document.toJSON())===JSON.stringify(initial);editor.document.redo();const project=await editor.saveProject();await editor.openProject(new File([project],'50mp-u16.luma'));
  const reopened=editor.assetStore.values()[0],outputs:Record<string,Blob>={};for(const precision of['float32','uint16']as const)outputs[precision]=(await editor.export({format:'tiff',tiffPrecision:precision})).blob;(window as any).uint16Outputs=outputs;
  return{precision:editor.document.precision,dimensions:[editor.document.width,editor.document.height],sourceDimensions:[reopened.width,reopened.height],preview:[reopened.bitmap.width,reopened.bitmap.height],undo,reopened:JSON.stringify(editor.document.toJSON())===JSON.stringify(edited),originalExact:originalHash===await hash(reopened.blob),originalHash,outputSizes:Object.fromEntries(Object.entries(outputs).map(([key,value])=>[key,value.size]))};
 },[...await readFile(base+file)]);
 expect(result).toMatchObject({precision:'float32',dimensions:[10000,5000],sourceDimensions:[10000,5000],preview:[96,48],undo:true,reopened:true,originalExact:true});const independent=[];
 for(const precision of['float32','uint16']){const pending=page.waitForEvent('download');await page.evaluate(precision=>{const a=document.createElement('a');a.href=URL.createObjectURL((window as any).uint16Outputs[precision]);a.download=precision+'.tif';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},precision);const path=info.outputPath('50mp-u16-'+precision+'.tif');await(await pending).saveAs(path);const checked=spawnSync('python3',['scripts/check-float-document.py',path,'--source-name',file,'--native-lcms','/tmp/canoli-color-lcms2.19.1-native.so','--precision',precision],{encoding:'utf8',timeout:180000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);independent.push(JSON.parse(checked.stdout));}
 await writeFile(info.outputPath('uint16-native-50mp.json'),JSON.stringify({...result,independent},null,2));
});

for(const failure of['cancel','callback-error','host-edit']as const)test('uint16 native import '+failure+' publishes neither precision nor staged source',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const result=await page.evaluate(async({bytes,failure})=>{
  const{editor}=window.luma,before=JSON.stringify(editor.document.toJSON()),assets=editor.assetStore.values().map(a=>a.id),abort=new AbortController();let injected=false,error='';try{await editor.openTiff(new File([new Uint8Array(bytes)],'Interrupted uint16.tif',{type:'image/tiff'}),{editingPrecision:'float32'},{signal:abort.signal,onProgress:p=>{if(p.phase==='decoding'&&!injected){injected=true;if(failure==='cancel')abort.abort();else if(failure==='callback-error')throw new Error('Uint16 progress fixture');else editor.document.name='Human edit retained';}}});}catch(e){error=String(e);}return{injected,error,precision:editor.document.precision,sameAssets:JSON.stringify(assets)===JSON.stringify(editor.assetStore.values().map(a=>a.id)),sameModel:JSON.stringify(editor.document.toJSON())===before,name:editor.document.name};
 },{bytes:[...await readFile(base+'u16-all-levels.tif')],failure});expect(result).toMatchObject({injected:true,precision:'uint8',sameAssets:true});expect(result.error).toMatch(failure==='cancel'?/abort/i:failure==='callback-error'?/Uint16 progress fixture/:/changed/i);if(failure==='host-edit')expect(result.name).toBe('Human edit retained');else expect(result.sameModel).toBe(true);
});
