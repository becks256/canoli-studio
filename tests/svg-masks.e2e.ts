import {test,expect} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';

test('documented masked SVG example executes in isolation without a host image service',async({page})=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: standalone-svg-mask -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();
 await page.goto('/');const result=await page.evaluate(async source=>{const editor=window.luma.editor,before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,logs=await editor.runScript(source!);return{logs,unchanged:before===JSON.stringify(editor.document.toJSON()),revision,after:editor.document.getSnapshot().revision};},source);
 expect(result.logs.join(' ')).toContain('Standalone masked SVG ready');expect(result.unchanged).toBe(true);expect(result.after).toBe(result.revision);
});

for(const mode of ['vector','vector-inverted','vector-density','empty-inverted','nonzero','unlinked','paint','feathered-selection','sampled','bitmap','painted-vector'] as const)test(`SVG ${mode} mask retains real coverage and editable artwork`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async mode=>{
  const{editor,LayerGroup,VectorLayer,VectorPath,LayerMask,MarqueeSelection,BrushStroke,AffineTransform}=window.luma;
  editor.newDocument({width:160,height:96});const doc=editor.document,group=doc.layers.add(new LayerGroup({x:12,y:8})),layer=group.layers.add(new VectorLayer({x:4,y:4}));
  layer.paths.add(VectorPath.rectangle({x:-500,y:-500,width:2000,height:2000},0,{fill:'#df7842',stroke:null}));
  const outer=VectorPath.rectangle({x:8,y:8,width:64,height:48}),inner=VectorPath.rectangle({x:24,y:20,width:24,height:20});
  let original:Blob|undefined,sourceId:string|undefined;
  if(mode==='paint')layer.mask=new LayerMask({base:0.8,inverted:true,density:0.7,feather:4.5}).paint(new BrushStroke({points:[{x:8,y:8},{x:64,y:48}],size:24,hardness:0.4,opacity:0.7}),'hide');
  else if(mode==='feathered-selection')layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:8,y:8,width:64,height:48}).combine(new MarqueeSelection({shape:'rectangle',x:24,y:20,width:24,height:20}),'subtract'),feather:5.25,density:0.75,basis:new AffineTransform(1,0.25,0.1,1,0,0)});
  else if(mode==='sampled')layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'pixels',x:8,y:8,width:4,height:1,coverage:{width:4,height:1,runs:[1,255,2,128,3,16,4,0]}}),basis:AffineTransform.scale(8)});
  else if(mode==='bitmap'){
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;const c=canvas.getContext('2d')!,image=c.createImageData(32,24);
    for(let i=0;i<32*24;i++){image.data[i*4]=237;image.data[i*4+1]=39;image.data[i*4+2]=121;image.data[i*4+3]=[255,128,16,0][Math.floor((i%32)/8)];}c.putImageData(image,0,0);
    original=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png'));const source=await editor.assetStore.add(original,'Private RGB mask',undefined,false);sourceId=source.id;
    layer.mask=new LayerMask({assetId:source.id,x:8,y:8,basis:AffineTransform.scale(2),density:0.75});
  }else{
    layer.mask=new LayerMask({paths:mode==='empty-inverted'?[]:[outer,inner],fillRule:mode==='nonzero'?'nonzero':'evenodd',inverted:mode==='vector-inverted'||mode==='empty-inverted',density:mode==='vector-density'?0.6:1,linked:mode!=='unlinked',x:mode==='unlinked'?24:0,y:mode==='unlinked'?20:0});
    if(mode==='painted-vector')layer.mask=layer.mask.paint(new BrushStroke({points:[{x:32,y:30}],size:16,hardness:0.4,opacity:0.7}),'reveal');
    if(mode==='unlinked'){group.transform=new AffineTransform(2,0,1,1,12,8);layer.transform=new AffineTransform(-1,0,0,1,100,4);}
  }
  const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision,exported=await editor.export({format:'svg'}),text=await exported.blob.text();
  const xml=new DOMParser().parseFromString(text,'image/svg+xml');
  async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=160;canvas.height=96;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,160,96).data;}
  const svg=await pixels(exported.blob),png=await pixels(await editor.exportPng());let maxAlpha=0,maxPremult=0,sum=0;
  for(let i=0;i<svg.length;i+=4){maxAlpha=Math.max(maxAlpha,Math.abs(svg[i+3]-png[i+3]));sum+=Math.abs(svg[i+3]-png[i+3]);for(let c=0;c<3;c++)maxPremult=Math.max(maxPremult,Math.abs(svg[i+c]*svg[i+3]/255-png[i+c]*png[i+3]/255));}
  const embedded=[...xml.querySelectorAll('mask image')];let leakedRgb=false;
  for(const element of embedded){const image=new Image();image.src=element.getAttribute('href')!;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);const bytes=c.getImageData(0,0,image.width,image.height).data;for(let i=0;i<bytes.length;i+=4)if(bytes[i+3]&&(bytes[i]!==255||bytes[i+1]!==255||bytes[i+2]!==255))leakedRgb=true;}
  let sourceUnchanged=true;if(sourceId&&original){const a=new Uint8Array(await original.arrayBuffer()),b=new Uint8Array(await editor.assetStore.get(sourceId).blob.arrayBuffer());sourceUnchanged=a.length===b.length&&a.every((v,i)=>v===b[i]);}
  return{mode,maxAlpha,maxPremult,meanAlpha:sum/(160*96),samples:[[10,10],[30,25],[48,40],[80,60],[120,80]].map(([x,y])=>svg[(y*160+x)*4+3]),embedded:embedded.length,vectorMaskPaths:xml.querySelectorAll('mask path, clipPath path').length,geometricClips:xml.querySelectorAll('clipPath path').length,artworkPaths:xml.querySelectorAll('svg > g path').length,leakedRgb,sourceUnchanged,errors:xml.querySelectorAll('parsererror').length,unchanged:before===JSON.stringify(doc.toJSON()),revision,afterRevision:doc.getSnapshot().revision,report:exported.report};
 },mode);
 await writeFile(`/tmp/canoli-svg-mask-${mode}.json`,JSON.stringify(result,null,2)+'\n');
 expect(result.errors).toBe(0);expect(result.artworkPaths).toBe(1);expect(result.maxAlpha,JSON.stringify(result)).toBeLessThanOrEqual(1);expect(result.maxPremult).toBeLessThanOrEqual(1.5);expect(result.unchanged).toBe(true);expect(result.afterRevision).toBe(result.revision);expect(result.leakedRgb).toBe(false);expect(result.sourceUnchanged).toBe(true);
 if(['vector','vector-inverted','vector-density','empty-inverted','nonzero','unlinked'].includes(mode)){expect(result.embedded).toBe(0);expect(result.vectorMaskPaths).toBe(1);expect(result.geometricClips).toBe(['vector','nonzero','unlinked'].includes(mode)?1:0);}else expect(result.embedded).toBe(1);
 if(mode==='vector')expect(result.samples).toEqual([0,255,0,255,0]);if(mode==='vector-inverted')expect(result.samples).toEqual([255,0,255,0,255]);if(mode==='vector-density')expect(result.samples).toEqual([102,255,102,255,102]);if(mode==='empty-inverted')expect(result.samples).toEqual([255,255,255,255,255]);
});

test('nested feathered SVG masks retain coverage across native tile boundaries',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{editor,LayerGroup,VectorLayer,VectorPath,LayerMask,MarqueeSelection,BrushStroke}=window.luma;editor.newDocument({width:2100,height:72});
  const group=editor.document.layers.add(new LayerGroup({x:12,y:8,opacity:0.6,fillOpacity:0.8})),layer=group.layers.add(new VectorLayer({x:4,y:4,opacity:0.7,fillOpacity:0.9}));
  layer.paths.add(VectorPath.rectangle({x:-100,y:-100,width:2400,height:300},0,{fill:'#df7842',stroke:null}));
  layer.mask=new LayerMask({base:0.8,feather:4.5,density:0.75}).paint(new BrushStroke({points:[{x:900,y:10},{x:2075,y:35}],size:30,hardness:0.4,opacity:0.7}),'hide');
  group.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:990,y:5,width:1080,height:48}),feather:3.75,density:0.7});
  const exported=await editor.export({format:'svg'}),text=await exported.blob.text(),xml=new DOMParser().parseFromString(text,'image/svg+xml');
  async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=2100;canvas.height=72;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,2100,72).data;}
  const svg=await pixels(exported.blob),png=await pixels(await editor.exportPng());let maxAlpha=0,maxPremult=0;const samples=[];
  for(let i=0;i<svg.length;i+=4){maxAlpha=Math.max(maxAlpha,Math.abs(svg[i+3]-png[i+3]));for(let c=0;c<3;c++)maxPremult=Math.max(maxPremult,Math.abs(svg[i+c]*svg[i+3]/255-png[i+c]*png[i+3]/255));}
  for(const x of [1000,1023,1024,1025,2047,2048,2049,2099])for(const y of [12,30,48])samples.push({x,y,svg:svg[(y*2100+x)*4+3],png:png[(y*2100+x)*4+3]});
  return{maxAlpha,maxPremult,samples,maskCount:xml.querySelectorAll('mask').length,tiles:xml.querySelectorAll('mask image').length};
 });await writeFile('/tmp/canoli-svg-mask-seams.json',JSON.stringify(result,null,2)+'\n');expect(result.maskCount).toBe(2);expect(result.tiles).toBe(6);expect(result.maxAlpha,JSON.stringify(result)).toBeLessThanOrEqual(2);expect(result.maxPremult).toBeLessThanOrEqual(2.5);
});

for(const action of ['cancel','source-remove','source-replace','dispose'] as const)test(`native SVG mask preparation rejects ${action} and releases actual tile surfaces`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async action=>{
  const{editor,VectorLayer,VectorPath,LayerMask}=window.luma;editor.newDocument({width:2050,height:32});
  const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const c=canvas.getContext('2d')!;c.fillStyle='#ff0000';c.fillRect(0,0,8,8);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png')),assets=editor.assetStore,source=await assets.add(blob,'Mask',undefined,false),replacement={...source,bitmap:await createImageBitmap(blob)};
  const layer=editor.document.layers.add(new VectorLayer());layer.paths.add(VectorPath.rectangle({x:0,y:0,width:2050,height:32},0,{fill:'#ff0000',stroke:null}));layer.mask=new LayerMask({assetId:source.id});
  const doc=editor.document,before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision,abort=new AbortController(),surfaces:HTMLCanvasElement[]=[];
  const original=editor.renderer.renderMaskCoverage.bind(editor.renderer);editor.renderer.renderMaskCoverage=async(...args)=>{const result=await original(...args);if(args[4].startsWith('svg:'))surfaces.push(result);return result;};
  let invoked=false,error='';const progress:number[]=[];
  try{await editor.export({format:'svg'},{signal:abort.signal,onProgress:p=>{
   if(p.phase==='rendering'&&p.fraction!==null){progress.push(p.fraction);if(p.fraction>0&&!invoked){invoked=true;if(action==='cancel')abort.abort();else if(action==='dispose')assets.dispose();else{assets.remove(source.id);if(action==='source-replace')assets.install(replacement,false);}}}
  }});}catch(cause){error=String(cause);}
  const released=surfaces.every(surface=>surface.width===0&&surface.height===0),prepared=surfaces.length;
  editor.renderer.renderMaskCoverage=original;
  let retry=false;if(action==='cancel')retry=(await editor.export({format:'svg'})).blob.size>0;
  if(action!=='source-replace')replacement.bitmap.close();
  return{action,error,invoked,prepared,released,progress,retry,unchanged:JSON.stringify(doc.toJSON())===before,revision,afterRevision:doc.getSnapshot().revision};
 },action);await writeFile(`/tmp/canoli-svg-mask-${action}.json`,JSON.stringify(result,null,2)+'\n');expect(result.invoked).toBe(true);expect(result.prepared).toBe(1);expect(result.released).toBe(true);expect(result.unchanged).toBe(true);expect(result.afterRevision).toBe(result.revision);expect(result.error).toMatch(/abort|changed|disposed/i);if(action==='cancel')expect(result.retry).toBe(true);
});

test('a missing bitmap mask fails explicitly without emitting unmasked artwork',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{editor,VectorLayer,VectorPath,LayerMask}=window.luma;const layer=editor.document.layers.add(new VectorLayer());layer.paths.add(VectorPath.rectangle({x:0,y:0,width:32,height:32}));
  layer.mask=new LayerMask({assetId:'unavailable-mask-source'});const revision=editor.document.getSnapshot().revision;let error='';try{await editor.export({format:'svg'});}catch(cause){error=String(cause);}return{error,revision,after:editor.document.getSnapshot().revision};
 });expect(result.error).toContain('Missing image asset');expect(result.after).toBe(result.revision);
});

test('standalone attached-layer SVG rebases an unlinked mask into its parent plane',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{editor,LayerGroup,VectorLayer,VectorPath,LayerMask}=window.luma;editor.newDocument({width:100,height:80});const group=editor.document.layers.add(new LayerGroup({x:20,y:10})),layer=group.layers.add(new VectorLayer({x:5,y:5}));
  layer.paths.add(VectorPath.rectangle({x:-100,y:-100,width:300,height:300},0,{fill:'#ff0000',stroke:null}));layer.mask=new LayerMask({paths:[VectorPath.rectangle({x:0,y:0,width:10,height:10})],linked:false,x:40,y:30});
  const before=JSON.stringify(editor.document.toJSON()),text=layer.toSvg(100,80),image=new Image(),url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}));image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=100;canvas.height=80;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);
  return{samples:[[22,22],[42,32],[12,12]].map(([x,y])=>Array.from(c.getImageData(x,y,1,1).data)),unchanged:before===JSON.stringify(editor.document.toJSON())};
 });expect(result.samples).toEqual([[255,0,0,255],[0,0,0,0],[0,0,0,0]]);expect(result.unchanged).toBe(true);
});

test('genuine 50 MP source remains original while native SVG mask tiles preserve seam coverage',async({page})=>{
 await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/native-50mp.png');await expect(page.locator('.document-summary')).toContainText('10000 × 5000');
 const result=await page.evaluate(async()=>{
  const{editor,VectorLayer,VectorPath,LayerMask,MarqueeSelection,RasterLayer}=window.luma,doc=editor.document,original=doc.layers.at(0)! as InstanceType<typeof RasterLayer>,source=editor.assetStore.get(original.assetId),bytes=new Uint8Array(await source.blob.arrayBuffer());original.visible=false;
  const layer=doc.layers.add(new VectorLayer());layer.paths.add(VectorPath.rectangle({x:0,y:0,width:10000,height:5000},0,{fill:'#ff0000',stroke:null}));
  const selection=new MarqueeSelection({shape:'rectangle',x:1000,y:0,width:8000,height:5000}).combine(new MarqueeSelection({shape:'rectangle',x:1023,y:20,width:3,height:3}),'subtract').combine(new MarqueeSelection({shape:'rectangle',x:2047,y:20,width:3,height:3}),'subtract');layer.mask=new LayerMask({selection,density:0.75});
  const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision,start=performance.now(),progress:number[]=[];
  const exported=await editor.export({format:'svg'},{onProgress:p=>{if(p.phase==='rendering'&&p.fraction!==null)progress.push(p.fraction);}}),elapsed=performance.now()-start,text=await exported.blob.text(),xml=new DOMParser().parseFromString(text,'image/svg+xml'),root=xml.documentElement,dimensions=[root.getAttribute('width'),root.getAttribute('height')],images=[...xml.querySelectorAll('mask image')];
  // Verify native-coordinate crops of the actual exported SVG. Avoid claiming a
  // full 50 MP browser raster allocation from these small decoded crop checks.
  const samples=[];for(const x of [999,1000,1022,1023,1024,1025,1026,2047,2048,9000]){
    root.setAttribute('width','8');root.setAttribute('height','8');root.setAttribute('viewBox',`${x-2} 18 8 8`);
    const image=new Image(),url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)],{type:'image/svg+xml'}));image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);samples.push(c.getImageData(2,2,1,1).data[3]);
  }
  const after=new Uint8Array(await editor.assetStore.get(source.id).blob.arrayBuffer());return{dimensions,tileCount:images.length,maxTile:Math.max(...images.map(image=>Math.max(Number(image.getAttribute('width')),Number(image.getAttribute('height'))))),samples,elapsed,bytes:exported.blob.size,progressFirst:progress[0],progressLast:progress.at(-1),sourceDimensions:[source.width,source.height],sourceUnchanged:bytes.length===after.length&&bytes.every((v,i)=>v===after[i]),unchanged:before===JSON.stringify(doc.toJSON()),revision,afterRevision:doc.getSnapshot().revision};
 });await writeFile('/tmp/canoli-svg-mask-50mp.json',JSON.stringify(result,null,2)+'\n');expect(result.dimensions).toEqual(['10000','5000']);expect(result.sourceDimensions).toEqual([10000,5000]);expect(result.tileCount).toBe(50);expect(result.maxTile).toBe(1024);expect(result.samples).toEqual([64,255,255,64,64,64,255,64,64,64]);expect(result.sourceUnchanged).toBe(true);expect(result.unchanged).toBe(true);expect(result.afterRevision).toBe(result.revision);expect(result.progressFirst).toBe(0);expect(result.progressLast).toBe(1);
});
