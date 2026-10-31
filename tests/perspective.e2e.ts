import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('public image perspective renders original pixels, linked and document masks, smart instances and saved projects',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async()=>{
  const{editor,Document,RasterLayer,PerspectiveTransform,LayerMask,MarqueeSelection,AffineTransform}=window.luma;
  const{encodeRgbaPng}=await import(/* @vite-ignore */String('/src/engine/png.ts'));
  const{PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts'));const processor=new PixelProcessor();
  const width=31,height=23,pixels=Uint8Array.from({length:width*height*4},(_,i)=>{const p=i>>2;return i%4===3?255:i%4===0?p%width*7:i%4===1?Math.floor(p/width)*11:(p*17)%256;});
  const asset=await editor.assetStore.add(await encodeRgbaPng(pixels,width,height),'Original perspective pixels',undefined,false),doc=new Document({width:80,height:60});
  const q=[{x:11,y:7},{x:65,y:11},{x:58,y:49},{x:4,y:42}] as const,layer=doc.layers.add(new RasterLayer({assetId:asset.id,width,height,perspective:PerspectiveTransform.fromPixels(width,height,q)}));
  const sample=async()=>{const canvas=await editor.renderer.render(doc.toJSON(),editor.assetStore,{cache:false,readback:true});try{return [...canvas.getContext('2d')!.getImageData(0,0,80,60).data];}finally{canvas.width=canvas.height=0;}};
  try{
   const source=Float32Array.from(pixels,v=>v/255),expected=await processor.floatProjective(source,{sourceWidth:width,sourceHeight:height,source:{x:0,y:0,width,height},output:{x:0,y:0,width:80,height:60},corners:q}),actual=await sample();
   let maximum=0;for(let i=0;i<actual.length;i++)if(i%4===3||expected[(i>>2)*4+3]>.5)maximum=Math.max(maximum,Math.abs(actual[i]-Math.round(expected[i]*255)));
   const masks=[];
   for(const linked of [true,false]){
    layer.mask=new LayerMask({linked,selection:new MarqueeSelection({x:linked?5:20,y:linked?3:12,width:15,height:14,shape:'rectangle'}),feather:2.5,density:.73});
    const captured=editor.renderer.capturePerspectiveMask(layer.mask!.toJSON(),{sourceWidth:width,sourceHeight:height,layerWidth:width,layerHeight:height,corners:q},editor.assetStore);
    try{const coverage=await captured.read({x:0,y:0,width:80,height:60}),masked=await sample();let error=0;for(let i=0;i<coverage.length;i++)error=Math.max(error,Math.abs(masked[i*4+3]-Math.round(expected[i*4+3]*Math.round(coverage[i]*255))));masks.push({linked,error});}finally{captured.dispose();}
   }
   layer.mask=null;const raster=await sample(),smart=layer.convertToSmartObject(),smartPixels=await sample();let smartDifference=0;for(let i=0;i<raster.length;i++)if(raster[i]!==smartPixels[i])smartDifference++;
   const saved=doc.toJSON(),reopened=Document.fromJSON(saved);const canvas=await editor.renderer.render(reopened.toJSON(),editor.assetStore,{cache:false,readback:true});const reopenedPixels=[...canvas.getContext('2d')!.getImageData(0,0,80,60).data];canvas.width=canvas.height=0;
   const before=doc.toJSON();smart.perspective=null;doc.undo();const undo=JSON.stringify(before)===JSON.stringify(doc.toJSON());
   return{maximum,masks,smartDifference,reopenedExact:JSON.stringify(reopenedPixels)===JSON.stringify(smartPixels),undo,assetIdentity:asset.blob===editor.assetStore.get(asset.id).blob,sourceDimensions:[asset.width,asset.height],affineStillSeparate:smart.transform instanceof AffineTransform};
  }finally{processor.dispose();}
 });
 await writeFile(info.outputPath('public-perspective.json'),JSON.stringify(result,null,2));expect(result.maximum).toBeLessThanOrEqual(1);expect(result.masks.every(v=>v.error<=1)).toBe(true);expect(result).toMatchObject({smartDifference:0,reopenedExact:true,undo:true,assetIdentity:true,sourceDimensions:[31,23],affineStillSeparate:true});
});

test('genuine 50 MP public perspective retains native originals and independently verified float scene pixels',async({page},info)=>{
 test.setTimeout(600000);const original=await readFile('tests/fixtures/uint16-float/u16-native-50mp.tif'),corners=[{x:3.5,y:2.25},{x:63,y:.5},{x:56,y:35},{x:1.5,y:29}],output={x:0,y:0,width:65,height:37};
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async({bytes,corners,output})=>{
  const{editor,RasterLayer,PerspectiveTransform}=window.luma;
  await editor.openTiff(new File([new Uint8Array(bytes)],'Perspective native 50 MP.tif',{type:'image/tiff'}),{editingPrecision:'float32'});
  const layer=editor.document.layers.at(0) as InstanceType<typeof RasterLayer>,asset=editor.assetStore.get(layer.assetId),count=editor.document.getSnapshot().past.length;
  layer.perspective=PerspectiveTransform.fromPixels(layer.width,layer.height,corners as never);const model=editor.document.toJSON(),scene=await editor.renderer.captureFloatScene(model,editor.assetStore);
  try{
   const pixels=await scene.read(output),words=new Uint32Array(pixels.buffer);let partitionDifferent=0;
   for(let y=0;y<output.height;y+=7){const part=await scene.read({...output,y,width:output.width,height:Math.min(7,output.height-y)}),p=new Uint32Array(part.buffer);for(let i=0;i<p.length;i++)if(p[i]!==words[y*output.width*4+i])partitionDifferent++;}
   const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
   return{bytes:[...new Uint8Array(pixels.buffer)],native:[asset.width,asset.height],preview:[asset.bitmap.width,asset.bitmap.height],originalSha256:sha,partitionDifferent,unchanged:JSON.stringify(model)===JSON.stringify(editor.document.toJSON()),oneUndo:editor.document.getSnapshot().past.length===count+1};
  }finally{scene.dispose();}
 },{bytes:[...original],corners,output});
 expect(result).toMatchObject({native:[10000,5000],originalSha256:createHash('sha256').update(original).digest('hex'),partitionDifferent:0,unchanged:true,oneUndo:true});
 const actual=info.outputPath('public-perspective-50mp.f32le'),casePath=info.outputPath('public-perspective-50mp-case.json');await writeFile(actual,new Uint8Array(result.bytes));await writeFile(casePath,JSON.stringify({corners,output}));
 const checked=spawnSync(process.env.CANOLI_PDF_PYTHON??'python3',['scripts/check-projective-source.py',actual,'--case',casePath,'--source-name','u16-native-50mp.tif'],{encoding:'utf8',timeout:180000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);await writeFile(info.outputPath('public-perspective-50mp.json'),JSON.stringify({...result,bytes:undefined,independent:JSON.parse(checked.stdout)},null,2));
});

test('Inspector preview, cancellation, isolated constructor example, recipe replay and original-bearing project round trip',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 await page.evaluate(async()=>{const{editor,RasterLayer}=window.luma;editor.newDocument({width:80,height:60});const canvas=new OffscreenCanvas(31,23),c=canvas.getContext('2d')!;c.fillStyle='#e83d56';c.fillRect(0,0,31,23);const asset=await editor.assetStore.add(await canvas.convertToBlob(),'Inspector original',undefined,false);editor.document.selectedLayer=editor.document.layers.add(new RasterLayer({assetId:asset.id,width:31,height:23}));});
 const initial=await page.evaluate(()=>({model:window.luma.editor.document.toJSON(),past:window.luma.editor.document.getSnapshot().past.length}));
 const input=page.getByRole('spinbutton',{name:'Top left X',exact:true});await expect(input).toBeVisible();await input.fill('3');await input.press('Escape');
 expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(initial.model);expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(initial.past);
 await input.fill('3');await input.press('Enter');await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.selectedLayer?.perspective?.corners[0].x)).toBeCloseTo(3/31,12);
 expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(initial.past+1);
 await page.getByRole('button',{name:'Reset perspective',exact:true}).click();expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer?.perspective)).toBeNull();
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.match(/<!-- example: image-perspective -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(code).toBeTruthy();
 const result=await page.evaluate(async code=>{
  const{editor}=window.luma,before=editor.document.toJSON(),count=editor.document.getSnapshot().past.length;editor.recipes.startRecording();await editor.runScript(code);const recipe=await editor.recipes.stopRecording({name:'Perspective placement'}),after=editor.document.toJSON();
  editor.document.undo();const undo=JSON.stringify(before)===JSON.stringify(editor.document.toJSON());editor.document.redo();const redo=JSON.stringify(after)===JSON.stringify(editor.document.toJSON());
  const oneUndo=editor.document.getSnapshot().past.length===count+1;editor.document.undo();const replay=editor.recipes.execute(recipe),recipeReplay=replay.success&&JSON.stringify(after)===JSON.stringify(editor.document.toJSON());
  const asset=editor.assetStore.values()[0],original=await asset.blob.arrayBuffer(),project=await editor.saveProject();await editor.openProject(new File([project],'Perspective.canoli'));
  const reopened=JSON.stringify(after)===JSON.stringify(editor.document.toJSON()),assetBytes=await editor.assetStore.get(asset.id).blob.arrayBuffer();
  return{undo,redo,reopened,oneUndo,recipeReplay,recipePerspective:recipe.steps.some(step=>step.action.type==='layer.update'&&!!step.action.patch.perspective),originalExact:original.byteLength===assetBytes.byteLength&&new Uint8Array(original).every((v,i)=>v===new Uint8Array(assetBytes)[i])};
 },code!);
 // A reopened project intentionally starts a fresh Undo history.
 expect(result).toMatchObject({undo:true,redo:true,reopened:true,oneUndo:true,recipeReplay:true,recipePerspective:true,originalExact:true});await writeFile(info.outputPath('perspective-authoring.json'),JSON.stringify(result,null,2));
});

test('projected smart filters, independent filter masks, SVG delivery and explicit rasterization retain appearance',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async()=>{
  const{editor,RasterLayer,PerspectiveTransform,LayerMask,MarqueeSelection,GaussianBlurFilter}=window.luma;editor.newDocument({width:80,height:60});const canvas=new OffscreenCanvas(31,23),c=canvas.getContext('2d')!;c.fillStyle='#ff2456';c.fillRect(3,3,24,16);const asset=await editor.assetStore.add(await canvas.convertToBlob(),'Smart original',undefined,false),raster=editor.document.layers.add(new RasterLayer({assetId:asset.id,width:31,height:23,perspective:PerspectiveTransform.fromPixels(31,23,[{x:11,y:7},{x:65,y:11},{x:58,y:49},{x:4,y:42}])})),smart=raster.convertToSmartObject();
  const pixels=async()=>{const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false,readback:true});try{return [...canvas.getContext('2d')!.getImageData(0,0,80,60).data];}finally{canvas.width=canvas.height=0;}};
  const original=await pixels();smart.addFilter(new GaussianBlurFilter({sigma:1}));const filtered=await pixels(),masks=[];
  for(const linked of [true,false]){smart.filterMask=new LayerMask({linked,selection:new MarqueeSelection({x:linked?7:20,y:linked?4:12,width:12,height:14,shape:'rectangle'}),feather:1.5,density:.7});const masked=await pixels();masks.push({linked,differentFromOriginal:masked.some((v,i)=>v!==original[i]),differentFromFiltered:masked.some((v,i)=>v!==filtered[i])});}
  smart.mask=new LayerMask({base:.6});const before=editor.document.toJSON(),expected=await pixels(),exported=await editor.export({format:'svg'}),image=new Image(),url=URL.createObjectURL(exported.blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const output=document.createElement('canvas');output.width=80;output.height=60;output.getContext('2d')!.drawImage(image,0,0);const svg=[...output.getContext('2d')!.getImageData(0,0,80,60).data];let svgAlpha=0;for(let i=3;i<svg.length;i+=4)svgAlpha=Math.max(svgAlpha,Math.abs(svg[i]-expected[i]));output.width=output.height=0;
  const replacement=await editor.rasterizeSmartObject(smart),cleared=replacement.perspective===null&&replacement.mask===null,actual=await pixels();let alpha=0;for(let i=3;i<actual.length;i+=4)alpha=Math.max(alpha,Math.abs(actual[i]-expected[i]));editor.document.undo();
  return{masks,svgAlpha,rasterAlpha:alpha,cleared,undo:JSON.stringify(before)===JSON.stringify(editor.document.toJSON())};
 });expect(result.masks.every(row=>row.differentFromOriginal&&row.differentFromFiltered)).toBe(true);expect(result.svgAlpha).toBeLessThanOrEqual(1);expect(result.rasterAlpha).toBeLessThanOrEqual(1);expect(result).toMatchObject({cleared:true,undo:true});await writeFile(info.outputPath('perspective-delivery.json'),JSON.stringify(result,null,2));
});

test('Photoshop delivery bakes projected image and linked mask appearance into portable layer pixels',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const result=await page.evaluate(async()=>{
  const{editor,RasterLayer,PerspectiveTransform,LayerMask,MarqueeSelection}=window.luma;editor.newDocument({width:80,height:60});const source=new OffscreenCanvas(31,23),c=source.getContext('2d')!;c.fillStyle='#35b964';c.fillRect(0,0,31,23);const asset=await editor.assetStore.add(await source.convertToBlob(),'Photoshop original',undefined,false),layer=editor.document.layers.add(new RasterLayer({assetId:asset.id,width:31,height:23,perspective:PerspectiveTransform.fromPixels(31,23,[{x:11,y:7},{x:65,y:11},{x:58,y:49},{x:4,y:42}])}));layer.mask=new LayerMask({selection:new MarqueeSelection({x:5,y:2,width:22,height:18,shape:'rectangle'}),feather:1.5,density:.8});
  const pixels=async()=>{const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false,readback:true});try{return [...canvas.getContext('2d')!.getImageData(0,0,80,60).data];}finally{canvas.width=canvas.height=0;}};
  const before=editor.document.toJSON(),expected=await pixels(),output=await editor.export({format:'psd'}),unchanged=JSON.stringify(before)===JSON.stringify(editor.document.toJSON());await editor.openPsd(new Uint8Array(await output.blob.arrayBuffer()));const actual=await pixels();let alpha=0,premultiplied=0;
  for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected[i+3]));for(let c=0;c<3;c++)premultiplied=Math.max(premultiplied,Math.abs(actual[i+c]*actual[i+3]/255-expected[i+c]*expected[i+3]/255));}
  return{alpha,premultiplied,unchanged};
 });expect(result.alpha).toBeLessThanOrEqual(1);expect(result.premultiplied).toBeLessThanOrEqual(2);expect(result.unchanged).toBe(true);await writeFile(info.outputPath('perspective-photoshop.json'),JSON.stringify(result,null,2));
});

test('projected image tools enforce the current coordinate boundary and recover immediately after reset',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);await page.evaluate(async()=>{const{editor,RasterLayer,PerspectiveTransform}=window.luma;editor.newDocument({width:80,height:60});const canvas=new OffscreenCanvas(16,16),c=canvas.getContext('2d')!;c.fillRect(0,0,16,16);const asset=await editor.assetStore.add(await canvas.convertToBlob(),'Tool boundary',undefined,false);editor.document.selectedLayer=editor.document.layers.add(new RasterLayer({assetId:asset.id,width:16,height:16,perspective:new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:0},{x:.8,y:1},{x:.1,y:1}]})}));});
 await expect(page.getByRole('button',{name:'Eraser tool (E)',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Mixer brush',exact:true})).toBeDisabled();
 const result=await page.evaluate(()=>{const{editor}=window.luma,before=JSON.stringify(editor.document.toJSON());const availability={move:editor.tools.canUseTool('move'),brush:editor.tools.canUseTool('brush'),eraser:editor.tools.canUseTool('eraser'),reason:editor.tools.toolUnavailableReason('eraser')};editor.tools.configure({paintTarget:'mask-hide'});const mask=editor.tools.canUseTool('brush');editor.tools.configure({paintTarget:'layer'});return{...availability,mask,unchanged:JSON.stringify(editor.document.toJSON())===before};});expect(result).toMatchObject({move:true,brush:true,eraser:true,mask:false,unchanged:true});expect(result.reason).toBeNull();
 await page.getByRole('button',{name:'Reset perspective',exact:true}).click();await expect(page.getByRole('button',{name:'Eraser tool (E)',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Mixer brush',exact:true})).toBeEnabled();
});
