import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {saveAvifBlob,checkAvif} from './helpers/avif';

test('real AVIF worker preserves all 256 alpha values and private input ownership',async({page},info)=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {encodeAvifFrame}=await import(/* @vite-ignore */String('/src/engine/avif-encoder.ts'));
  const original=new Uint8Array(256*4*4);for(let i=0;i<1024;i++)original.set([(i*17)%256,(i*43)%256,(i*61)%256,i%256],i*4);
  const input=original.slice(),blob=await encodeAvifFrame(input.buffer,256,4,{lossless:true,speed:10},true);
  const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=256;canvas.height=4;const context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0);bitmap.close();const decoded=context.getImageData(0,0,256,4).data;
  context.putImageData(new ImageData(new Uint8ClampedArray(original),256,4),0,0);const png=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png')),pngBitmap=await createImageBitmap(png);context.clearRect(0,0,256,4);context.drawImage(pngBitmap,0,0);pngBitmap.close();const reference=context.getImageData(0,0,256,4).data;let browserAlphaExact=true,browserPremultipliedError=0,rawPremultipliedError=0;
  for(let i=0;i<decoded.length;i+=4){browserAlphaExact&&=decoded[i+3]===original[i+3];for(let channel=0;channel<3;channel++){browserPremultipliedError=Math.max(browserPremultipliedError,Math.abs(decoded[i+channel]*decoded[i+3]-reference[i+channel]*reference[i+3])/255);rawPremultipliedError=Math.max(rawPremultipliedError,Math.abs(decoded[i+channel]*decoded[i+3]-original[i+channel]*original[i+3])/255);}}canvas.width=canvas.height=0;
  (window as unknown as {avifOutputs:Record<string,Blob>}).avifOutputs={avif:blob};
  return{original:[...original],detached:input.byteLength===0,browserAlphaExact,browserPremultipliedError,rawPremultipliedError};
 });
 expect(result.detached).toBe(true);const path=await saveAvifBlob(page,info,'avif','avif'),reference=info.outputPath('expected.rgba');await writeFile(reference,new Uint8Array(result.original));
 const decoded=checkAvif(path,reference,{width:256,height:4});await info.attach('independent-alpha',{body:JSON.stringify({decoder:decoded,browser:{alphaExact:result.browserAlphaExact,premultipliedErrorVsPng:result.browserPremultipliedError,premultipliedErrorVsRaw:result.rawPremultipliedError}}),contentType:'application/json'});
 // The file check is byte-exact. Two browser decode/draw/readback paths each
 // quantize premultiplied coverage; report that appearance error separately.
 expect(result.browserAlphaExact).toBe(true);expect(result.browserPremultipliedError).toBeLessThanOrEqual(2);
});

for(const scenario of ['composition','wide','empty'] as const)test(`native AVIF ${scenario} preserves PNG pixels and editable source/history`,async({page},info)=>{
 await page.goto('/');await page.evaluate(()=>document.fonts.ready);
 const result=await page.evaluate(async scenario=>{
  const {editor,Document,RasterLayer,PaintLayer,PaintFill,VectorLayer,VectorPath,TextLayer,LayerGroup,LayerMask,MarqueeSelection,LayerStyle,AffineTransform,SmartToneFilter,AdjustmentLayer}=window.luma;
  const width=scenario==='wide'?16417:scenario==='empty'?1:2081,height=scenario==='wide'?65:scenario==='empty'?1:193;editor.newDocument({width,height});const doc=editor.document;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;const c=canvas.getContext('2d')!,pixels=c.createImageData(256,128);for(let i=0;i<256*128;i++)pixels.data.set([i%256,(i*43)%256,(i*61)%256,i%256],i*4);c.putImageData(pixels,0,0);
  const source=await editor.assetStore.add(await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png')),'Original AVIF artwork',undefined,false);canvas.width=canvas.height=0;
  if(scenario!=='empty'){
   doc.layers.add(new RasterLayer({assetId:source.id,width:256,height:128,x:1960,y:20}));
   const group=doc.layers.add(new LayerGroup({opacity:.73}));group.transform=new AffineTransform(1,.05,-.08,1,1920,12);const vector=group.layers.add(new VectorLayer());vector.paths.add(VectorPath.rectangle({x:0,y:0,width:350,height:180},12,{fill:'#3060d0',stroke:'#ff8060',strokeWidth:3}));group.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:1920,y:5,width:300,height:180}),feather:3,density:.8});
   const text=doc.layers.add(new TextLayer({text:'Canoli Studio',fontFamily:'monospace',fontSize:24,x:1900,y:112,color:'#4070a0'}));text.styles=new LayerStyle({dropShadow:{enabled:true,x:11,y:7,blur:4,color:'#502080',opacity:.7}});
   const paint=doc.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({bounds:{x:2030,y:64,width:35,height:67},color:'#0080ff',opacity:.4}));
   const master=new Document({width:128,height:96});master.layers.add(new TextLayer({text:'AVIF',fontSize:28,fontFamily:'monospace',x:8,y:8,color:'#ff6000'}));const smart=doc.placeSmartObject(doc.defineComponent(master),{x:1970,y:120});smart.setFilters([new SmartToneFilter({exposure:.5})]);
   doc.layers.add(new AdjustmentLayer({adjustment:{kind:'tone',exposure:.2,contrast:5,saturation:10},opacity:.6}));
   if(scenario==='wide'){const v=doc.layers.add(new VectorLayer());v.paths.add(VectorPath.rectangle({x:16350.5,y:5.25,width:60,height:55},8,{fill:'#ff8040',stroke:'#4050ff',strokeWidth:3}));}
  }
  const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision,past=doc.getSnapshot().past.length,sourceBytes=new Uint8Array(await source.blob.arrayBuffer()),png=await editor.exportPng();
  const surfaces:HTMLCanvasElement[]=[],render=editor.renderer.render.bind(editor.renderer);editor.renderer.render=async(...args)=>{const tile=await render(...args);surfaces.push(tile);return tile;};
  let output:Awaited<ReturnType<typeof editor.export>>;try{output=await editor.export({format:'avif',avifLossless:true,avifSpeed:10});}finally{editor.renderer.render=render;}
  (window as unknown as {avifOutputs:Record<string,Blob>}).avifOutputs={png,avif:output.blob};
  const afterBytes=new Uint8Array(await source.blob.arrayBuffer());return{width,height,readonly:before===JSON.stringify(doc.toJSON())&&revision===doc.getSnapshot().revision&&past===doc.getSnapshot().past.length,sourceUnchanged:sourceBytes.length===afterBytes.length&&sourceBytes.every((v,i)=>v===afterBytes[i]),released:surfaces.every(s=>!s.width&&!s.height),regions:surfaces.length,report:output.report};
 },scenario);
 expect(result.readonly).toBe(true);expect(result.sourceUnchanged).toBe(true);expect(result.released).toBe(true);expect(result.report.featuresPreserved).toContain('Lossless 8-bit colour samples');
 const png=await saveAvifBlob(page,info,'png','png'),avif=await saveAvifBlob(page,info,'avif','avif'),decoder=checkAvif(avif,png);await info.attach('native-composition',{body:JSON.stringify({runtime:result,decoder}),contentType:'application/json'});
});

for(const action of ['cancel','source-remove','font-change'] as const)test(`AVIF ${action} terminates a busy real codec without publishing a result`,async({page},info)=>{
 const font=[...await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2')];await page.goto('/');
 const result=await page.evaluate(async({action,font})=>{
  const {editor,RasterLayer,TextLayer}=window.luma;editor.newDocument({width:512,height:512});const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d')!,pixels=ctx.createImageData(512,512);let seed=12345;for(let i=0;i<pixels.data.length;i+=4){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;pixels.data.set([seed&255,(seed>>>8)&255,(seed>>>16)&255,255],i);}ctx.putImageData(pixels,0,0);
  const source=await editor.assetStore.add(await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!))),'Codec cancellation source',undefined,false);editor.document.layers.add(new RasterLayer({assetId:source.id,width:512,height:512}));
  const face=new FontFace('AVIF lifetime font',new Uint8Array(font));await face.load();document.fonts.add(face);if(action==='font-change')editor.document.layers.add(new TextLayer({text:'Native font lifetime',fontFamily:'"AVIF lifetime font"',fontSize:28}));
  const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,abort=new AbortController(),NativeWorker=window.Worker;let started=false,terminations=0,returned=false,error='',trigger=0,finished=0;
  class ObservedWorker extends NativeWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',event=>{if(event.data?.type!=='started')return;started=true;setTimeout(()=>{trigger=performance.now();if(action==='cancel')abort.abort(new Error('User cancelled busy AVIF'));else if(action==='source-remove')editor.assetStore.remove(source.id);else face.weight='700';},10);});}override terminate(){terminations++;super.terminate();}}
  window.Worker=ObservedWorker;
  try{await editor.export({format:'avif',avifLossless:true,avifSpeed:0},{signal:abort.signal});returned=true;}catch(cause){error=String(cause);}finally{finished=performance.now();window.Worker=NativeWorker;document.fonts.delete(face);}
  const readonly=before===JSON.stringify(editor.document.toJSON())&&revision===editor.document.getSnapshot().revision;let retry=false;if(action==='cancel'){retry=(await editor.export({format:'avif',avifLossless:true,avifSpeed:10})).blob.type==='image/avif';}
  return{started,terminations,returned,error,readonly,retry,cancelMilliseconds:finished-trigger};
 },{action,font});
 expect(result.started).toBe(true);expect(result.terminations).toBe(1);expect(result.returned).toBe(false);expect(result.readonly).toBe(true);expect(result.error).toMatch(action==='cancel'?/User cancelled busy AVIF/:action==='source-remove'?/source changed/:/font.*changed/i);expect(result.cancelMilliseconds).toBeLessThan(1500);if(action==='cancel')expect(result.retry).toBe(true);await info.attach('busy-codec-lifetime',{body:JSON.stringify(result),contentType:'application/json'});
});

test('AVIF missing local codec rejects and a later export retries successfully',async({page},info)=>{
 await page.goto('/');await page.route('**/avif_enc.wasm*',route=>route.fulfill({status:404,body:'Missing codec'}));
 const first=await page.evaluate(async()=>{try{await window.luma.editor.export({format:'avif'});return '';}catch(error){return String(error);}});expect(first).toMatch(/AVIF|wasm|fetch|abort/i);await page.unroute('**/avif_enc.wasm*');
 const result=await page.evaluate(async()=>{const {editor}=window.luma,output=await editor.export({format:'avif',avifLossless:true,avifSpeed:10});(window as unknown as {avifOutputs:Record<string,Blob>}).avifOutputs={avif:output.blob,png:await editor.exportPng()};return output.blob.type;});expect(result).toBe('image/avif');checkAvif(await saveAvifBlob(page,info,'avif','avif'),await saveAvifBlob(page,info,'png','png'));
});

test('50 MP AVIF retains native resolution, every PNG sample and original project sources',async({page},info)=>{
 test.setTimeout(300000);const bytes=[...await readFile('tests/fixtures/matting/native-50mp.png')];await page.goto('/');
 const result=await page.evaluate(async bytes=>{
  const {editor}=window.luma;editor.newDocument();await editor.importImage(new File([new Uint8Array(bytes)],'native-50mp.png',{type:'image/png'}));const before=JSON.stringify(editor.document.toJSON()),project=await editor.saveProject();await editor.openProject(new File([project],'native-avif.luma'));
  const source=editor.assetStore.values()[0],original=new Uint8Array(await source.blob.arrayBuffer()),png=await editor.exportPng(),render=editor.renderer.render.bind(editor.renderer),surfaces:HTMLCanvasElement[]=[];editor.renderer.render=async(...args)=>{const tile=await render(...args);surfaces.push(tile);return tile;};
  const start=performance.now();let blob:Blob;try{blob=(await editor.export({format:'avif',avifLossless:true,avifSpeed:10})).blob;}finally{editor.renderer.render=render;}
  (window as unknown as {avifOutputs:Record<string,Blob>}).avifOutputs={png,avif:blob};return{size:[editor.document.width,editor.document.height],sourceSize:[source.width,source.height],sameModel:before===JSON.stringify(editor.document.toJSON()),sourceUnchanged:original.length===bytes.length&&original.every((v,i)=>v===bytes[i]),released:surfaces.every(s=>!s.width&&!s.height),regions:surfaces.length,milliseconds:performance.now()-start};
 },bytes);
 expect(result.size).toEqual([10000,5000]);expect(result.sourceSize).toEqual(result.size);expect(result.sameModel).toBe(true);expect(result.sourceUnchanged).toBe(true);expect(result.released).toBe(true);expect(result.regions).toBe(395);
 const decoder=checkAvif(await saveAvifBlob(page,info,'avif','avif'),await saveAvifBlob(page,info,'png','png'));await info.attach('native-50mp',{body:JSON.stringify({runtime:result,decoder}),contentType:'application/json'});
});
