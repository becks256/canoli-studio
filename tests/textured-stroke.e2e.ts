import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

declare global { interface Window { textureNative:any; } }

test.beforeEach(async({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const {TexturedStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/textured-stroke.ts'));
    const {BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));
    const {PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts'));
    const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'));
    const assets=new AssetStore(),processor=new PixelProcessor(),raster=new TexturedStrokeRaster(processor),outputs:HTMLCanvasElement[]=[];
    const canvas=(width:number,height:number)=>{const c=document.createElement('canvas');c.width=width;c.height=height;outputs.push(c);return c;};
    const source=canvas(8,8),context=source.getContext('2d')!,image=context.createImageData(8,8);
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){
      const rgb=[[0,0,0],[255,255,255],[255,0,0],[0,0,255]][(x+2*y)%4];
      image.data.set([...rgb,[255,128,64,0][(x+y)%4]],4*(y*8+x));
    }
    context.putImageData(image,0,0);const blob=await new Promise<Blob>(resolve=>source.toBlob(value=>resolve(value!)));
    const asset=await assets.add(blob,'Native pattern','tip',false);
    const read=(c:HTMLCanvasElement)=>c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;
    const difference=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>{
      if(a.length!==b.length)throw new Error('Mismatched reference grids');
      let maxAlpha=0,maxPremultiplied=0,changed=0;
      for(let i=0;i<a.length;i+=4){maxAlpha=Math.max(maxAlpha,Math.abs(a[i+3]-b[i+3]));if(a[i+3]!==b[i+3])changed++;
        for(let k=0;k<3;k++)maxPremultiplied=Math.max(maxPremultiplied,Math.abs(a[i+k]*a[i+3]/255-b[i+k]*b[i+3]/255));}
      return{maxAlpha,maxPremultiplied,changed};
    };
    // Independent whole-surface reference: explicit native matrices/footprints, no shared stamp iterator/geometry.
    const reference=(width:number,height:number,frames:{matrix:number[];alpha?:number}[],options:{channel?:string;invert?:boolean;hardness?:number;pencil?:boolean;color?:string}={})=>{
      const result=canvas(width,height),out=result.getContext('2d')!;
      for(const frame of frames){
        const projected=canvas(width,height),c=projected.getContext('2d')!;
        c.imageSmoothingEnabled=!options.pencil;c.setTransform(new DOMMatrix(frame.matrix));
        const invertAlpha=options.channel==='alpha'&&options.invert;
        if(invertAlpha){
          const original=canvas(asset.width,asset.height),o=original.getContext('2d')!;o.drawImage(asset.bitmap,0,0);const coverage=o.getImageData(0,0,asset.width,asset.height);
          for(let i=0;i<coverage.data.length;i+=4){coverage.data[i]=coverage.data[i+1]=coverage.data[i+2]=255;coverage.data[i+3]=255-coverage.data[i+3];}o.putImageData(coverage,0,0);
          c.drawImage(original,0,0,asset.width,asset.height,-1,-1,2,2);
        }else c.drawImage(asset.bitmap,0,0,asset.width,asset.height,-1,-1,2,2);
        c.resetTransform();
        const pixels=c.getImageData(0,0,width,height);
        if(!invertAlpha)for(let i=0;i<pixels.data.length;i+=4){
          const p=pixels.data,weighted=p[i]*2126+p[i+1]*7152+p[i+2]*722;
          const alpha=options.channel==='alpha'?(options.invert?255-p[i+3]:p[i+3]):Math.floor((p[i+3]*(options.invert?weighted:2550000-weighted)+1275000)/2550000);
          p[i]=p[i+1]=p[i+2]=255;p[i+3]=alpha;
        }
        c.putImageData(pixels,0,0);
        const shape=canvas(width,height),s=shape.getContext('2d')!;s.setTransform(new DOMMatrix(frame.matrix));s.fillStyle='#ffffff';
        if(options.pencil)s.fillRect(-1,-1,2,2);
        else{const hardness=options.hardness??1;if(hardness<.999){const gradient=s.createRadialGradient(0,0,hardness,0,0,1);gradient.addColorStop(0,'#ffffff');gradient.addColorStop(1,'#ffffff00');s.fillStyle=gradient;}s.beginPath();s.arc(0,0,1,0,2*Math.PI);s.fill();}
        c.globalCompositeOperation='destination-in';c.drawImage(shape,0,0);c.globalCompositeOperation='source-in';c.fillStyle=options.color??'#ffffff';c.fillRect(0,0,width,height);
        out.globalAlpha=frame.alpha??1;out.drawImage(projected,0,0);
      }
      return result;
    };
    window.textureNative={TexturedStrokeRaster,BrushTextureSampler,assets,processor,raster,asset,canvas,read,difference,reference,outputs};
  });
});
test.afterEach(async({page})=>{
  await page.evaluate(()=>{const h=window.textureNative;if(!h)return;h.raster.dispose();h.processor.dispose();h.assets.dispose();h.outputs.forEach((c:HTMLCanvasElement)=>c.width=c.height=0);delete window.textureNative;}).catch(()=>{});
});

for(const value of [
  {name:'round grain angle',angle:90,roundness:1,channel:'luminance',invert:false,hardness:1,kind:'brush'},
  {name:'soft tilted ellipse',angle:15,roundness:.6,channel:'luminance',invert:true,hardness:.3,kind:'brush',tilt:true},
  {name:'sheared alpha',angle:31,roundness:.4,channel:'alpha',invert:false,hardness:1,kind:'brush',shear:true},
  {name:'reflected inverted alpha',angle:23,roundness:.5,channel:'alpha',invert:true,hardness:.7,kind:'brush',mirror:true},
  {name:'pixel anchored pencil',angle:90,roundness:.5,channel:'luminance',invert:false,hardness:1,kind:'pencil'},
] as const)test(`textured ${value.name} matches independently projected native pixels`,async({page},info)=>{
  const result=await page.evaluate(async value=>{
    const h=window.textureNative,{BrushStroke,PencilStroke,BrushTip,BrushSymmetry,AffineTransform}=window.luma;
    const pencil=value.kind==='pencil',x=pencil?12.25:32.5,y=pencil?14.75:32.5,size=pencil?7:30;
    const tilt='tilt'in value?{altitude:Math.PI/4,azimuth:Math.PI/3}:undefined;
    const stroke=new(pencil?PencilStroke:BrushStroke)({points:[{x,y,...(tilt?{tilt}:{})}],size,hardness:value.hardness,pressureSize:false,
      tip:new BrushTip({angle:value.angle,roundness:value.roundness,tiltAngle:!!tilt,tiltRoundness:!!tilt}),
      ...('mirror'in value?{symmetry:BrushSymmetry.mirrorVertical(43)}:{}),color:'#ffffff'}).toJSON();
    const world='shear'in value?new AffineTransform(1.1,.2,.3,.9,2,3):new AffineTransform();
    const target=h.canvas(96,96);await h.raster.draw(stroke,{assetId:'tip',channel:value.channel,invert:value.invert},h.assets,target,{x:0,y:0,width:96,height:96,sx:1,sy:1},world);
    const angle=value.angle*Math.PI/180+(tilt?.azimuth??0),rx=pencil?3.5:15,ry=pencil?2:15*value.roundness*(tilt ? .5 : 1);
    const cx=pencil?11.5:x,cy=pencil?14:y;
    const pose=new DOMMatrix().translate(cx,cy).rotate(angle*180/Math.PI).scale(rx,ry);
    const w=new DOMMatrix([world.a,world.b,world.c,world.d,world.e,world.f]);
    const frames=[{matrix:Array.from(w.multiply(pose).toFloat64Array()).filter((_,i)=>[0,1,4,5,12,13].includes(i))}];
    if('mirror'in value){const m=w.multiply(new DOMMatrix([-1,0,0,1,86,0])).multiply(pose);frames.push({matrix:[m.a,m.b,m.c,m.d,m.e,m.f]});}
    const reference=h.reference(96,96,frames,{...value,pencil});
    return{...h.difference(h.read(target),h.read(reference)),replay:h.raster.lastReplay,nonempty:h.read(target).some((v:number,i:number)=>i%4===3&&v>0)};
  },value);
  expect(result.nonempty).toBe(true);expect(result.maxAlpha).toBeLessThanOrEqual(1);expect(result.maxPremultiplied).toBeLessThanOrEqual(1);
  await info.attach('native-texture-reference',{body:JSON.stringify(result),contentType:'application/json'});
});

test('a full 2048-pixel textured dab uses bounded tiles and agrees with an independent whole-surface reference',async({page},info)=>{
  const result=await page.evaluate(async()=>{
    const h=window.textureNative,{BrushStroke}=window.luma,stroke=new BrushStroke({points:[{x:1024,y:1024}],size:2048,hardness:.6,pressureSize:false,color:'#ffffff'}).toJSON();
    const target=h.canvas(2048,2048);await h.raster.draw(stroke,{assetId:'tip',channel:'luminance'},h.assets,target,{x:0,y:0,width:2048,height:2048,sx:1,sy:1});
    const reference=h.reference(2048,2048,[{matrix:[1024,0,0,1024,1024,1024]}],{hardness:.6});
    return{difference:h.difference(h.read(target),h.read(reference)),replay:h.raster.lastReplay,retainedBytes:h.raster.retainedBytes};
  });
  expect(result.replay.tiles).toBeGreaterThan(1);expect(result.difference.maxAlpha).toBeLessThanOrEqual(1);expect(result.difference.maxPremultiplied).toBeLessThanOrEqual(1);
  expect(result.retainedBytes).toBe(16*1024*1024);await info.attach('tiled-texture-reference',{body:JSON.stringify(result),contentType:'application/json'});
});

test('append-only texture replay equals a full replay, and flow accumulates before one external opacity/clip',async({page})=>{
  const result=await page.evaluate(async()=>{
    const h=window.textureNative,{BrushStroke,BrushSymmetry}=window.luma,space={x:0,y:0,width:96,height:96,sx:1,sy:1};
    const make=(points:{x:number;y:number}[])=>({...new BrushStroke({points,size:20,hardness:1,pressureSize:false,flow:.5,opacity:.5,color:'#ffffff',symmetry:BrushSymmetry.mirrorVertical(48)}).toJSON(),id:'live-texture-prefix'});
    const first=make([{x:32.5,y:32.5}]),second=make([{x:32.5,y:32.5},{x:35.5,y:32.5}]);
    const a=h.canvas(96,96);await h.raster.draw(first,{assetId:'tip',channel:'alpha'},h.assets,a,space);
    const b=h.canvas(96,96);await h.raster.draw(second,{assetId:'tip',channel:'alpha'},h.assets,b,space);const incremental=h.raster.lastReplay;
    const fresh=new h.TexturedStrokeRaster(h.processor),c=h.canvas(96,96);try{await fresh.draw(second,{assetId:'tip',channel:'alpha'},h.assets,c,space);}finally{fresh.dispose();}
    const final=h.canvas(96,96),context=final.getContext('2d')!;context.beginPath();context.rect(0,0,48,96);context.clip();context.globalAlpha=.5;context.drawImage(b,0,0);
    const reference=h.canvas(96,96),r=reference.getContext('2d')!;r.beginPath();r.rect(0,0,48,96);r.clip();r.globalAlpha=.5;r.drawImage(c,0,0);
    return{difference:h.difference(h.read(b),h.read(c)),final:h.difference(h.read(final),h.read(reference)),incremental,outside:[...context.getImageData(64,32,1,1).data]};
  });expect(result.incremental.from).toBe(1);expect(result.difference.maxAlpha).toBe(0);expect(result.final.maxAlpha).toBe(0);expect(result.outside).toEqual([0,0,0,0]);
});

test('explicit zero response draws no texture tiles and preserves a pressure-only endpoint on incremental replay',async({page})=>{
  const result=await page.evaluate(async()=>{
    const h=window.textureNative,{PencilStroke,PressureCurve}=window.luma,space={x:0,y:0,width:64,height:64,sx:1,sy:1};
    const make=(points:{x:number;y:number;pressure:number}[])=>({...new PencilStroke({points,size:8,pressureSize:true,pressureOpacity:true,pressureCurve:PressureCurve.linear(),color:'#ffffff'}).toJSON(),id:'live-zero-pressure-texture'});
    const first=h.canvas(64,64);await h.raster.draw(make([{x:32,y:32,pressure:0}]),{assetId:'tip',channel:'alpha'},h.assets,first,space);const zero=h.raster.lastReplay;
    const second=h.canvas(64,64);await h.raster.draw(make([{x:32,y:32,pressure:0},{x:32,y:32,pressure:1}]),{assetId:'tip',channel:'alpha'},h.assets,second,space);
    return{zero,empty:h.read(first).every((v:number)=>v===0),nonempty:h.read(second).some((v:number,i:number)=>i%4===3&&v>0),from:h.raster.lastReplay.from};
  });expect(result.zero.tiles).toBe(0);expect(result.empty).toBe(true);expect(result.nonempty).toBe(true);expect(result.from).toBe(1);
});

test('cancelling an actual pending conversion preserves both the published prefix and the caller target',async({page},info)=>{
  const result=await page.evaluate(async()=>{
    const h=window.textureNative,{BrushStroke}=window.luma,space={x:0,y:0,width:64,height:64,sx:1,sy:1};
    let unblock!:()=>void,enter!:()=>void,block=false;
    const gate=new Promise<void>(resolve=>unblock=resolve),entered=new Promise<void>(resolve=>enter=resolve);
    const raster=new h.TexturedStrokeRaster({brushTexture:async(...args:Parameters<import('../src/engine/processor').PixelProcessor['brushTexture']>)=>{
      const pixels=await h.processor.brushTexture(...args);if(block){enter();await gate;}return pixels;
    }});
    const make=(points:{x:number;y:number}[])=>({...new BrushStroke({points,size:14,hardness:1,pressureSize:false,color:'#ffffff'}).toJSON(),id:'live-cancelled-texture'});
    try{
      const first=make([{x:16,y:16}]),next=make([{x:16,y:16},{x:32,y:32}]);
      await raster.draw(first,{assetId:'tip'},h.assets,h.canvas(64,64),space);const prior=raster.retainedBytes;
      const target=h.canvas(64,64),c=target.getContext('2d')!;c.fillStyle='#ff0000';c.fillRect(0,0,64,64);const before=h.read(target).slice();
      block=true;const abort=new AbortController(),pending=raster.draw(next,{assetId:'tip'},h.assets,target,space,undefined,{signal:abort.signal});await entered;abort.abort();unblock();
      let error='';try{await pending;}catch(reason){error=String(reason);}block=false;
      const after=h.difference(before,h.read(target)),retained=raster.retainedBytes===prior;
      const resumed=h.canvas(64,64);await raster.draw(next,{assetId:'tip'},h.assets,resumed,space);
      const fresh=new h.TexturedStrokeRaster(h.processor),full=h.canvas(64,64);try{await fresh.draw(next,{assetId:'tip'},h.assets,full,space);}finally{fresh.dispose();}
      return{error,after,retained,resumedFrom:raster.lastReplay.from,resume:h.difference(h.read(resumed),h.read(full))};
    }finally{unblock();raster.dispose();}
  });expect(result.error).toContain('Abort');expect(result.after.maxAlpha).toBe(0);expect(result.after.maxPremultiplied).toBe(0);expect(result.retained).toBe(true);expect(result.resumedFrom).toBe(1);expect(result.resume.maxAlpha).toBe(0);
  await info.attach('atomic-texture-prefix',{body:JSON.stringify(result),contentType:'application/json'});
});

test('clearing queued texture work rejects both requests and releases private staging without closing original assets',async({page})=>{
  const result=await page.evaluate(async()=>{
    const h=window.textureNative,{BrushStroke}=window.luma;let unblock!:()=>void,enter!:()=>void;
    const gate=new Promise<void>(resolve=>unblock=resolve),entered=new Promise<void>(resolve=>enter=resolve);
    const raster=new h.TexturedStrokeRaster({brushTexture:async(...args:Parameters<import('../src/engine/processor').PixelProcessor['brushTexture']>)=>{const p=await h.processor.brushTexture(...args);enter();await gate;return p;}});
    const target=h.canvas(64,64),second=h.canvas(64,64),space={x:0,y:0,width:64,height:64,sx:1,sy:1};
    const stroke=new BrushStroke({points:[{x:32,y:32}],size:20,pressureSize:false,color:'#ffffff'}).toJSON();
    const created:HTMLCanvasElement[]=[],original=document.createElement;
    document.createElement=function(...args:Parameters<Document['createElement']>){const element=original.apply(document,args);if(element instanceof HTMLCanvasElement)created.push(element);return element;} as Document['createElement'];
    try{
      const first=raster.draw(stroke,{assetId:'tip'},h.assets,target,space);const queued=raster.draw(stroke,{assetId:'tip'},h.assets,second,space);
      await entered;raster.clear();unblock();const results=await Promise.allSettled([first,queued]);raster.dispose();
      return{rejected:results.every((value:PromiseSettledResult<unknown>)=>value.status==='rejected'),empty:h.read(target).every((v:number)=>v===0)&&h.read(second).every((v:number)=>v===0),retained:raster.retainedBytes,cache:raster.textureCacheBytes,source:h.asset.bitmap.width,released:created.length>=2&&created.every(canvas=>canvas.width===0&&canvas.height===0)};
    }finally{document.createElement=original;unblock();raster.dispose();}
  });expect(result).toEqual({rejected:true,empty:true,retained:0,cache:0,source:8,released:true});
});

test('queued replay owns mutable stroke, texture and view inputs before its first asynchronous yield',async({page})=>{
  const result=await page.evaluate(async()=>{
    const h=window.textureNative,{BrushStroke}=window.luma;
    const stroke=new BrushStroke({points:[{x:32,y:32}],size:20,pressureSize:false,hardness:1,color:'#ffffff'}).toJSON();
    const original=structuredClone(stroke),source={assetId:'tip',channel:'luminance',invert:false},space={x:0,y:0,width:64,height:64,sx:1,sy:1},target=h.canvas(64,64);
    const pending=h.raster.draw(stroke,source,h.assets,target,space);
    stroke.points[0].x=0;stroke.color='#ff0000';source.invert=true;space.x=1000;
    await pending;
    const fresh=new h.TexturedStrokeRaster(h.processor),reference=h.canvas(64,64);
    try{await fresh.draw(original,{assetId:'tip'},h.assets,reference,{x:0,y:0,width:64,height:64,sx:1,sy:1});}finally{fresh.dispose();}
    return h.difference(h.read(target),h.read(reference));
  });expect(result.maxAlpha).toBe(0);expect(result.maxPremultiplied).toBe(0);
});

test('source replacement and changed settings invalidate the whole retained textured prefix',async({page})=>{
  const result=await page.evaluate(async()=>{
    const h=window.textureNative,{BrushStroke}=window.luma,space={x:0,y:0,width:64,height:64,sx:1,sy:1};
    const stroke=new BrushStroke({points:[{x:32,y:32}],size:20,pressureSize:false,hardness:1,color:'#ffffff'}).toJSON();
    const first=h.canvas(64,64);await h.raster.draw(stroke,{assetId:'tip'},h.assets,first,space);
    const second=h.canvas(64,64);await h.raster.draw(stroke,{assetId:'tip',invert:true},h.assets,second,space);const settingsFrom=h.raster.lastReplay.from;
    h.assets.remove('tip');const replacement:HTMLCanvasElement=h.canvas(8,8);replacement.getContext('2d')!.fillStyle='#000000';replacement.getContext('2d')!.fillRect(0,0,8,8);
    const blob=await new Promise<Blob>(resolve=>replacement.toBlob(value=>resolve(value!)));await h.assets.add(blob,'Replacement','tip',false);
    const third=h.canvas(64,64);await h.raster.draw(stroke,{assetId:'tip'},h.assets,third,space);
    return{settingsFrom,sourceFrom:h.raster.lastReplay.from,settingsChanged:h.difference(h.read(first),h.read(second)).changed>0,sourceChanged:h.difference(h.read(first),h.read(third)).changed>0};
  });expect(result).toEqual({settingsFrom:0,sourceFrom:0,settingsChanged:true,sourceChanged:true});
});

test('oversized retained surfaces fall back to complete ephemeral replay without restricting source or output geometry',async({page})=>{
  const result=await page.evaluate(async()=>{
    const h=window.textureNative,{BrushStroke}=window.luma,space={x:0,y:0,width:4200,height:1024,sx:1,sy:1};
    const stroke=new BrushStroke({points:[{x:4000,y:32}],size:16,pressureSize:false,color:'#ffffff'}).toJSON();
    const a=h.canvas(4200,1024);await h.raster.draw(stroke,{assetId:'tip'},h.assets,a,space);const first=h.raster.lastReplay;
    const b=h.canvas(4200,1024);await h.raster.draw(stroke,{assetId:'tip'},h.assets,b,space);
    return{first,second:h.raster.lastReplay,retained:h.raster.retainedBytes,difference:h.difference(h.read(a),h.read(b)),nonempty:h.read(b).some((v:number,i:number)=>i%4===3&&v>0)};
  });expect(result.first.retained).toBe(false);expect(result.second.from).toBe(0);expect(result.retained).toBe(0);expect(result.difference.maxAlpha).toBe(0);expect(result.nonempty).toBe(true);
});

test('native 50 MP texture detail projects directly into a visible crop and retains exact original/project bytes',async({page},info)=>{
  test.setTimeout(240000);await page.getByTestId('import-input').setInputFiles('tests/fixtures/psd/native-50mp.png');await expect(page.locator('.layer-row')).toHaveCount(1,{timeout:120000});
  const result=await page.evaluate(async()=>{
    const h=window.textureNative,{editor,RasterLayer,PencilStroke,AffineTransform}=window.luma,layer=editor.document.layers.at(0);if(!(layer instanceof RasterLayer))throw new Error('Missing source');
    const asset=editor.assetStore.get(layer.assetId),before=JSON.stringify(editor.document.toJSON());
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('');
    const sourceHash=await hash(asset.blob),stroke=new PencilStroke({points:[{x:1024,y:1024}],size:2048,pressureSize:false,color:'#ffffff'}).toJSON();
    const created:HTMLCanvasElement[]=[],original=document.createElement;
    document.createElement=function(...args:Parameters<Document['createElement']>){const element=original.apply(document,args);if(element instanceof HTMLCanvasElement)created.push(element);return element;} as Document['createElement'];
    let target:HTMLCanvasElement;
    try{target=h.canvas(128,64);await h.raster.draw(stroke,{assetId:asset.id},editor.assetStore,target,{x:9800,y:4900,width:128,height:64,sx:1,sy:1},AffineTransform.scale(10000/2048,5000/2048));}
    finally{document.createElement=original;}
    const actual=h.read(target!),reference=h.canvas(128,64),c=reference.getContext('2d')!;c.drawImage(asset.bitmap,9800,4900,128,64,0,0,128,64);const pixels=h.read(reference);let matches=true;
    for(let i=0;i<pixels.length;i+=4){const value=pixels[i]*2126+pixels[i+1]*7152+pixels[i+2]*722;const expected=Math.floor((pixels[i+3]*(2550000-value)+1275000)/2550000);if(actual[i+3]!==expected)matches=false;}
    const shapes=created.map(canvas=>({width:canvas.width,height:canvas.height})),unchanged=before===JSON.stringify(editor.document.toJSON());
    const project=await editor.saveProject();await editor.openProject(new File([project],'native-texture-source.luma'));const reopened=editor.document.layers.at(0);if(!(reopened instanceof RasterLayer))throw new Error('Missing restored source');const restored=editor.assetStore.get(reopened.assetId);
    return{matches,unchanged,sourceHash,reopenedHash:await hash(restored.blob),width:restored.width,height:restored.height,shapes,replay:h.raster.lastReplay};
  });
  expect(result).toMatchObject({matches:true,unchanged:true,width:10000,height:5000});expect(result.sourceHash).toBe(createHash('sha256').update(await readFile('tests/fixtures/psd/native-50mp.png')).digest('hex'));expect(result.reopenedHash).toBe(result.sourceHash);expect(result.shapes.every(shape=>shape.width<=260&&shape.height<=260)).toBe(true);
  await info.attach('native-texture-50mp',{body:JSON.stringify(result),contentType:'application/json'});
});
