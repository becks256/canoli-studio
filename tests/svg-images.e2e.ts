import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {exifSegment} from './fixtures/exif';

for(const mode of ['plain','shared','affine','masked-style','tone','erased','edited-style','jpeg-metadata','webp'] as const)test(`SVG ${mode} raster preserves native pixels, vectors and original source bytes`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async({mode,exif})=>{
  const{editor,RasterLayer,LayerGroup,VectorLayer,VectorPath,LayerMask,LayerStyle,MarqueeSelection,AffineTransform,ToneAdjustment,EraserStroke}=window.luma;
  editor.newDocument({width:160,height:120});const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const c=canvas.getContext('2d')!,pixels=c.createImageData(64,32);
  for(let y=0;y<32;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4;pixels.data[i]=x*3;pixels.data[i+1]=y*7;pixels.data[i+2]=80;pixels.data[i+3]=x<8?128:255;}c.putImageData(pixels,0,0);
  const mime=mode==='jpeg-metadata'?'image/jpeg':mode==='webp'?'image/webp':'image/png';let blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),mime,1));
  if(mode==='jpeg-metadata')blob=new Blob([blob.slice(0,2),new Uint8Array(exif),blob.slice(2)],{type:mime});
  const source=await editor.assetStore.add(blob,'private-source-file',undefined,false),sourceBytes=new Uint8Array(await source.blob.arrayBuffer()),doc=editor.document,group=doc.layers.add(new LayerGroup({x:12,y:8})),layer=group.layers.add(new RasterLayer({assetId:source.id,width:source.width,height:source.height,x:4,y:4}));
  if(mode==='shared'){const copy=layer.duplicate();copy.update({x:76,width:32,height:16});}
  if(mode==='affine'){group.transform=new AffineTransform(0,1,-1,0,120,10);layer.transform=new AffineTransform(1,0,0.25,1,4,4);}
  if(mode==='masked-style'||mode==='edited-style'){
   layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:4,y:4,width:48,height:24}),feather:3.75,density:0.8});
   layer.styles=new LayerStyle({dropShadow:{enabled:true,color:'#0020ff',opacity:0.7,x:16,y:8,blur:3},colorOverlay:{enabled:true,color:'#2040e0',opacity:0.3}});group.opacity=0.8;layer.fillOpacity=0.7;
  }
  if(mode==='tone'||mode==='edited-style'){layer.adjustments.add(new ToneAdjustment({exposure:0.5,contrast:20,saturation:-30}));layer.transform=new AffineTransform(1,0,0.25,1,4,4);}
  if(mode==='erased'||mode==='edited-style')layer.erase(new EraserStroke({points:[{x:20,y:16},{x:40,y:16}],size:12,hardness:0.5,opacity:0.75}));
  const vector=doc.layers.add(new VectorLayer());vector.paths.add(VectorPath.rectangle({x:120,y:90,width:12,height:12},0,{fill:'#ff0000',stroke:null}));
  const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision,progress:number[]=[];
  const result=await editor.export({format:'svg'},{onProgress:p=>{if(p.phase==='rendering'&&p.fraction!==null)progress.push(p.fraction);}}),text=await result.blob.text(),xml=new DOMParser().parseFromString(text,'image/svg+xml');
  async function imagePixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,160,120).data;}
  const a=await imagePixels(result.blob),b=await imagePixels(await editor.exportPng());let alpha=0,premult=0;
  for(let i=0;i<a.length;i+=4){alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255));}
  const definitions=[...xml.querySelectorAll('defs > image')],sizes=definitions.map(image=>[Number(image.getAttribute('width')),Number(image.getAttribute('height'))]),pngChunks:string[][]=[];
  for(const definition of definitions){const bytes=Uint8Array.from(atob(definition.getAttribute('href')!.split(',')[1]),c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),chunks:string[]=[];for(let offset=8;offset+12<=bytes.length;){const size=view.getUint32(offset);chunks.push(String.fromCharCode(...bytes.slice(offset+4,offset+8)));offset+=size+12;}pngChunks.push(chunks);}
  const after=new Uint8Array(await editor.assetStore.get(source.id).blob.arrayBuffer());
  return{mode,alpha,premult,sourceSize:[source.width,source.height],sizes,pngChunks,uses:xml.querySelectorAll('use').length,paths:xml.querySelectorAll('svg > g path').length,metadataExcluded:pngChunks.every(chunks=>chunks.every(chunk=>['IHDR','sRGB','IDAT','IEND'].includes(chunk))),sourceUnchanged:sourceBytes.length===after.length&&sourceBytes.every((v,i)=>v===after[i]),unchanged:before===JSON.stringify(doc.toJSON()),revision,afterRevision:doc.getSnapshot().revision,progress,report:result.report};
 },{mode,exif:[...exifSegment()]});await writeFile(`/tmp/canoli-svg-image-${mode}.json`,JSON.stringify(result,null,2)+'\n');
 expect(result.sourceUnchanged).toBe(true);expect(result.unchanged).toBe(true);expect(result.revision).toBe(result.afterRevision);expect(result.metadataExcluded).toBe(true);expect(result.paths).toBe(1);expect(result.alpha,JSON.stringify(result)).toBeLessThanOrEqual(2);expect(result.premult,JSON.stringify(result)).toBeLessThanOrEqual(3);
 if(mode==='shared'){expect(result.uses).toBe(2);expect(result.sizes).toHaveLength(1);}if(!['tone','erased','edited-style'].includes(mode))expect(result.sizes[0]).toEqual(result.sourceSize);
 if(mode==='jpeg-metadata')expect(result.sourceSize).toEqual([32,64]);expect(result.progress.at(-1)).toBe(1);
});

for(const action of ['cancel','source-replace','bitmap-replace','dispose','between-phases'] as const)test(`SVG image preparation rejects ${action} without partial output or retained surfaces`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async action=>{
  const{RasterLayer,LayerMask}=window.luma,{EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts'));
  // Exercise destructive trusted-host races in a separate real application so
  // invalidated assets do not intentionally tear down the mounted React tree.
  const editor:typeof window.luma.editor=new EditorApplication();editor.newDocument({width:2050,height:128});const canvas=document.createElement('canvas');canvas.width=2050;canvas.height=128;const c=canvas.getContext('2d')!;c.fillStyle='#ff0000';c.fillRect(0,0,2050,128);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png')),assets=editor.assetStore,source=await assets.add(blob,'Source',undefined,false),oldBitmap=source.bitmap,replacement={...source,bitmap:await createImageBitmap(blob)};
  const layer=editor.document.layers.add(new RasterLayer({assetId:source.id,width:2050,height:128}));layer.mask=new LayerMask({assetId:source.id});
  const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,abort=new AbortController(),surfaces:HTMLCanvasElement[]=[],original=editor.renderer.render.bind(editor.renderer);
  editor.renderer.render=async(...args)=>{const canvas=await original(...args);if(args[0].children.length===1&&args[0].children[0].kind==='raster'&&!args[0].children[0].mask&&args[0].children[0].styles===undefined)surfaces.push(canvas);return canvas;};
  let invoked=false,error='',returned=false,half=0;const progress:number[]=[];
  try{await editor.export({format:'svg'},{signal:abort.signal,onProgress:p=>{
   if(p.phase!=='rendering'||p.fraction===null)return;progress.push(p.fraction);if(p.fraction===0.5)half++;
   if(invoked||p.fraction<=0||(action==='between-phases'&&half<2))return;invoked=true;
   if(action==='cancel')abort.abort();else if(action==='dispose')assets.dispose();else if(action==='bitmap-replace')source.bitmap=replacement.bitmap;else{assets.remove(source.id);assets.install(replacement,false);}
  }});returned=true;}catch(cause){error=String(cause);}
  const prepared=surfaces.length,released=surfaces.every(canvas=>canvas.width===0&&canvas.height===0);editor.renderer.render=original;
  let retry=false;if(action==='cancel')retry=(await editor.export({format:'svg'})).blob.size>0;
  if(action==='bitmap-replace')oldBitmap.close();if(action==='cancel'||action==='dispose')replacement.bitmap.close();
  const result={action,error,returned,invoked,prepared,released,progress,half,retry,unchanged:before===JSON.stringify(editor.document.toJSON()),revision,after:editor.document.getSnapshot().revision};editor.dispose();return result;
 },action);await writeFile(`/tmp/canoli-svg-image-${action}.json`,JSON.stringify(result,null,2)+'\n');expect(result.invoked).toBe(true);expect(result.returned).toBe(false);expect(result.prepared).toBe(action==='between-phases'?4:2);expect(result.released).toBe(true);expect(result.unchanged).toBe(true);expect(result.revision).toBe(result.after);expect(result.error).toMatch(/abort|changed|disposed/i);if(action==='cancel')expect(result.retry).toBe(true);if(action==='between-phases')expect(result.half).toBe(2);
});

test('a missing raster image fails explicitly instead of disappearing from SVG',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{const{RasterLayer}=window.luma,{EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts')),editor:typeof window.luma.editor=new EditorApplication();editor.document.layers.add(new RasterLayer({assetId:'missing-image',width:32,height:32}));const revision=editor.document.getSnapshot().revision;let error='';try{await editor.export({format:'svg'});}catch(cause){error=String(cause);}const result={error,revision,after:editor.document.getSnapshot().revision};editor.dispose();return result;});expect(result.error).toContain('Missing image asset');expect(result.after).toBe(result.revision);
});

test('SVG embeds a genuine 50 MP source at native resolution without changing original bytes',async({page})=>{
 await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/native-50mp.png');await expect(page.locator('.document-summary')).toContainText('10000 × 5000');
 const result=await page.evaluate(async()=>{
  const{editor,RasterLayer,VectorLayer,VectorPath}=window.luma,doc=editor.document,layer=doc.layers.at(0)! as InstanceType<typeof RasterLayer>,source=editor.assetStore.get(layer.assetId),beforeBytes=new Uint8Array(await source.blob.arrayBuffer());
  const vector=doc.layers.add(new VectorLayer());vector.paths.add(VectorPath.rectangle({x:10,y:10,width:20,height:20},0,{fill:'#ff0000',stroke:null}));
  const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision,start=performance.now(),exported=await editor.export({format:'svg'}),elapsed=performance.now()-start,text=await exported.blob.text(),xml=new DOMParser().parseFromString(text,'image/svg+xml'),image=xml.querySelector('defs > image')!,png=new Blob([Uint8Array.from(atob(image.getAttribute('href')!.split(',')[1]),c=>c.charCodeAt(0))],{type:'image/png'}),bitmap=await createImageBitmap(png);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d')!;const samples=[];
  for(const [x,y] of [[0,0],[19,5],[20,5],[219,100],[220,100],[100,63],[100,64],[100,1023],[100,1024],[100,4994],[100,4995],[9000,4000],[9999,4999]]){c.clearRect(0,0,1,1);c.drawImage(bitmap,x,y,1,1,0,0,1,1);const output=Array.from(c.getImageData(0,0,1,1).data);c.clearRect(0,0,1,1);c.drawImage(source.bitmap,x,y,1,1,0,0,1,1);samples.push({x,y,output,original:Array.from(c.getImageData(0,0,1,1).data)});}
  const size=[bitmap.width,bitmap.height];bitmap.close();const afterBytes=new Uint8Array(await editor.assetStore.get(source.id).blob.arrayBuffer());
  return{elapsed,bytes:exported.blob.size,size,rootSize:[xml.documentElement.getAttribute('width'),xml.documentElement.getAttribute('height')],imageCount:xml.querySelectorAll('defs > image').length,paths:xml.querySelectorAll('path').length,samples,sourceUnchanged:beforeBytes.length===afterBytes.length&&beforeBytes.every((v,i)=>v===afterBytes[i]),unchanged:before===JSON.stringify(doc.toJSON()),revision,after:doc.getSnapshot().revision};
 });await writeFile('/tmp/canoli-svg-image-50mp.json',JSON.stringify(result,null,2)+'\n');expect(result.size).toEqual([10000,5000]);expect(result.rootSize).toEqual(['10000','5000']);expect(result.imageCount).toBe(1);expect(result.paths).toBe(1);for(const sample of result.samples)expect(sample.output).toEqual(sample.original);expect(result.samples.filter(sample=>sample.output[3]>0).length).toBeGreaterThanOrEqual(8);expect(result.sourceUnchanged).toBe(true);expect(result.unchanged).toBe(true);expect(result.revision).toBe(result.after);
});
