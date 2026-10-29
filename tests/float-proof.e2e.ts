import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
import{spawnSync}from'node:child_process';
import{createHash}from'node:crypto';

const frames=JSON.parse(await readFile('tests/fixtures/float-frame/manifest.json','utf8'));
for(const device of['narrow-rgb','synthetic-cmyk'])for(const gamut of[false,true])test(`float ${device} proof gamut ${gamut} follows complete native composition and all 21 frame geometries`,async({page},info)=>{
 test.setTimeout(180000);await page.goto('/');await page.evaluate(async bytes=>{await window.luma.editor.openTiff(new File([new Uint8Array(bytes)],'Proof frame original.tif',{type:'image/tiff'}),{editingPrecision:'float32'});},[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);
 const profile=[...await readFile('tests/fixtures/icc-native/'+device+'.icc')],rows=[];
 for(let index=0;index<frames.cases.length;index++){
  const row=frames.cases[index],actual=await page.evaluate(async({row,profile,gamut})=>{
   const{editor,RasterLayer,LayerGroup,AdjustmentLayer,LayerMask,MarqueeSelection,ToneAdjustment,AffineTransform}=window.luma,asset=editor.assetStore.values()[0];
   const build=(spec:any):any=>{const{kind,children,adjustment,tone,tones,mask,...options}=spec,layer=kind==='raster'?new RasterLayer({...options,assetId:asset.id,width:131,height:79}):kind==='group'?new LayerGroup(options):new AdjustmentLayer({...options,adjustment:adjustment??{kind:'tone',exposure:0,contrast:0,saturation:0,...tone}});if(mask)layer.mask=new LayerMask({linked:false,density:mask.density??1,inverted:mask.inverted??false,selection:new MarqueeSelection({shape:'rectangle',x:mask.rect[0],y:mask.rect[1],width:mask.rect[2],height:mask.rect[3]})});if(layer instanceof RasterLayer)for(const setting of tones??[])layer.adjustments.add(new ToneAdjustment(setting));if(layer instanceof LayerGroup)for(const child of children)layer.layers.add(build(child));return layer;};
   editor.document.transaction('Complete native proof scene',()=>{for(const layer of[...editor.document.layers])layer.remove();for(const spec of row.layers)editor.document.layers.add(build(spec));});
   const model=editor.document.toJSON(),before=JSON.stringify(model),resource=await editor.inspectColorProfile(new Blob([new Uint8Array(profile)]),'Independent proof device'),f=row.frame,frame={region:f.region,width:f.width,height:f.height,rootTransform:new AffineTransform(...f.root)},scene=await editor.renderer.captureFloatScene(model,editor.assetStore);
   try{
    const samples=await scene.read({x:0,y:0,width:f.width,height:f.height},frame),options={region:f.region,outputSize:{width:f.width,height:f.height},rootTransform:frame.rootTransform,colorProof:{profile:resource,intent:'relative-colorimetric' as const,proofIntent:'relative-colorimetric' as const,blackPointCompensation:false,gamutWarning:gamut,warningColor:'#c731e9'}},prepared=await editor.renderer.prepareViewport(model,editor.assetStore,options);
    try{const canvas=document.createElement('canvas');prepared.present(canvas);const context=canvas.getContext('2d')!;return{samples:[...new Uint8Array(samples.buffer)],pixels:[...context.getImageData(0,0,canvas.width,canvas.height).data],width:canvas.width,height:canvas.height,backend:prepared.backend,modelExact:before===JSON.stringify(editor.document.toJSON())};}finally{prepared.dispose();}
   }finally{scene.dispose();}
  },{row,profile,gamut});
  expect(actual.modelExact).toBe(true);expect(actual.backend).toBe('canvas2d');expect([actual.width,actual.height]).toEqual([row.frame.width,row.frame.height]);
  const prefix=`proof-${index}-${row.scene}-${row.frame.name}`,source=info.outputPath(prefix+'.f32le'),expected=info.outputPath(prefix+'.rgba');await writeFile(source,new Uint8Array(actual.samples));await writeFile(info.outputPath(prefix+'-canvas.rgba'),new Uint8Array(actual.pixels));
  const check=spawnSync('python3',['scripts/reference-float-proof.py',source,expected,'--native-lcms','/tmp/canoli-color-lcms2.19.1-native.so','--device',device,...(gamut?['--gamut']:[])],{encoding:'utf8',timeout:30000});expect(check.status,check.stderr||check.stdout).toBe(0);
  const normalized=await page.evaluate(({bytes,width,height})=>{const raw=document.createElement('canvas');raw.width=width;raw.height=height;raw.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(bytes),width,height),0,0);const shown=document.createElement('canvas');shown.width=width;shown.height=height;shown.getContext('2d')!.drawImage(raw,0,0);return[...shown.getContext('2d')!.getImageData(0,0,width,height).data];},{bytes:[...await readFile(expected)],width:actual.width,height:actual.height});
  let differences=0,maximum=0;for(let i=0;i<normalized.length;i++){if(normalized[i]!==actual.pixels[i])differences++;maximum=Math.max(maximum,Math.abs(normalized[i]-actual.pixels[i]));}
  rows.push({scene:row.scene,frame:row.frame.name,channels:normalized.length,differences,maximum,modelExact:actual.modelExact,reference:JSON.parse(check.stdout)});expect(differences).toBe(0);
 }
 await writeFile(info.outputPath('native-complete-float-proofs.json'),JSON.stringify({device,gamut,cases:rows,scope:'Independent native CMM applied to actual captured completed float frames; frame scene fidelity is verified separately against the unchanged independent float-frame corpus.'},null,2));
});

test('a queued float proof aborts on renderer disposal before unrelated ICC owners close and retry stays healthy',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async bytes=>{
  const{editor}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),{acquireIccOwner}=await import(/* @vite-ignore */String('/src/core/color/icc-client.ts'));
  await editor.openTiff(new File([new Uint8Array(bytes)],'Queued proof original.tif',{type:'image/tiff'}),{editingPrecision:'float32'});const model=editor.document.toJSON(),renderer=new CanvasRenderer(),assets=editor.assetStore,source=await renderer.captureFloatScene(model,assets);source.dispose();const a=await acquireIccOwner(),b=await acquireIccOwner();let result='';
  try{const pending=renderer.render(model,assets,{colorProof:{profile:'display-p3',intent:'relative-colorimetric',proofIntent:'perceptual',blackPointCompensation:true,gamutWarning:true,warningColor:'#c731e9'}}).then((canvas:HTMLCanvasElement)=>{canvas.width=canvas.height=0;return'Unexpected completion';},(error:unknown)=>String(error));await new Promise(resolve=>setTimeout(resolve,0));renderer.dispose();let timer:ReturnType<typeof setTimeout>|undefined;try{result=await Promise.race([pending,new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('Timed out'),1000);})]);}finally{clearTimeout(timer);}a();b();await pending;
   const retry=new CanvasRenderer();try{const canvas=await retry.render(model,assets,{colorProof:{profile:'display-p3',intent:'relative-colorimetric',proofIntent:'perceptual',blackPointCompensation:true,gamutWarning:true,warningColor:'#c731e9'}}),width=canvas.width,height=canvas.height;canvas.width=canvas.height=0;return{result,width,height,modelExact:JSON.stringify(model)===JSON.stringify(editor.document.toJSON())};}finally{retry.dispose();}
  }finally{a();b();renderer.dispose();}
 },[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);expect(result.result).toMatch(/closed|superseded|abort/i);expect(result).toMatchObject({width:131,height:79,modelExact:true});await writeFile(info.outputPath('queued-float-proof-disposal.json'),JSON.stringify(result,null,2));
});

test('a genuine 50 MP original retains exact sources and complete proof-independent PNG delivery',async({page},info)=>{
 test.setTimeout(600000);const original=await readFile('tests/fixtures/uint16-float/u16-native-50mp.tif');await page.goto('/');const result=await page.evaluate(async bytes=>{
  const{editor}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],'50 MP proof original.tif',{type:'image/tiff'}),{editingPrecision:'float32'});const model=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,asset=editor.assetStore.values()[0],sourceHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const plain=(await editor.export({format:'png',color:{profile:'srgb'}})).blob;
  await editor.setColorSettings({output:editor.colorSettings.output,proof:{profile:'display-p3',intent:'relative-colorimetric',proofIntent:'relative-colorimetric',blackPointCompensation:false,gamutWarning:true,warningColor:'#c731e9'}});
  const proof=(await editor.export({format:'png',color:{profile:'srgb'}})).blob;
  const frame=await editor.renderer.prepareViewport(editor.document.toJSON(),editor.assetStore,{outputSize:{width:500,height:250},colorProof:editor.colorSettings.proof});let dimensions:number[]=[];try{const canvas=document.createElement('canvas');frame.present(canvas);dimensions=[canvas.width,canvas.height];}finally{frame.dispose();}
  const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
  (window as any).floatProofLarge={plain,proof};return{originalDimensions:[asset.width,asset.height],previewDimensions:dimensions,sourceHash,plainHash:await hash(plain),proofHash:await hash(proof),modelExact:model===JSON.stringify(editor.document.toJSON()),revisionExact:revision===editor.document.getSnapshot().revision};
 },[...original]);expect(result).toMatchObject({originalDimensions:[10000,5000],previewDimensions:[500,250],modelExact:true,revisionExact:true});expect(result.sourceHash).toBe(createHash('sha256').update(original).digest('hex'));expect(result.plainHash).toBe(result.proofHash);
 const pending=page.waitForEvent('download');await page.evaluate(()=>{const a=document.createElement('a');a.href=URL.createObjectURL((window as any).floatProofLarge.proof);a.download='50mp-proof-independent.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});const path=info.outputPath('50mp-proof-independent.png');await(await pending).saveAs(path);
 const checked=spawnSync(process.env.CANOLI_PDF_PYTHON||'python3',['scripts/check-float-document.py',path,'--source-name','u16-native-50mp.tif','--native-lcms','/tmp/canoli-color-lcms2.19.1-native.so','--precision','uint8','--profile','srgb','--exposure','0'],{encoding:'utf8',timeout:180000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);await writeFile(info.outputPath('50mp-float-proof.json'),JSON.stringify({...result,independent:JSON.parse(checked.stdout)},null,2));
});

test('a native float proof window failure hides stale artwork and the same settings recover through a genuine retry',async({page},info)=>{
 await page.goto('/');await page.evaluate(async bytes=>{await window.luma.editor.openTiff(new File([new Uint8Array(bytes)],'Proof failure original.tif',{type:'image/tiff'}),{editingPrecision:'float32'});},[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);
 await expect(page.locator('.canvas-status')).toContainText('Ready');const before=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()));
 await page.evaluate(async()=>{
  const{IccSession}=await import(/* @vite-ignore */String('/src/core/color/icc-client.ts')),original=IccSession.prepareProof,prepare=original.bind(IccSession);let completed=0;
  IccSession.prepareProof=async(...args:Parameters<typeof original>)=>{const result=await prepare(...args),apply=result.session.applyWindow.bind(result.session);result.session.applyWindow=async(samples:Float32Array)=>{await apply(samples);completed++;throw new Error('Native float proof window failure fixture');};return result;};
  (window as any).restoreFloatProof=()=>{IccSession.prepareProof=original;return completed;};
  const e=window.luma.editor;await e.setColorSettings({output:e.colorSettings.output,proof:{profile:'display-p3',intent:'relative-colorimetric',proofIntent:'relative-colorimetric',blackPointCompensation:false,gamutWarning:true,warningColor:'#c731e9'}});
 });
 await expect(page.getByTestId('proof-status')).toContainText('failed');await expect(page.getByTestId('artwork')).toBeHidden();await expect(page.getByRole('alert').filter({hasText:'Native float proof window failure fixture'})).toBeVisible();expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before);
 const completed=await page.evaluate(async()=>{const count=(window as any).restoreFloatProof();await window.luma.editor.setColorSettings(window.luma.editor.colorSettings);return count;});expect(completed).toBeGreaterThan(0);
 await expect(page.getByTestId('proof-status')).toContainText('applied');await expect(page.getByTestId('artwork')).toBeVisible();expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before);await writeFile(info.outputPath('float-proof-failure-retry.json'),JSON.stringify({realNativeWindowsBeforeInjectedFailure:completed,staleArtworkHidden:true,modelExact:true,identicalProofSettingsRetried:true,healthyNativePresentation:true},null,2));
});
