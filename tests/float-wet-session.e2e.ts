import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createGunzip,gunzipSync} from 'node:zlib';
import type {Rect} from '../src/core/drawing';
import type {WetStrokeResult} from '../src/engine/wet-state';

const base='tests/fixtures/float-wet-session/';
test('real float retained sessions preserve independent prefix words through native backing and cache eviction',async({page},info)=>{
  const manifest=JSON.parse(await readFile(base+'manifest.json','utf8'));await page.goto('/');
  const result=await page.evaluate(async manifest=>{
    const {createFloatWetStrokeSession}=await import(/* @vite-ignore */ String('/src/engine/wet-session.ts')) as typeof import('../src/engine/wet-session');
    const {PixelProcessor}=await import(/* @vite-ignore */ String('/src/engine/processor.ts')) as typeof import('../src/engine/processor');
    const {PencilStroke,MarqueeSelection}=window.luma,p=new PixelProcessor(),names=async()=>(await indexedDB.databases()).map(v=>v.name).filter(n=>n?.startsWith('canoli-wet-job-')).sort(),before=await names();
    const source=async(region:Rect)=>{const result=new Float32Array(region.width*region.height*4);for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++){const xx=region.x+x,yy=region.y+y;result.set([2+xx*.25,-3+yy*.125,8+((xx-yy)&7)*.5,(xx+yy)%13===0?0:.375+((xx*3+yy*5)&7)/16],(y*region.width+x)*4);}return result;};
    const input=new PencilStroke({size:3,spacing:.25,pressureSize:false,pressureOpacity:false,opacity:manifest.opacity,flow:manifest.flow,clip:new MarqueeSelection({shape:'rectangle',...manifest.clip}),points:manifest.points.map(([x,y]:number[])=>({x,y,pressure:1}))}).toJSON();
    const read=async(output:WetStrokeResult<Float32Array>)=>{const region=manifest.region,result=await source(region);for await(const tile of output.tiles(region)){if(!(tile.before instanceof Float32Array)||!(tile.pixels instanceof Float32Array))throw new Error('Byte retained output');for(let y=0;y<tile.region.height;y++)result.set(tile.pixels.subarray(y*tile.region.width*4,(y+1)*tile.region.width*4),((tile.region.y+y-region.y)*region.width+tile.region.x-region.x)*4);}return [...new Uint8Array(result.buffer)];};
    const rows=[];
    try{for(const cacheBytes of [0,2048]){
      const session=await createFloatWetStrokeSession({...input,points:input.points.slice(0,2)},source,p,{tileSize:cacheBytes?16:4,cacheBytes,load:manifest.load,mix:manifest.mix,coverage:async(_s,frame,region)=>{const inverse=frame.inverse(),mask=new Float32Array(region.width*region.height);for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++){const at=inverse.point({x:region.x+x+.5,y:region.y+y+.5});if(at.x>=-1&&at.x<1&&at.y>=-1&&at.y<1)mask[y*region.width+x]=[1/4096,.375,1][((region.x+x+2*(region.y+y))%3+3)%3];}return mask;}});
      const prefix=await session.snapshot();await session.append(input.points.slice(2,3));const middle=await session.snapshot();await session.append(input.points.slice(3));const final=await session.finish();await session.dispose();
      try{rows.push({cacheBytes,peak:final.diagnostics.peakCacheBytes,dabs:final.diagnostics.dabs,owned:(await names()).length-before.length,values:[{name:'prefix',bytes:await read(prefix)},{name:'middle',bytes:await read(middle)},{name:'final',bytes:await read(final)}]});}finally{await prefix.dispose();await middle.dispose();await final.dispose();}
    }return {rows,cleaned:JSON.stringify(before)===JSON.stringify(await names())};}finally{p.dispose();}
  },manifest);
  expect(result.cleaned).toBe(true);
  for(const row of result.rows){expect(row.dabs).toBe(6);expect(row.owned).toBe(3);expect(row.peak).toBeLessThanOrEqual(row.cacheBytes);if(row.cacheBytes)expect(row.peak).toBeGreaterThan(0);for(const value of row.values){const actual=Buffer.from(value.bytes);expect(actual.equals(gunzipSync(await readFile(base+value.name+'.f32le.gz'))),value.name).toBe(true);await writeFile(info.outputPath(`${row.cacheBytes}-${value.name}.f32le`),actual);}}
  await writeFile(info.outputPath('float-retained-prefixes.json'),JSON.stringify({rows:result.rows.map(row=>({...row,values:row.values.map(value=>({name:value.name,bytes:value.bytes.length,exact:true}))})),cleaned:result.cleaned},null,2));
});

test('real textured tilted HDR reservoirs retain exact partitions and owned snapshots after source closure',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {createFloatWetStrokeSession}=await import(/* @vite-ignore */ String('/src/engine/wet-session.ts')) as typeof import('../src/engine/wet-session');
    const {prepareFloatWetStroke}=await import(/* @vite-ignore */ String('/src/engine/wet-stroke.ts')) as typeof import('../src/engine/wet-stroke');
    const {PixelProcessor}=await import(/* @vite-ignore */ String('/src/engine/processor.ts')) as typeof import('../src/engine/processor');
    const {AssetStore}=await import(/* @vite-ignore */ String('/src/core/assets.ts')) as typeof import('../src/core/assets');
    const {encodeRgbaPng}=await import(/* @vite-ignore */ String('/src/engine/png.ts')) as typeof import('../src/engine/png');
    const {BrushStroke,AffineTransform}=window.luma,assets=new AssetStore(),p=new PixelProcessor(),pattern=new Uint8Array(64);
    for(let at=0;at<pattern.length;at+=4)pattern.set([at%8?255:0,at%8?255:0,at%8?255:0,255],at);await assets.add(await encodeRgbaPng(pattern,4,4),'Tip','tip',false);
    const points=[{x:2.5,y:3.5,pressure:.6,tilt:{altitude:.4,azimuth:.2}},{x:8.5,y:7.5,pressure:1,tilt:{altitude:.8,azimuth:1}},{x:5.5,y:9.5,pressure:.4,tilt:{altitude:.3,azimuth:2}}];
    const input=new BrushStroke({size:6,spacing:.3,opacity:.6,flow:.7,pressureOpacity:true,tip:{roundness:.5,angle:23,tiltAngle:true},texture:{assetId:'tip',channel:'luminance',invert:false},symmetry:{copies:[new AffineTransform(-1,.1,.2,1,9,0).toJSON()]},points}).toJSON(),transform=new AffineTransform(1.1,.2,.1,.9,-.5,1.5);
    const source=async(region:Rect)=>{const out=new Float32Array(region.width*region.height*4);for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++)out.set([(region.x+x)*.5-4,(region.y+y)*.25-3,8,.375],(y*region.width+x)*4);return out;};
    const read=async(output:WetStrokeResult<Float32Array>)=>{const rows:{x:number;y:number;words:number[]}[]=[];for await(const tile of output.tiles())for(let y=0;y<tile.region.height;y++)for(let x=0;x<tile.region.width;x++)if(tile.changed[y*tile.region.width+x]){const pixels=tile.pixels.subarray((y*tile.region.width+x)*4,(y*tile.region.width+x+1)*4);rows.push({x:tile.region.x+x,y:tile.region.y+y,words:[...new Uint32Array(pixels.buffer,pixels.byteOffset,4)]});}return rows.sort((a,b)=>a.y-b.y||a.x-b.x);};
    const reference=await prepareFloatWetStroke(input,source,p,{assets,transform,tileSize:32}),session=await createFloatWetStrokeSession({...input,points:points.slice(0,1)},source,p,{assets,transform,tileSize:8,cacheBytes:0});
    await session.append(points.slice(1,2));const prefix=await session.snapshot(),before=await read(prefix);await session.append(points.slice(2));const final=await session.finish();await session.dispose();assets.dispose();
    try{const actual=await read(final),expected=await read(reference);return {exact:JSON.stringify(actual)===JSON.stringify(expected),prefixStable:JSON.stringify(await read(prefix))===JSON.stringify(before),changed:actual.length,dabs:[final.diagnostics.dabs,reference.diagnostics.dabs],rows:actual};}finally{await prefix.dispose();await final.dispose();await reference.dispose();p.dispose();}
  });
  expect(result.exact).toBe(true);expect(result.prefixStable).toBe(true);expect(result.changed).toBeGreaterThan(0);expect(result.dabs[0]).toBe(result.dabs[1]);await writeFile(info.outputPath('float-textured-partitions.json'),JSON.stringify(result,null,2));
});

test('native float session failure deletes unpublished databases and preserves earlier prefixes',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {createFloatWetStrokeSession}=await import(/* @vite-ignore */ String('/src/engine/wet-session.ts')) as typeof import('../src/engine/wet-session');
    const {createWetTileStore}=await import(/* @vite-ignore */ String('/src/engine/wet-store.ts')) as typeof import('../src/engine/wet-store');
    const {PixelProcessor}=await import(/* @vite-ignore */ String('/src/engine/processor.ts')) as typeof import('../src/engine/processor');
    const {PencilStroke}=window.luma,p=new PixelProcessor(),names=async()=>(await indexedDB.databases()).map(v=>v.name).filter(n=>n?.startsWith('canoli-wet-job-')).sort(),before=await names(),rows=[];
    try{for(const reason of ['abort','quota']){
      const abort=new AbortController();let calls=0,stop=false;
      const session=await createFloatWetStrokeSession(new PencilStroke({size:1,points:[{x:3.5,y:4.5}]}).toJSON(),async region=>new Float32Array(region.width*region.height*4),p,{signal:abort.signal,tileSize:8,load:{color:[4,-2,8,.375],load:1},mix:{pickup:0},storage:async()=>{const store=await createWetTileStore();if(++calls===3&&reason==='quota')store.batch=async()=>{throw new Error('Quota exhausted');};return store;},onProgress:()=>{if(stop)abort.abort(new Error('Stop float append'));}});
      const prefix=await session.snapshot(),first=(await prefix.tiles().next()).value!.pixels.slice();let error='';
      if(reason==='abort'){stop=true;try{await session.append([{x:7.5,y:4.5,pressure:1}]);}catch(e){error=String(e);}}
      else{await session.append([{x:7.5,y:4.5,pressure:1}]);try{await session.snapshot();}catch(e){error=String(e);}}
      await session.dispose();const after=(await prefix.tiles().next()).value!.pixels;rows.push({reason,error,stable:new Uint32Array(first.buffer).every((word,i)=>word===new Uint32Array(after.buffer)[i]),active:(await names()).length-before.length});await prefix.dispose();
    }return {rows,cleaned:JSON.stringify(before)===JSON.stringify(await names())};}finally{p.dispose();}
  });
  expect(result.cleaned).toBe(true);for(const row of result.rows){expect(row.stable).toBe(true);expect(row.active).toBe(1);expect(row.error).toMatch(row.reason==='abort'?/Stop float append/:/Quota exhausted/);}await writeFile(info.outputPath('float-retained-failures.json'),JSON.stringify(result,null,2));
});

async function referenceWindow(name:string,width:number,region:Rect){
  const input=createReadStream('tests/fixtures/float-source/'+name),decoded=input.pipe(createGunzip()),output=Buffer.alloc(region.width*region.height*16),end=((region.y+region.height-1)*width+region.x+region.width)*16;let position=0;
  try{for await(const chunk of decoded){for(let y=0;y<region.height;y++){const start=((region.y+y)*width+region.x)*16,left=Math.max(position,start),right=Math.min(position+chunk.length,start+region.width*16);if(right>left)chunk.copy(output,y*region.width*16+left-start,left-position,right-position);}position+=chunk.length;if(position>=end)break;}}finally{decoded.destroy();input.destroy();}
  const values=new Float32Array(new Uint8Array(output).buffer);for(let at=0;at<values.length;at+=4)if(values[at+3]===0)values.fill(0,at,at+3);return Buffer.from(values.buffer);
}
for(const file of ['rgba-raw-le.tif','native-50mp.tif'])test('original-derived float retained replay owns pixels after native source closure: '+file,async({page},info)=>{
  test.setTimeout(600000);await page.goto('/');
  const result=await page.evaluate(async({bytes,file})=>{
    const {createFloatWetStrokeSession}=await import(/* @vite-ignore */ String('/src/engine/wet-session.ts')) as typeof import('../src/engine/wet-session');
    const {prepareFloatWetStroke}=await import(/* @vite-ignore */ String('/src/engine/wet-stroke.ts')) as typeof import('../src/engine/wet-stroke');
    const {editor,PencilStroke}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],file,{type:'image/tiff'}),{editingPrecision:'float32'});
    const document=JSON.stringify(editor.document.toJSON()),asset=editor.assetStore.values()[0],dimensions=[asset.width,asset.height],scope={x:0,y:0,width:64,height:48},scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore),original=await scene.read(scope);
    const input=new PencilStroke({size:8,opacity:.625,flow:.7,pressureSize:false,points:[{x:12,y:12},{x:20,y:18},{x:16,y:24}]}).toJSON(),options={tileSize:16,cacheBytes:0,load:{color:[4.5,-2.25,13.125,.375] as [number,number,number,number],load:.37},mix:{pickup:.7,wetness:.2}},read=(region:Rect)=>scene.read(region);
    let released=false;const reference=await prepareFloatWetStroke(input,read,editor.renderer.processor,options),session=await createFloatWetStrokeSession({...input,points:input.points.slice(0,1)},read,editor.renderer.processor,options,()=>{scene.dispose();released=true;});
    const prefix=await session.snapshot();await session.append(input.points.slice(1));const final=await session.finish();await session.dispose();
    const modelUnchanged=document===JSON.stringify(editor.document.toJSON()),sourceExact=new Uint8Array(await asset.blob.arrayBuffer()).every((value,i)=>value===bytes[i]);editor.newDocument({width:16,height:16});
    const collect=async(output:WetStrokeResult<Float32Array>)=>{const result=original.slice();for await(const tile of output.tiles(scope))for(let y=0;y<tile.region.height;y++)result.set(tile.pixels.subarray(y*tile.region.width*4,(y+1)*tile.region.width*4),((tile.region.y+y)*scope.width+tile.region.x)*4);return result;};
    try{const actual=await collect(final),expected=await collect(reference),prefixWords=await collect(prefix);return {file,dimensions,scope,released,modelUnchanged,sourceExact,exact:new Uint32Array(actual.buffer).every((word,i)=>word===new Uint32Array(expected.buffer)[i]),changed:new Uint32Array(actual.buffer).filter((word,i)=>word!==new Uint32Array(original.buffer)[i]).length,original:[...new Uint8Array(original.buffer)],final:[...new Uint8Array(actual.buffer)],prefix:[...new Uint8Array(prefixWords.buffer)]};}finally{await prefix.dispose();await final.dispose();await reference.dispose();scene.dispose();}
  },{file,bytes:[...await readFile('tests/fixtures/tiff-float/'+file)]});
  expect(result).toMatchObject({released:true,modelUnchanged:true,sourceExact:true,exact:true});expect(result.changed).toBeGreaterThan(0);
  expect(result.dimensions).toEqual(file==='native-50mp.tif'?[10000,5000]:[131,79]);
  const reference=await referenceWindow(file.replace('.tif','-linear.f32le.gz'),result.dimensions[0],result.scope);expect(Buffer.from(result.original).equals(reference)).toBe(true);
  for(const name of ['original','final','prefix'] as const)await writeFile(info.outputPath(name+'.f32le'),Buffer.from(result[name]));
  await writeFile(info.outputPath('float-original-retained.json'),JSON.stringify({...result,original:undefined,final:undefined,prefix:undefined,independentOriginalExact:true},null,2));
});
