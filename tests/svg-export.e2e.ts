import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';

test('documented standalone SVG example runs in isolation without changing active work',async({page})=>{
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: standalone-svg -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();
  await page.goto('/');const result=await page.evaluate(async source=>{
    const editor=window.luma.editor,before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;
    const logs=await editor.runScript(source!);return{logs,unchanged:before===JSON.stringify(editor.document.toJSON()),revision,after:editor.document.getSnapshot().revision};
  },source);expect(result.logs.join(' ')).toContain('Standalone SVG ready true');expect(result.unchanged).toBe(true);expect(result.after).toBe(result.revision);
});

test('SVG preserves nested affine geometry and matches actual native PNG pixels',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const{editor,LayerGroup,VectorLayer,VectorPath,AffineTransform}=window.luma;
    editor.newDocument({width:128,height:128});
    const doc=editor.document,group=doc.layers.add(new LayerGroup());
    group.transform=new AffineTransform(0,1,-1,0,110,10);
    const layer=group.layers.add(new VectorLayer());layer.transform=new AffineTransform(2,0,1,1,5,6);
    layer.paths.add(VectorPath.rectangle({x:1,y:2,width:12,height:10},0,{fill:'#ff0000',stroke:null}));
    const hidden=doc.layers.add(new LayerGroup({visible:false}));
    const secret=hidden.layers.add(new VectorLayer());secret.paths.add(VectorPath.rectangle({x:0,y:0,width:128,height:128},0,{fill:'#00ff00',stroke:null}));
    const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision;
    const exported=await editor.export({format:'svg'}),text=await exported.blob.text();
    const xml=new DOMParser().parseFromString(text,'image/svg+xml');
    const svg=document.importNode(xml.documentElement,true) as unknown as SVGSVGElement;
    svg.style.position='fixed';svg.style.left='-1000px';document.body.append(svg);
    const m=svg.querySelector('path')!.getCTM()!,matrix=[m.a,m.b,m.c,m.d,m.e,m.f];svg.remove();
    async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const c=document.createElement('canvas');c.width=128;c.height=128;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return ctx.getImageData(0,0,128,128).data;}
    const vector=await pixels(exported.blob),native=await pixels(await editor.exportPng());
    let maxAlpha=0,maxPremult=0,interiorErrors=0,edgeDifferences=0,totalAlphaError=0,oracleError=0;const pairs:number[][]=[];const bounds=[128,128,-1,-1];
    for(let i=0;i<vector.length;i+=4){
      // Independent analytic pixel area for the four world-space corners:
      // (102,19), (102,43), (92,53), (92,29). Diagonal edges bisect pixels.
      const x=(i/4)%128,y=Math.floor(i/4/128),top=121-x,bottom=145-x;
      const expected=x>=92&&x<102?(y===top-1||y===bottom-1?128:y>=top&&y<bottom-1?255:0):0;
      oracleError=Math.max(oracleError,Math.abs(vector[i+3]-expected));
      maxAlpha=Math.max(maxAlpha,Math.abs(vector[i+3]-native[i+3]));
      if(vector[i+3]!==native[i+3]){totalAlphaError+=Math.abs(vector[i+3]-native[i+3]);if(native[i+3]===0||native[i+3]===255)interiorErrors++;else edgeDifferences++;if(pairs.length<8)pairs.push([(i/4)%128,Math.floor(i/4/128),vector[i+3],native[i+3]]);}
      for(let c=0;c<3;c++)maxPremult=Math.max(maxPremult,Math.abs(vector[i+c]*vector[i+3]/255-native[i+c]*native[i+3]/255));
      if(vector[i+3]){const x=(i/4)%128,y=Math.floor(i/4/128);bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);}
    }
    return{matrix,bounds,maxAlpha,maxPremult,interiorErrors,edgeDifferences,totalAlphaError,oracleError,pairs,pathCount:xml.querySelectorAll('path').length,errors:xml.querySelectorAll('parsererror').length,unchanged:JSON.stringify(doc.toJSON())===before,revision,afterRevision:doc.getSnapshot().revision};
  });
  await writeFile('/tmp/canoli-svg-geometry.json',JSON.stringify(result,null,2)+'\n');
  expect(result.matrix).toEqual([0,2,-1,1,104,15]);expect(result.bounds).toEqual([92,19,101,52]);
  expect(result.pathCount).toBe(1);expect(result.errors).toBe(0);expect(result.oracleError).toBeLessThanOrEqual(1);
  // Canvas and SVG use different edge antialiasing. Interior native pixels must
  // agree exactly; retain a bounded edge-only diagnostic rather than claim bit parity.
  expect(result.interiorErrors).toBe(0);expect(result.maxAlpha,JSON.stringify(result)).toBeLessThanOrEqual(32);expect(result.maxPremult).toBeLessThanOrEqual(32);expect(result.totalAlphaError/255).toBeLessThan(1);
  expect(result.unchanged).toBe(true);expect(result.afterRevision).toBe(result.revision);
});

test('SVG opacity composites overlapping paths and layers once per isolated boundary',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const{editor,LayerGroup,VectorLayer,VectorPath}=window.luma;editor.newDocument({width:64,height:64});
    const group=editor.document.layers.add(new LayerGroup({opacity:0.5,fillOpacity:0.5}));
    const layer=group.layers.add(new VectorLayer({opacity:0.5,fillOpacity:0.5}));
    layer.paths.add(VectorPath.rectangle({x:4,y:4,width:40,height:40},0,{fill:'#ff0000',stroke:null}));
    layer.paths.add(VectorPath.rectangle({x:24,y:4,width:32,height:40},0,{fill:'#0000ff',stroke:null}));
    async function samples(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const c=document.createElement('canvas');c.width=64;c.height=64;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return[12,32,52].map(x=>Array.from(ctx.getImageData(x,20,1,1).data));}
    return{svg:await samples((await editor.export({format:'svg'})).blob),png:await samples(await editor.exportPng())};
  });
  await writeFile('/tmp/canoli-svg-opacity.json',JSON.stringify(result,null,2)+'\n');
  expect(result.svg).toEqual([[255,0,0,16],[0,0,255,16],[0,0,255,16]]);expect(result.svg).toEqual(result.png);
});

test('reflected rounded paths retain fill and round stroke styling in SVG pixels',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const{editor,VectorLayer,VectorPath,AffineTransform}=window.luma;editor.newDocument({width:64,height:48});
    const layer=editor.document.layers.add(new VectorLayer());layer.transform=new AffineTransform(-2,0,0,2,60,0);
    layer.paths.add(VectorPath.rectangle({x:4,y:4,width:16,height:16},4,{fill:'#00ff00',stroke:'#000000',strokeWidth:2}));
    async function sample(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return[[20,24],[36,24],[56,24]].map(([x,y])=>Array.from(c.getImageData(x,y,1,1).data));}
    return{svg:await sample((await editor.export({format:'svg'})).blob),native:await sample(await editor.exportPng())};
  });expect(result.svg).toEqual([[0,0,0,255],[0,255,0,255],[0,0,0,0]]);expect(result.svg).toEqual(result.native);
});

test('SVG CSS blend modes and group isolation match native interiors for every supported blend',async({page})=>{
  await page.goto('/');const results=await page.evaluate(async()=>{
    const{editor,LayerGroup,VectorLayer,VectorPath}=window.luma;
    const modes=['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity'] as const;
    async function sample(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const c=document.createElement('canvas');c.width=32;c.height=32;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return Array.from(ctx.getImageData(16,16,1,1).data);}
    const results=[];
    for(const mode of modes)for(const grouped of [false,true]){
      editor.newDocument({width:32,height:32});const doc=editor.document;
      const bottom=doc.layers.add(new VectorLayer());bottom.paths.add(VectorPath.rectangle({x:0,y:0,width:32,height:32},0,{fill:'#4b8e65',stroke:null}));
      const group=grouped?doc.layers.add(new LayerGroup({blendMode:mode})):null;
      // Multiply against the group's transparent internal backdrop must not leak
      // through to the opaque bottom layer before the group's own blend applies.
      const top=(group?.layers??doc.layers).add(new VectorLayer({blendMode:grouped?'multiply':mode}));
      top.paths.add(VectorPath.rectangle({x:0,y:0,width:32,height:32},0,{fill:'#bd5ac1',stroke:null}));
      const svg=await sample((await editor.export({format:'svg'})).blob),png=await sample(await editor.exportPng());
      results.push({mode,grouped,svg,png,max:Math.max(...svg.map((v,i)=>Math.abs(v-png[i])))});
      await editor.closeDocument(doc,{discardChanges:true});
    }
    return results;
  });
  await writeFile('/tmp/canoli-svg-blends.json',JSON.stringify(results,null,2)+'\n');
  for(const result of results)expect(result.max,JSON.stringify(result)).toBeLessThanOrEqual(1);
});

test('SVG keeps subpixel paths visible under magnification, escapes IDs and rejects XML controls',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const{editor,VectorLayer,VectorPath,AffineTransform,Document}=window.luma;
    editor.newDocument({width:64,height:64});const layer=editor.document.layers.add(new VectorLayer());
    layer.transform=AffineTransform.scale(10000);layer.paths.add(VectorPath.rectangle({x:0.001,y:0.002,width:0.003,height:0.002},0,{fill:'#123456',stroke:null}));
    const raw=editor.document.toJSON();raw.children[0].id='quote"&<node>\n\t🐈';const assetPath='/src/core/assets.ts',{AssetStore}=await import(assetPath);editor.replace(Document.fromJSON(raw),new AssetStore());
    const text=await(await editor.export({format:'svg'})).blob.text(),xml=new DOMParser().parseFromString(text,'image/svg+xml');
    const image=new Image(),url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}));image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);
    const inside=Array.from(c.getImageData(20,30,1,1).data),outside=Array.from(c.getImageData(5,5,1,1).data);
    const id=xml.querySelector('[data-layer-id]')!.getAttribute('data-layer-id');
    const before=editor.document.toJSON();before.children[0].id='bad\u0001';editor.replace(Document.fromJSON(before),new AssetStore());let error='';try{await editor.export({format:'svg'});}catch(cause){error=String(cause);}
    return{id,inside,outside,error,parserErrors:xml.querySelectorAll('parsererror').length,injected:xml.querySelectorAll('node,script').length};
  });expect(result.id).toBe('quote"&<node>\n\t🐈');expect(result.inside).toEqual([18,52,86,255]);expect(result.outside).toEqual([0,0,0,0]);expect(result.parserErrors).toBe(0);expect(result.injected).toBe(0);expect(result.error).toContain('XML 1.0');
});

test('large SVG export accepts queued cancellation during path serialization and preserves history',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const{editor,VectorLayer,VectorPath}=window.luma;editor.newDocument({width:256,height:256});
    const layer=editor.document.layers.add(new VectorLayer());
    const points=Array.from({length:20000},(_,i)=>({x:i%256,y:Math.floor(i/256)}));
    layer.paths.add(new VectorPath({points}));const doc=editor.document,revision=doc.getSnapshot().revision;
    const control=new AbortController();let responded=false;const at=performance.now();
    let encodingUpdates=0;
    let error='';try{await editor.export({format:'svg'},{signal:control.signal,onProgress:progress=>{if(progress.phase==='encoding'&&++encodingUpdates===2)setTimeout(()=>{responded=true;control.abort();},0);}});}catch(cause){error=(cause as Error).name;}
    const elapsed=performance.now()-at;const retry=await editor.export({format:'svg'});
    return{error,responded,encodingUpdates,elapsed,size:retry.blob.size,revision,afterRevision:doc.getSnapshot().revision};
  });await writeFile('/tmp/canoli-svg-cancellation.json',JSON.stringify(result,null,2)+'\n');expect(result.error).toBe('AbortError');expect(result.responded).toBe(true);expect(result.encodingUpdates).toBeGreaterThanOrEqual(2);expect(result.size).toBeGreaterThan(100000);expect(result.afterRevision).toBe(result.revision);
});
