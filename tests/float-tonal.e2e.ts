import {test, expect, type Page} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';
import {gzipSync, gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {floatTonalWorkflow} from './helpers/float-tonal';

const original='tests/fixtures/uint16-float/u16-raw.tif';
async function open(page:Page){
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  await page.evaluate(async bytes=>{await window.luma.editor.openTiff(new File([new Uint8Array(bytes)],'Tonal original.tif',{type:'image/tiff'}),{editingPrecision:'float32'});},[...await readFile(original)]);
}

test('real float worker matches all independent tonal references and owns caller buffers',async({page},info)=>{
  await page.goto('/');
  const directory='tests/fixtures/float-tonal/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'));
  const source=new Float32Array(new Uint8Array(gunzipSync(await readFile(directory+'source.f32le.gz'))).buffer),coverage=new Float32Array(new Uint8Array(gunzipSync(await readFile(directory+'coverage.f32le.gz'))).buffer),records=[];
  for(const row of manifest.cases){
    const actual=await page.evaluate(async({input,coverage,options})=>{
      const {PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts')),processor=new PixelProcessor(),source=new Float32Array(input),mask=new Float32Array(coverage);
      try{const pending=processor.floatTonal(source,mask,options);source.fill(0);mask.fill(0);options.exposure=0;return [...await pending];}finally{processor.dispose();}
    },{input:[...source],coverage:[...coverage],options:structuredClone(row.options)});
    const output=new Float32Array(actual),expected=new Float32Array(new Uint8Array(gunzipSync(await readFile(directory+row.reference))).buffer);let maximum=0;
    for(let i=0;i<output.length;i++)if(i%4===3)expect(new Uint32Array(output.buffer)[i]).toBe(new Uint32Array(source.buffer)[i]);else maximum=Math.max(maximum,Math.abs(output[i]-expected[i])/Math.max(1,Math.abs(expected[i])));
    expect(maximum).toBeLessThanOrEqual(manifest.tolerance);records.push({options:row.options,maximum,samples:output.length});
  }
  await writeFile(info.outputPath('float-tonal-worker.json'),JSON.stringify(records,null,2));
});

test('existing byte tonal strokes convert through native preflight and precision Undo restores the original operator',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async bytes=>{
    const {editor,AdjustmentLayer,TonalStroke,BrushStroke,RasterLayer}=window.luma;
    await editor.openTiff(new File([new Uint8Array(bytes)],'Byte tonal original.tif',{type:'image/tiff'}),{allowPrecisionLoss:true});
    const source=editor.document.layers.at(0) as InstanceType<typeof RasterLayer>,originalId=source.assetId;
    editor.document.layers.add(new RasterLayer({name:'Hidden shared original',assetId:originalId,width:source.width,height:source.height,visible:false}));
    const layer=editor.document.layers.add(new AdjustmentLayer({adjustment:{kind:'tonal',strokes:[]}}));
    layer.addTonalStroke(new TonalStroke({brush:new BrushStroke({points:[{x:64,y:40,pressure:1}],size:2048,hardness:1,opacity:1,flow:1}),mode:'burn',range:'highlights',exposure:.625}));
    const before=JSON.stringify(editor.document.toJSON()),past=editor.document.getSnapshot().past.length,bytePng=[...new Uint8Array(await(await editor.exportPng()).arrayBuffer())];
    await editor.convertDocumentToFloat();const converted=JSON.stringify(editor.document.toJSON()),oneUndo=editor.document.getSnapshot().past.length===past+1;
    const asset=editor.assetStore.get((editor.document.layers.at(0)!.toJSON() as {assetId:string}).assetId),width=asset.width,height=asset.height;
    const shared=(editor.document.layers.at(1) as InstanceType<typeof RasterLayer>).assetId===asset.id,views=editor.assetStore.values().length,originalRetained=asset.id!==originalId&&asset.blob===editor.assetStore.get(originalId).blob&&editor.assetStore.get(originalId).tiff?.editingPrecision===undefined;
    const scene=await editor.renderer.captureFloatScene(editor.document.getSnapshot().document,editor.assetStore);let pixels!:Float32Array;
    try{pixels=await scene.read({x:0,y:0,width,height});}finally{scene.dispose();}
    const floatPng=[...new Uint8Array(await(await editor.exportPng()).arrayBuffer())];editor.document.undo();const undo=JSON.stringify(editor.document.toJSON())===before,undoPng=[...new Uint8Array(await(await editor.exportPng()).arrayBuffer())];
    editor.document.redo();const redo=JSON.stringify(editor.document.toJSON())===converted,project=await editor.saveProject();await editor.openProject(new File([project],'converted-tonal.luma'));
    const reopened=await editor.renderer.captureFloatScene(editor.document.getSnapshot().document,editor.assetStore);let exact=false;
    try{const after=await reopened.read({x:0,y:0,width,height});exact=new Uint32Array(after.buffer).every((value,index)=>value===new Uint32Array(pixels.buffer)[index]);}finally{reopened.dispose();}
    return{pixels:[...pixels],width,height,oneUndo,undo,redo,reopened:exact,shared,views,originalRetained,bytePng,floatPng,undoPng};
  },[...await readFile(original)]);
  expect(result).toMatchObject({oneUndo:true,undo:true,redo:true,reopened:true,shared:true,views:2,originalRetained:true});expect(result.undoPng).toEqual(result.bytePng);expect(result.floatPng).not.toEqual(result.bytePng);
  const baseline=new Float32Array(new Uint8Array(gunzipSync(await readFile('tests/fixtures/uint16-float/u16-raw-linear.f32le.gz'))).buffer);
  for(let i=0;i<baseline.length;i+=4)if(baseline[i+3]===0)baseline.fill(0,i,i+3);
  const before=info.outputPath('converted-source.f32le.gz'),actual=info.outputPath('converted-tonal.f32le.gz'),coverage=info.outputPath('converted-coverage.f32le.gz');
  await writeFile(before,gzipSync(new Uint8Array(baseline.buffer)));await writeFile(actual,gzipSync(new Uint8Array(new Float32Array(result.pixels).buffer)));await writeFile(coverage,gzipSync(new Uint8Array(new Float32Array(result.width*result.height).fill(1).buffer)));
  const record=info.outputPath('converted-tonal.json');await writeFile(record,JSON.stringify({before,actual,strokes:[{coverage,options:{mode:'burn',range:'highlights',exposure:.625,protectTones:true}}]},null,2));
  const checked=spawnSync(process.env.CANOLI_REFERENCE_PYTHON??'python3',['scripts/check-float-tonal.py',record],{encoding:'utf8',timeout:60000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);await writeFile(info.outputPath('converted-tonal-reader.json'),checked.stdout);
});

test('legacy TIFF precision staging releases new asset views on cancellation and concurrent edits before a healthy retry',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],'Staged original.tif',{type:'image/tiff'}),{allowPrecisionLoss:true});
    const assets=editor.assetStore,add=assets.add.bind(assets),before=JSON.stringify(editor.document.toJSON()),controller=new AbortController();let cancelled='',stale='';
    assets.add=async(...args:Parameters<typeof add>)=>{const asset=await add(...args);controller.abort();return asset;};
    try{await editor.convertDocumentToFloat({signal:controller.signal});}catch(error){cancelled=String(error);}finally{assets.add=add;}
    const cancellationExact=JSON.stringify(editor.document.toJSON())===before&&assets.values().length===1;
    assets.add=async(...args:Parameters<typeof add>)=>{const asset=await add(...args);editor.document.layers.at(0)!.opacity=.75;return asset;};
    try{await editor.convertDocumentToFloat();}catch(error){stale=String(error);}finally{assets.add=add;}
    const editRetained=editor.document.precision==='uint8'&&editor.document.layers.at(0)!.opacity===.75&&assets.values().length===1;
    await editor.convertDocumentToFloat();return{cancelled,stale,cancellationExact,editRetained,retry:editor.document.precision,views:assets.values().length};
  },[...await readFile(original)]);
  expect(result).toMatchObject({cancellationExact:true,editRetained:true,retry:'float32',views:2});expect(result.cancelled).toMatch(/abort/i);expect(result.stale).toMatch(/changed/i);
  await writeFile(info.outputPath('legacy-precision-staging.json'),JSON.stringify(result,null,2));
});

test('legacy unsigned TIFF conversion never inherits the byte decoder implicit color assumption',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],'Unprofiled original.tif',{type:'image/tiff'}),{allowPrecisionLoss:true});
    const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;let error='';
    try{await editor.convertDocumentToFloat();}catch(value){error=String(value);}
    return{error,exact:before===JSON.stringify(editor.document.toJSON())&&revision===editor.document.getSnapshot().revision,views:editor.assetStore.values().length};
  },[...await readFile('tests/fixtures/tiff/gray16-le.tif')]);
  expect(result).toMatchObject({exact:true,views:1});expect(result.error).toMatch(/assum|color.*space|profile/i);await writeFile(info.outputPath('unprofiled-legacy-precision.json'),JSON.stringify(result,null,2));
});

test('precision source replacements cannot swap originals or bypass locked content through nested commands',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async({bytes,other})=>{
    const {editor,RasterLayer}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],'Locked original.tif',{type:'image/tiff'}),{allowPrecisionLoss:true});
    const raster=editor.document.layers.at(0) as InstanceType<typeof RasterLayer>;raster.locked=true;
    const unrelated=await editor.assetStore.add(new Blob([new Uint8Array(other)],{type:'image/tiff'}),'Unrelated original',undefined,false,{tiff:{editingPrecision:'float32'}}),before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;let rejected='',repeated='';
    try{editor.document._dispatch({type:'transaction',label:'Invalid precision sources',commands:[{type:'document.precision.float',sources:[{layerId:raster.id,assetId:unrelated.id}]}]});}catch(error){rejected=String(error);}
    const exact=JSON.stringify(editor.document.toJSON())===before&&editor.document.getSnapshot().revision===revision;
    await editor.convertDocumentToFloat();const converted=JSON.stringify(editor.document.toJSON());
    try{editor.document._dispatch({type:'document.precision.float',sources:[{layerId:raster.id,assetId:raster.assetId}]});}catch(error){repeated=String(error);}
    const repeatedExact=JSON.stringify(editor.document.toJSON())===converted;editor.document.undo();
    return{rejected,repeated,exact,repeatedExact,locked:raster.locked,undo:JSON.stringify(editor.document.toJSON())===before};
  },{bytes:[...await readFile(original)],other:[...await readFile('tests/fixtures/uint16-float/u16-associated.tif')]});
  expect(result).toMatchObject({exact:true,repeatedExact:true,locked:true,undo:true});expect(result.rejected).toMatch(/same original TIFF/);expect(result.repeated).toMatch(/byte-to-float/);await writeFile(info.outputPath('precision-source-identity.json'),JSON.stringify(result,null,2));
});

test('float tonal scenes preserve affine brush coverage, fixed-grid partitions, masks, original sources and exact history/reopening',async({page},info)=>{
  await open(page);
  const result=await page.evaluate(async()=>{
    const {editor,LayerGroup,AdjustmentLayer,TonalStroke,BrushStroke,PencilStroke,BrushTip,BrushTexture,BrushSymmetry,PressureCurve,AffineTransform,LayerMask,MarqueeSelection}=window.luma;
    const {renderRetouchCoverage}=await import(/* @vite-ignore */String('/src/engine/retouch.ts')),{layerTransform}=await import(/* @vite-ignore */String('/src/core/spatial.ts'));
    const doc=editor.document,before=JSON.stringify(doc.toJSON()),asset=editor.assetStore.values()[0],width=asset.width,height=asset.height;
    const read=async()=>{const scene=await editor.renderer.captureFloatScene(doc.getSnapshot().document,editor.assetStore);try{return await scene.read({x:0,y:0,width,height});}finally{scene.dispose();}};
    const base=await read(),settings=[{mode:'dodge' as const,range:'midtones' as const,exposure:.625,protectTones:false},{mode:'burn' as const,range:'highlights' as const,exposure:.375,protectTones:true}];
    const image=new OffscreenCanvas(2,2),context=image.getContext('2d')!;context.fillRect(0,0,2,2);context.fillStyle='#ffffff';context.fillRect(1,0,1,2);
    const textureAsset=await editor.assetStore.add(await image.convertToBlob({type:'image/png'}),'Tonal texture',undefined,false);image.width=image.height=0;
    const texture=new BrushTexture({assetId:textureAsset.id});
    const brushes=[new PencilStroke({points:[{x:12,y:25,pressure:.5},{x:100,y:31,pressure:1}],size:21,opacity:.75,flow:.625,pressureCurve:PressureCurve.soft()}),new BrushStroke({points:[{x:18,y:40,pressure:.25,tilt:{altitude:.65,azimuth:.25}},{x:90,y:42,pressure:.8}],size:31,hardness:.25,flow:.375,opacity:.625,pressureCurve:PressureCurve.firm(),tip:new BrushTip({roundness:.625,angle:.35,tiltAngle:true,tiltRoundness:true}),symmetry:BrushSymmetry.mirrorVertical(64),texture})];
    let layer!:InstanceType<typeof AdjustmentLayer>;
    doc.transaction('Float tonal scene',()=>{
      const group=doc.layers.add(new LayerGroup({name:'Tonal parent',x:4.25,y:-2.5,blendMode:'pass-through',opacity:.75}));group.transform=new AffineTransform(1,.125,-.0625,1,0,0);
      layer=group.layers.add(new AdjustmentLayer({name:'Tonal correction',x:2,y:1,opacity:.625,fillOpacity:.5,adjustment:{kind:'tonal',strokes:[]}}));
      layer.mask=new LayerMask({linked:false,selection:new MarqueeSelection({shape:'rectangle',x:20,y:10,width:80,height:40})});
      brushes.forEach((brush,index)=>layer.addTonalStroke(new TonalStroke({brush,...settings[index]})));
    });
    const model=JSON.stringify(doc.toJSON()),world=layerTransform(doc.getSnapshot().document,layer.id)!,coverage=[];
    for(const brush of brushes){const mask=await renderRetouchCoverage(brush.toJSON(),{x:0,y:0,width,height,sx:1,sy:1},editor.renderer.processor,world,editor.assetStore);coverage.push([...Float32Array.from(mask as Uint8Array,value=>value/255)]);}
    const scene=await editor.renderer.captureFloatScene(doc.getSnapshot().document,editor.assetStore);let output!:Float32Array,different=0;
    try{output=await scene.read({x:0,y:0,width,height});const words=new Uint32Array(output.buffer);
      for(let y=0;y<height;y+=19)for(let x=0;x<width;x+=37){const w=Math.min(37,width-x),h=Math.min(19,height-y),part=await scene.read({x,y,width:w,height:h}),values=new Uint32Array(part.buffer);for(let row=0;row<h;row++)for(let column=0;column<w*4;column++)if(values[row*w*4+column]!==words[((y+row)*width+x)*4+column])different++;}
    }finally{scene.dispose();}
    doc.undo();const undo=JSON.stringify(doc.toJSON())===before;doc.redo();const redo=JSON.stringify(doc.toJSON())===model;
    const project=await editor.saveProject();await editor.openProject(new File([project],'tonal-roundtrip.luma'));
    const restored=await editor.renderer.captureFloatScene(editor.document.getSnapshot().document,editor.assetStore);let reopened=false;
    try{const samples=await restored.read({x:0,y:0,width,height});reopened=new Uint32Array(samples.buffer).every((word,index)=>word===new Uint32Array(output.buffer)[index]);}finally{restored.dispose();}
    return{width,height,base:[...base],output:[...output],coverage,settings,partitionsDifferent:different,undo,redo,reopened,modelExact:JSON.stringify(editor.document.toJSON())===model,
      sourceSha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await editor.assetStore.get(asset.id).blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('')};
  });
  expect(result).toMatchObject({partitionsDifferent:0,undo:true,redo:true,reopened:true,modelExact:true,sourceSha256:createHash('sha256').update(await readFile(original)).digest('hex')});
  const save=async(name:string,values:number[])=>{const path=info.outputPath(name);await writeFile(path,gzipSync(new Uint8Array(new Float32Array(values).buffer)));return path;};
  const before=await save('tonal-base.f32le.gz',result.base),actual=await save('tonal-corrected.f32le.gz',result.output),strokes=[];
  for(let i=0;i<result.settings.length;i++)strokes.push({options:result.settings[i],coverage:await save('tonal-coverage-'+i+'.f32le.gz',result.coverage[i])});
  const record=info.outputPath('tonal-scene.json');await writeFile(record,JSON.stringify({before,actual,strokes,width:result.width,height:result.height,opacity:.625*.5,groupOpacity:.75,mask:[20,10,80,40]},null,2));
  const checked=spawnSync(process.env.CANOLI_REFERENCE_PYTHON??'python3',['scripts/check-float-tonal.py',record],{encoding:'utf8',timeout:60000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
  await writeFile(info.outputPath('tonal-independent.json'),checked.stdout);
});

test('aborted float tonal computation cannot publish a frame and later native work remains usable',async({page})=>{
  await open(page);const result=await page.evaluate(async()=>{
    const {editor,AdjustmentLayer,TonalStroke,BrushStroke}=window.luma;const layer=editor.document.layers.add(new AdjustmentLayer({adjustment:{kind:'tonal',strokes:[]}}));layer.addTonalStroke(new TonalStroke({brush:new BrushStroke({points:[{x:30,y:30}],size:60}),mode:'dodge',range:'midtones',exposure:.5}));
    const processor=editor.renderer.processor,original=processor.floatTonal.bind(processor),abort=new AbortController(),before=JSON.stringify(editor.document.toJSON());
    let resume!:()=>void,entered!:()=>void;const paused=new Promise<void>(resolve=>resume=resolve),ready=new Promise<void>(resolve=>entered=resolve);
    processor.floatTonal=async(...args)=>{const value=await original(...args);entered();await paused;return value;};
    const scene=await editor.renderer.captureFloatScene(editor.document.getSnapshot().document,editor.assetStore,{signal:abort.signal});let rejected=false;
    try{const work=scene.read({x:0,y:0,width:64,height:48});await ready;abort.abort(new Error('Cancel tonal capture'));resume();try{await work;}catch(error){rejected=String(error).includes('Cancel tonal capture');}}
    finally{processor.floatTonal=original;scene.dispose();}
    const fresh=await editor.renderer.captureFloatScene(editor.document.getSnapshot().document,editor.assetStore);let healthy=false;
    try{healthy=(await fresh.read({x:0,y:0,width:64,height:48})).every(Number.isFinite);}finally{fresh.dispose();}
    return{rejected,healthy,modelExact:JSON.stringify(editor.document.toJSON())===before};
  });expect(result).toEqual({rejected:true,healthy:true,modelExact:true});
});

test('captured float tonal textures reject changed bitmap lifetimes and unrelated original work remains usable',async({page})=>{
  await open(page);const result=await page.evaluate(async()=>{
    const {editor,AdjustmentLayer,TonalStroke,BrushStroke,BrushTexture}=window.luma,image=new OffscreenCanvas(2,2);image.getContext('2d')!.fillRect(0,0,2,2);
    const asset=await editor.assetStore.add(await image.convertToBlob({type:'image/png'}),'Captured tonal texture',undefined,false);image.width=image.height=0;
    const layer=editor.document.layers.add(new AdjustmentLayer({adjustment:{kind:'tonal',strokes:[]}}));layer.addTonalStroke(new TonalStroke({brush:new BrushStroke({points:[{x:32,y:32}],size:32,texture:new BrushTexture({assetId:asset.id})}),mode:'dodge',range:'midtones',exposure:.5}));
    const before=JSON.stringify(editor.document.toJSON()),scene=await editor.renderer.captureFloatScene(editor.document.getSnapshot().document,editor.assetStore);asset.bitmap.close();let error='';
    try{await scene.read({x:0,y:0,width:64,height:48});}catch(cause){error=String(cause);}finally{scene.dispose();}
    const unchanged=JSON.stringify(editor.document.toJSON())===before;layer.remove();const fresh=await editor.renderer.captureFloatScene(editor.document.getSnapshot().document,editor.assetStore);let healthy=false;
    try{healthy=(await fresh.read({x:0,y:0,width:64,height:48})).every(Number.isFinite);}finally{fresh.dispose();}
    return{error,unchanged,healthy};
  });expect(result.error).toContain('source changed');expect(result).toMatchObject({unchanged:true,healthy:true});
});

test('isolated float tonal constructors keep one Undo and inert read-only plugin boundaries',async({page})=>{
  await open(page);const result=await page.evaluate(async()=>{
    const {editor}=window.luma,before=JSON.stringify(editor.document.toJSON()),past=editor.document.getSnapshot().past.length;
    const code="const layer=document.layers.add(new AdjustmentLayer({name:'Isolated tonal',adjustment:{kind:'tonal',strokes:[]}}));layer.addTonalStroke(new TonalStroke({brush:new BrushStroke({points:[{x:30,y:30,pressure:1}],size:40}),mode:'dodge',range:'midtones',exposure:.5}));";
    await editor.runScript(code);const after=JSON.stringify(editor.document.toJSON()),oneUndo=editor.document.getSnapshot().past.length===past+1;
    const rendered=await editor.exportPng();editor.document.undo();const undo=JSON.stringify(editor.document.toJSON())===before;editor.document.redo();const redo=JSON.stringify(editor.document.toJSON())===after;
    const {examplePlugin}=await import(/* @vite-ignore */String('/src/plugins/index.ts'));
    const plugin={...examplePlugin,permissions:['document:read' as const],commands:[{id:'tonal',title:'Read-only tonal',source:code}]};editor.plugins.install(plugin);
    const inert=JSON.stringify(editor.document.toJSON())===after;let error='';try{await editor.runPlugin(plugin.id,'tonal');}catch(cause){error=String(cause);}
    return{oneUndo,undo,redo,inert,error,renderedBytes:rendered.size,unchanged:JSON.stringify(editor.document.toJSON())===after};
  });expect(result).toMatchObject({oneUndo:true,undo:true,redo:true,inert:true,unchanged:true});expect(result.error).toMatch(/read.only|permission/i);expect(result.renderedBytes).toBeGreaterThan(0);
});

test('float Dodge/Burn pointer previews and isolated strokes preserve source bytes, one Undo and reopened output',async({page},info)=>{await floatTonalWorkflow(page,info);});
