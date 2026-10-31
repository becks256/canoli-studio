import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('enlarged placed erasure masks retain their native interpolation tail outside image bounds',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const result=await page.evaluate(async()=>{
    const{editor,LayerMask,PerspectiveTransform,EraserStroke,AffineTransform}=window.luma;
    const mask=new LayerMask({rasterErasures:{width:64,height:64,operations:[{width:1,height:1,stroke:new EraserStroke({points:[{x:.5,y:.5}],size:2,hardness:1,pressureSize:false}),placement:{perspective:new PerspectiveTransform(),bounds:{x:0,y:0,width:1,height:1}}}]}}).toJSON();
    const output={x:-40,y:-40,width:144,height:144},raw=await editor.renderer.renderMaskCoverage(mask,{...output,sx:1,sy:1},0,0,'enlarged-erasure-reference',false,new AffineTransform(),editor.assetStore);
    const captured=editor.renderer.capturePerspectiveMask(mask,{sourceWidth:64,sourceHeight:64,layerWidth:64,layerHeight:64,corners:[{x:0,y:0},{x:64,y:0},{x:64,y:64},{x:0,y:64}]},editor.assetStore);
    try{const expected=raw.getContext('2d')!.getImageData(0,0,144,144).data,actual=await captured.read(output);let maximum=0,outsideReduced=0;for(let y=0;y<144;y++)for(let x=0;x<144;x++){const at=y*144+x,reference=Math.fround(expected[at*4+3]/255);maximum=Math.max(maximum,Math.abs(actual[at]-reference));if((x<40||y<40||x>=104||y>=104)&&reference<1)outsideReduced++;}return{maximum,outsideReduced,bounds:captured.bounds};}finally{captured.dispose();raw.width=raw.height=0;}
  });expect(result.maximum).toBe(0);expect(result.outsideReduced).toBeGreaterThan(0);expect(result.bounds.x).toBeLessThan(-32);expect(result.bounds.x+result.bounds.width).toBeGreaterThan(96);await writeFile(info.outputPath('placed-mask-tail.json'),JSON.stringify(result,null,2));
});

test('placed eraser transports retained texture coverage and rejects a closed texture source',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const result=await page.evaluate(async()=>{
    const{editor,RasterLayer,PerspectiveTransform,EraserStroke,BrushTexture}=window.luma;editor.newDocument({width:64,height:48});
    const original=new OffscreenCanvas(64,48),c=original.getContext('2d')!;c.fillStyle='#ff0000';c.fillRect(0,0,64,48);const asset=await editor.assetStore.add(await original.convertToBlob(),'Texture erase original',undefined,false);
    const texture=new OffscreenCanvas(2,2),t=texture.getContext('2d')!;t.globalAlpha=128/255;t.fillRect(0,0,2,2);const coverage=await editor.assetStore.add(await texture.convertToBlob(),'Eraser texture',undefined,false);
    const layer=editor.document.layers.add(new RasterLayer({assetId:asset.id,width:64,height:48,perspective:new PerspectiveTransform({corners:[{x:1/64,y:0},{x:65/64,y:0},{x:65/64,y:1},{x:1/64,y:1}]})}));
    layer.erase(new EraserStroke({points:[{x:32.5,y:24.5}],size:10,hardness:1,opacity:.75,pressureSize:false,texture:new BrushTexture({assetId:coverage.id,channel:'alpha'})}),{space:'placed'});layer.perspective=null;
    const sample=async()=>{const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false,readback:true});try{return[...canvas.getContext('2d')!.getImageData(31,24,1,1).data];}finally{canvas.width=canvas.height=0;}};
    const value=await sample(),before=JSON.stringify(editor.document.toJSON());coverage.bitmap.close();let error='';try{await sample();}catch(e){error=String(e);}return{value,error,unchanged:JSON.stringify(editor.document.toJSON())===before};
  });expect(result.value).toEqual([255,0,0,159]);expect(result.error).toMatch(/source|geometry|closed|bitmap/i);expect(result.unchanged).toBe(true);await writeFile(info.outputPath('placed-texture.json'),JSON.stringify(result,null,2));
});

test('placed eraser cancels on Escape and rejects a changed perspective before final commit',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  await page.evaluate(async()=>{const{editor,RasterLayer,PerspectiveTransform}=window.luma;editor.newDocument({width:64,height:48});const canvas=new OffscreenCanvas(64,48),c=canvas.getContext('2d')!;c.fillRect(0,0,64,48);const asset=await editor.assetStore.add(await canvas.convertToBlob(),'Cancelled original',undefined,false);editor.document.selectedLayer=editor.document.layers.add(new RasterLayer({assetId:asset.id,width:64,height:48,perspective:new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:0},{x:.75,y:1},{x:.25,y:1}]})}));});
  await page.getByRole('button',{name:'Eraser tool (E)',exact:true}).click();await page.keyboard.press('Control+1');const box=(await page.locator('.canvas-wrap').boundingBox())!,point={x:box.x+box.width/2,y:box.y+box.height/2};
  const before=await page.evaluate(()=>window.luma.editor.document.toJSON());await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+4,point.y+2);await page.keyboard.press('Escape');await page.mouse.up();expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
  await page.mouse.down();const changed=await page.evaluate(()=>{const{editor,PerspectiveTransform}=window.luma;editor.document.selectedLayer!.perspective=new PerspectiveTransform({corners:[{x:.1,y:0},{x:.9,y:.1},{x:.75,y:1},{x:.25,y:1}]});return editor.document.toJSON();});await page.mouse.up();
  const result=await page.evaluate(()=>({document:window.luma.editor.document.toJSON(),preview:window.luma.editor.tools.getSnapshot().paintPreview}));expect(result.document).toEqual(changed);expect(result.preview).toBeNull();await writeFile(info.outputPath('placed-cancellation.json'),JSON.stringify(result,null,2));
});

test('placed byte erasure shares pointer preview, captured clip, Undo, isolated scripting and project persistence',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const setup=await page.evaluate(async()=>{
    const{editor,RasterLayer,LayerGroup,AffineTransform,PerspectiveTransform,MarqueeSelection}=window.luma;editor.newDocument({width:400,height:300});
    const canvas=new OffscreenCanvas(96,72),c=canvas.getContext('2d')!;c.fillStyle='#ed6582';c.fillRect(0,0,96,72);
    const asset=await editor.assetStore.add(await canvas.convertToBlob(),'Projected eraser original',undefined,false),group=editor.document.layers.add(new LayerGroup());group.transform=new AffineTransform(1,.12,.16,1,100,60);
    const layer=group.layers.add(new RasterLayer({assetId:asset.id,width:96,height:72,perspective:new PerspectiveTransform({corners:[{x:.1,y:.05},{x:1.1,y:.15},{x:.95,y:1.15},{x:-.1,y:.85}]})}));editor.document.selectedLayer=layer;
    const point=group.transform.point({x:45,y:31});editor.document.selection=new MarqueeSelection({x:point.x-8,y:point.y-20,width:40,height:40,shape:'rectangle'});
    editor.tools.configure({size:23,hardness:.5,opacity:.7,flow:.6,pressureSize:false,paintTarget:'layer'});
    return{point,before:editor.document.toJSON(),past:editor.document.getSnapshot().past.length};
  });
  await page.getByRole('button',{name:'Eraser tool (E)',exact:true}).click();await page.keyboard.press('Control+1');const canvas=page.locator('.canvas-wrap');await expect(canvas).toBeVisible();
  const box=(await canvas.boundingBox())!,at={x:box.x+box.width/2-200+setup.point.x,y:box.y+box.height/2-150+setup.point.y};
  await page.mouse.move(at.x,at.y);await page.mouse.down();
  const preview=await page.evaluate(async()=>{const{editor}=window.luma,preview=editor.tools.getSnapshot().paintPreview;if(!preview?.erasurePlacement)throw Error('Missing placed preview');const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false,readback:true,paintPreview:preview});try{return{bytes:[...canvas.getContext('2d')!.getImageData(0,0,400,300).data],unchanged:editor.document.getSnapshot().past.length,preview};}finally{canvas.width=canvas.height=0;}});
  await page.mouse.up();
  const example=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: placed-erasure -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();
  const result=await page.evaluate(async({setup,preview,example})=>{
    const{editor,RasterLayer}=window.luma,layer=editor.document.selectedLayer as InstanceType<typeof RasterLayer>;
    const sample=async()=>{const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false,readback:true});try{return[...canvas.getContext('2d')!.getImageData(0,0,400,300).data];}finally{canvas.width=canvas.height=0;}};
    const actual=await sample(),entry=(layer.toJSON() as import('../src/core/model').RasterLayerData).erasures![0],committed=editor.document.toJSON(),count=editor.document.getSnapshot().past.length;
    editor.document.undo();const undo=JSON.stringify(editor.document.toJSON())===JSON.stringify(setup.before);editor.document.redo();const redo=JSON.stringify(editor.document.toJSON())===JSON.stringify(committed);
    layer.perspective=null;const reset=await sample(),retained=JSON.stringify((layer.toJSON() as import('../src/core/model').RasterLayerData).erasures![0])===JSON.stringify(entry);
    const project=await editor.saveProject(),saved=editor.document.toJSON();await editor.openProject(new File([project],'projected-erasure.luma'));const reopened=JSON.stringify(saved)===JSON.stringify(editor.document.toJSON());
    editor.document.selectedLayer=editor.document.getLayer(layer.id);await editor.runScript(example!);
    const restored=editor.document.getLayer(layer.id) as InstanceType<typeof RasterLayer>;
    return{previewExact:actual.every((v,i)=>v===preview.bytes[i]),previewUnchanged:preview.unchanged===setup.past,oneUndo:count===setup.past+1,undo,redo,retained,reopened,scripted:!!(restored.toJSON() as import('../src/core/model').RasterLayerData).erasures![1]?.placement,clipCaptured:!!entry.stroke.clip,changed:actual.some((v,i)=>i%4===3&&v>0&&v<255),resetChanged:reset.some((v,i)=>i%4===3&&v>0&&v<255),source:[editor.assetStore.values()[0].width,editor.assetStore.values()[0].height]};
  },{setup,preview,example});
  expect(result).toMatchObject({previewExact:true,previewUnchanged:true,oneUndo:true,undo:true,redo:true,retained:true,reopened:true,scripted:true,clipCaptured:true,changed:true,resetChanged:true,source:[96,72]});await writeFile(info.outputPath('placed-pointer.json'),JSON.stringify(result,null,2));
});

test('placed float erasure matches independent native coverage, retains RGB and remains partition invariant after reset',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async bytes=>{
    const{editor,RasterLayer,PerspectiveTransform,EraserStroke,BrushStroke,BrushTip,BrushSymmetry,MarqueeSelection,LayerMask,AffineTransform}=window.luma;
    await editor.openTiff(new File([new Uint8Array(bytes)],'Float placed erase.tif',{type:'image/tiff'}),{editingPrecision:'float32'});const layer=editor.document.layers.at(0) as InstanceType<typeof RasterLayer>;
    const read=async()=>{const scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);try{return[...await scene.read({x:0,y:0,width:131,height:79})];}finally{scene.dispose();}};
    const before=await read();layer.perspective=new PerspectiveTransform({corners:[{x:.05,y:.08},{x:.95,y:.17},{x:1.1,y:.95},{x:-.1,y:1.1}]});
    const options={points:[{x:35,y:25,pressure:.6,tilt:{altitude:.8,azimuth:.4}},{x:80,y:44,pressure:1,tilt:{altitude:1.1,azimuth:1.3}}],size:15.25,hardness:.4,opacity:.75,flow:.6,pressureSize:true,tip:new BrushTip({roundness:.55,angle:23,tiltAngle:true,tiltRoundness:true}),symmetry:BrushSymmetry.mirrorVertical(65),clip:new MarqueeSelection({x:21,y:12,width:85,height:52,shape:'ellipse'})};
    const stroke=new EraserStroke(options),mask=new LayerMask({base:1}).paint(new BrushStroke(options),'hide'),field={x:-32,y:-32,width:224,height:160};
    const raw=await editor.renderer.renderMaskCoverage(mask.toJSON(),{...field,sx:1,sy:1},0,0,'independent-raw',false,new AffineTransform(),editor.assetStore);let source:number[];try{const bytes=raw.getContext('2d')!.getImageData(0,0,field.width,field.height).data;source=Array.from({length:field.width*field.height},(_,i)=>Math.fround(bytes[i*4+3]/255));}finally{raw.width=raw.height=0;}
    const preview={layerId:layer.id,stroke:stroke.toJSON(),erasurePlacement:{perspective:layer.perspective.toJSON(),bounds:{x:0,y:0,width:131,height:79}}};
    const pc=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false,readback:true,paintPreview:preview});const previewBytes=[...pc.getContext('2d')!.getImageData(0,0,131,79).data];pc.width=pc.height=0;
    layer.erase(stroke,{space:'placed'});const cc=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false,readback:true});const committed=[...cc.getContext('2d')!.getImageData(0,0,131,79).data];cc.width=cc.height=0;const corners=layer.perspective.toPixels(131,79);layer.perspective=null;
    const after=await read(),scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore),parts=new Float32Array(after.length);try{for(let y=0;y<79;y+=17){const part=await scene.read({x:0,y,width:131,height:Math.min(17,79-y)});parts.set(part,y*131*4);}}finally{scene.dispose();}
    const words=new Uint32Array(new Float32Array(after).buffer),partitionExact=words.every((v,i)=>v===new Uint32Array(parts.buffer)[i]);
    layer.width=262;layer.height=158;const resized=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);let resizedReduced=false;try{const block=await resized.read({x:80,y:60,width:20,height:20});resizedReduced=block.some((v,i)=>i%4===3&&v>0&&v<1);}finally{resized.dispose();}
    return{before,after,source,case:{sourceWidth:131,sourceHeight:79,corners,field,background:1,direction:'source-to-quad',output:{x:0,y:0,width:131,height:79},mask:mask.toJSON()},previewExact:committed.every((v,i)=>v===previewBytes[i]),partitionExact,resizedReduced};
  },[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);
  const paths={before:info.outputPath('before.f32le'),after:info.outputPath('after.f32le'),source:info.outputPath('source.f32le'),case:info.outputPath('case.json')};
  for(const key of ['before','after','source'] as const)await writeFile(paths[key],new Uint8Array(new Float32Array(result[key]).buffer));await writeFile(paths.case,JSON.stringify(result.case));
  const check=spawnSync(process.env.CANOLI_PDF_PYTHON??'python3',['scripts/check-projected-erasure.py',paths.before,paths.after,'--case',paths.case,'--source',paths.source],{encoding:'utf8',timeout:120000});expect(check.status,check.stderr||check.stdout).toBe(0);expect(result).toMatchObject({previewExact:true,partitionExact:true,resizedReduced:true});await writeFile(info.outputPath('float-oracle.json'),check.stdout);
});

test('placed eraser reads a distant 50 MP original window without reallocating or changing the source',async({page},info)=>{
  test.setTimeout(300000);await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/native-50mp.png');
  await page.waitForFunction(()=>window.luma?.editor.assetStore.values().some(a=>a.width===10000&&a.height===5000));
  const result=await page.evaluate(async()=>{
    const{editor,RasterLayer,PerspectiveTransform,EraserStroke}=window.luma,layer=editor.document.layers.at(0) as InstanceType<typeof RasterLayer>,asset=editor.assetStore.get(layer.assetId),hash=async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const original=await hash(),region={x:8996,y:3996,width:10,height:10};
    const sample=async()=>{const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{region,cache:false,readback:true});try{return[...canvas.getContext('2d')!.getImageData(0,0,10,10).data];}finally{canvas.width=canvas.height=0;}};
    const before=await sample();layer.perspective=new PerspectiveTransform({corners:[{x:.0001,y:0},{x:1.0001,y:0},{x:1.0001,y:1},{x:.0001,y:1}]});
    layer.erase(new EraserStroke({points:[{x:9001.5,y:4000.5}],size:3,hardness:1,opacity:.5,pressureSize:false}),{space:'placed'});layer.perspective=null;const after=await sample();
    editor.document.undo();editor.document.undo();editor.document.undo();const undo=await sample();return{original,afterHash:await hash(),dimensions:[asset.width,asset.height],before:before[(4*10+4)*4+3],after:after[(4*10+4)*4+3],unchangedNeighbor:after[(4*10+5)*4+3],undoExact:before.every((v,i)=>v===undo[i])};
  });
  expect(result).toMatchObject({original:'b457af22024ac92524b87f06ada74fd652484835edbaafbb20470a8a9bb3897f',dimensions:[10000,5000],before:128,after:64,unchangedNeighbor:0,undoExact:true});expect(result.afterHash).toBe(result.original);await writeFile(info.outputPath('native-50mp.json'),JSON.stringify(result,null,2));expect(createHash('sha256').update(await readFile('tests/fixtures/matting/native-50mp.png')).digest('hex')).toBe(result.original);
});
