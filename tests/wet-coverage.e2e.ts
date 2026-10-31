import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import type {BrushStrokeData,Rect} from '../src/core/drawing';
import type {WetStrokeResult} from '../src/engine/wet-state';

test('reused wet footprints retain exact native grid bytes through soft, hard, pencil and reflected boundary changes',async({page},info)=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const{createWetDabCoverage,wetDabCoverage}=await import(/* @vite-ignore */String('/src/engine/wet-coverage.ts'));
  const{BrushStroke,PencilStroke,AffineTransform}=window.luma;
  const sampler=createWetDabCoverage(),create=document.createElement.bind(document),surfaces:HTMLCanvasElement[]=[],rows:{kind:string;hardness:number;origin:number;basis:number;hash:string}[]=[];
  document.createElement=function(...args:Parameters<typeof document.createElement>){const node=create(...args);if(args[0]==='canvas')surfaces.push(node as HTMLCanvasElement);return node;}as typeof document.createElement;
  let cells=0,nonzero=0,retained:Uint8Array|undefined,retainedCopy:Uint8Array|undefined;
  try{
   for(const origin of[-257.25,-.25,127.5,255.25,2**24+.25])for(const hardness of[0,.37,1])for(const pencil of[false,true])for(let basis=0;basis<3;basis++){
    const stroke=(pencil?new PencilStroke({size:12,points:[{x:0,y:0}]}):new BrushStroke({size:12,hardness,points:[{x:0,y:0}]})).toJSON()as BrushStrokeData;
    const frames=[new AffineTransform(9,0,0,9,origin,origin),new AffineTransform(-9,3,2,5,origin+.25,origin-.125),new AffineTransform(4,7,-6,3,origin-.375,origin+.25)],frame=frames[basis],region={x:Math.floor(origin)-20,y:Math.floor(origin)-20,width:40,height:40};
    const expected=await wetDabCoverage(stroke,frame,region,()=>{}),actual=await sampler.sample(stroke,frame,region,()=>{});
    if(!retained){retained=actual;retainedCopy=actual.slice();}
    if(expected.length!==actual.length||!expected.every((v:number,i:number)=>v===actual[i]))throw Error('Reused footprint differs from the complete fresh native cell');
    if(!actual.some((v:number)=>v>0))throw Error('Empty coverage witness');nonzero++;
    cells+=(Math.floor((region.x+region.width-1)/256)-Math.floor(region.x/256)+1)*(Math.floor((region.y+region.height-1)/256)-Math.floor(region.y/256)+1);
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',actual))].map(v=>v.toString(16).padStart(2,'0')).join('');rows.push({kind:stroke.kind,hardness,origin,basis,hash});
   }
   const live=surfaces.filter(v=>v.width===260&&v.height===260).length,total=surfaces.filter(v=>v.width===0&&v.height===0).length+live;
   sampler.dispose();let rejected=false;try{await sampler.sample(new PencilStroke({points:[{x:0,y:0}]}).toJSON(),new AffineTransform(),{x:0,y:0,width:1,height:1},()=>{});}catch{rejected=true;}
   return{rows,nonzero,cells,total,live,rejected,retainedExact:retained!.every((v,i)=>v===retainedCopy![i]),allReleased:surfaces.every(v=>v.width===0&&v.height===0)};
  }finally{sampler.dispose();document.createElement=create as typeof document.createElement;}
 });
 expect(result.rows).toHaveLength(90);expect(result.nonzero).toBe(90);expect(result.total).toBe(result.cells+1);expect(result.live).toBe(1);expect(result.rejected).toBe(true);expect(result.retainedExact).toBe(true);expect(result.allReleased).toBe(true);
 await writeFile(info.outputPath('native-coverage.json'),JSON.stringify(result,null,2));
});

test('actual native wet sessions preserve all textured pressure symmetry pixels across cached and zero-cache partitions',async({page},info)=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const{prepareWetStroke}=await import(/* @vite-ignore */String('/src/engine/wet-stroke.ts'));
  const{wetDabCoverage}=await import(/* @vite-ignore */String('/src/engine/wet-coverage.ts'));
  const{PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts'));
  const{AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'));
  const{BrushStroke,BrushSymmetry,AffineTransform}=window.luma,processor=new PixelProcessor(),assets=new AssetStore(),texture=new OffscreenCanvas(8,8),ctx=texture.getContext('2d')!;
  const data=ctx.createImageData(8,8);for(let i=0;i<data.data.length;i+=4)data.data.set([(i*13)&255,(i*7)&255,(i*3)&255,(i*17)&255],i);ctx.putImageData(data,0,0);const blob=await texture.convertToBlob();await assets.add(blob,'Coverage texture','texture',false);
  const source=async(r:Rect)=>{const p=new Uint8ClampedArray(r.width*r.height*4);for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++)p.set([((x+r.x)*73+(y+r.y)*19)&255,((y+r.y)*47)&255,((x+r.x)*31)&255,((x+r.x+y+r.y)*59)&255],(y*r.width+x)*4);return p;};
  const read=async(result:WetStrokeResult)=>{const rows:number[][]=[];for await(const tile of result.tiles())for(let y=0;y<tile.region.height;y++)for(let x=0;x<tile.region.width;x++){const i=y*tile.region.width+x;if(tile.changed[i])rows.push([tile.region.x+x,tile.region.y+y,...tile.pixels.subarray(i*4,i*4+4)]);}rows.sort((a,b)=>a[1]-b[1]||a[0]-b[0]);return rows;};
  const rows:{tileSize:number;cacheBytes:number;reflected:boolean;changed:number;hash:string}[]=[];
  try{
   for(const tileSize of[8,128])for(const cacheBytes of[0,1024*1024])for(const reflected of[false,true]){
    const stroke={...new BrushStroke({size:7,hardness:.37,spacing:.3,opacity:.63,flow:.57,pressureSize:true,pressureOpacity:true,tip:{roundness:.6,angle:37,tiltAngle:true},symmetry:BrushSymmetry.mirrorVertical(5),texture:{assetId:'texture',channel:'luminance',invert:reflected},points:[{x:-3.5,y:-1.5,pressure:.4,tilt:{altitude:.4,azimuth:.2}},{x:7.5,y:5.5,pressure:1,tilt:{altitude:.8,azimuth:1}},{x:4.5,y:9.5,pressure:.3,tilt:{altitude:.5,azimuth:2}}]}).toJSON(),clip:{regions:[{shape:'rectangle',operation:'add',x:-16,y:-16,width:64,height:48}]}}as BrushStrokeData;
    const options={assets,tileSize,cacheBytes,transform:new AffineTransform(reflected?-1.1:1.1,.2,.1,.9,-.5,1.5),mix:{pickup:.43,wetness:.17},load:{color:[255,10,60,191]as[number,number,number,number],load:.23}};
    const a=await prepareWetStroke(stroke,source,processor,options),b=await prepareWetStroke(stroke,source,processor,{...options,coverage:(...args:Parameters<typeof wetDabCoverage>)=>wetDabCoverage(...args)});
    try{const actual=await read(a),expected=await read(b);if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Reused native session changed complete output');if(!actual.length)throw Error('Empty native output witness');const bytes=new TextEncoder().encode(JSON.stringify(actual)),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');rows.push({tileSize,cacheBytes,reflected,changed:actual.length,hash});}finally{await a.dispose();await b.dispose();}
   }
   const original=new Uint8Array(await blob.arrayBuffer()),retained=new Uint8Array(await assets.get('texture').blob.arrayBuffer());return{rows,sourceExact:original.length===retained.length&&original.every((v,i)=>v===retained[i])};
  }finally{processor.dispose();assets.dispose();}
 });
 expect(result.rows).toHaveLength(8);expect(result.sourceExact).toBe(true);expect(result.rows.every(v=>v.changed>0)).toBe(true);
 for(const reflected of[false,true])expect(new Set(result.rows.filter(v=>v.reflected===reflected).map(v=>v.hash)).size).toBe(1);
 await writeFile(info.outputPath('native-session-coverage.json'),JSON.stringify(result,null,2));
});

test('coverage disposal preserves borrowed surfaces until held texture work retires and rejects late output',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const{createWetDabCoverage}=await import(/* @vite-ignore */String('/src/engine/wet-coverage.ts'));
  const{AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'));
  const{BrushStroke,AffineTransform}=window.luma,assets=new AssetStore(),source=new OffscreenCanvas(2,2);source.getContext('2d')!.fillRect(0,0,2,2);await assets.add(await source.convertToBlob(),'Held source','held',false);
  const sampler=createWetDabCoverage(),create=document.createElement.bind(document),surfaces:HTMLCanvasElement[]=[],gates:(()=>void)[]=[];
  document.createElement=function(...args:Parameters<typeof document.createElement>){const node=create(...args);if(args[0]==='canvas')surfaces.push(node as HTMLCanvasElement);return node;}as typeof document.createElement;
  try{
   const stroke=new BrushStroke({points:[{x:0,y:0}],texture:{assetId:'held',channel:'alpha',invert:false}}).toJSON(),frame=new AffineTransform(8,0,0,8,8,8),region={x:0,y:0,width:16,height:16};
   const textures={prepareAffine:()=>new Promise<HTMLCanvasElement>(resolve=>gates.push(()=>{const c=document.createElement('canvas');c.width=c.height=260;c.getContext('2d')!.fillRect(0,0,260,260);resolve(c);} ))};
   const a=sampler.sample(stroke,frame,region,()=>{},assets,textures).then(()=>false,(e:Error)=>e.message.includes('disposed')),b=sampler.sample(stroke,frame,region,()=>{},assets,textures).then(()=>false,(e:Error)=>e.message.includes('disposed'));
   const borrowed=surfaces.length;sampler.dispose();const alive=surfaces.every(v=>v.width===260&&v.height===260);gates.forEach(release=>release());const rejected=await Promise.all([a,b]);
   return{borrowed,alive,rejected,allReleased:surfaces.every(v=>v.width===0&&v.height===0)};
  }finally{sampler.dispose();document.createElement=create as typeof document.createElement;assets.dispose();}
 });
 expect(result).toEqual({borrowed:2,alive:true,rejected:[true,true],allReleased:true});
});

test('default native sessions release their footprint on finish, abort, failure and disposal while earlier snapshots remain readable',async({page},info)=>{
 await page.goto('/');
 const rows=await page.evaluate(async()=>{
  const{createWetStrokeSession}=await import(/* @vite-ignore */String('/src/engine/wet-session.ts'));
  const{PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts'));
  const{PencilStroke}=window.luma,rows:{mode:string;created:number;liveBefore:number;released:boolean;snapshotExact:boolean;rejected:boolean;error:string;autoReleased:boolean|null}[]=[];
  for(const mode of['finish','abort','processor','dispose']){
   const processor=new PixelProcessor(),abort=new AbortController(),create=document.createElement.bind(document),surfaces:HTMLCanvasElement[]=[];
   document.createElement=function(...args:Parameters<typeof document.createElement>){const node=create(...args);if(args[0]==='canvas')surfaces.push(node as HTMLCanvasElement);return node;}as typeof document.createElement;
   let session,snapshot,finished;
   try{
    session=await createWetStrokeSession(new PencilStroke({size:6,pressureSize:false,points:[{x:12,y:12}]}).toJSON(),async(r:Rect)=>new Uint8ClampedArray(r.width*r.height*4),processor,{signal:abort.signal,load:{load:1,color:[0,255,0,255]},mix:{pickup:0}});
    snapshot=await session.snapshot();const first=(await snapshot.tiles().next()).value;if(!first)throw Error('Missing complete snapshot witness');const expected=first.pixels.slice(),liveBefore=surfaces.filter(v=>v.width===260&&v.height===260).length;let rejected=false,error='';
    if(mode==='finish'){await session.append([{x:28,y:12,pressure:1}]);finished=await session.finish();}
    else if(mode==='abort'){abort.abort(new Error('Cancelled native footprint'));try{await session.append([{x:28,y:12,pressure:1}]);}catch(e){rejected=true;error=String(e);}}
    else if(mode==='processor'){processor.mixWetPaint=async()=>{throw Error('Injected native mix failure');};try{await session.append([{x:28,y:12,pressure:1}]);}catch(e){rejected=true;error=String(e);}}
    const autoReleased=mode==='finish'||mode==='processor'?surfaces.every(v=>v.width===0&&v.height===0):null;
    await session.dispose();const again=(await snapshot.tiles().next()).value;if(!again)throw Error('Snapshot was lost during session cleanup');
    rows.push({mode,created:surfaces.length,liveBefore,released:surfaces.every(v=>v.width===0&&v.height===0),snapshotExact:expected.length===again.pixels.length&&expected.every((v:number,i:number)=>v===again.pixels[i]),rejected,error,autoReleased});
   }finally{await session?.dispose();await snapshot?.dispose();await finished?.dispose();processor.dispose();document.createElement=create as typeof document.createElement;}
  }
  return rows;
 });
 expect(rows).toHaveLength(4);for(const row of rows){expect(row.created).toBe(1);expect(row.liveBefore).toBe(1);expect(row.released).toBe(true);expect(row.snapshotExact).toBe(true);expect(row.rejected).toBe(row.mode==='abort'||row.mode==='processor');if(row.mode==='processor'){expect(row.error).toContain('Injected native mix failure');expect(row.autoReleased).toBe(true);}if(row.mode==='finish')expect(row.autoReleased).toBe(true);if(row.mode==='abort')expect(row.error).toContain('Cancelled native footprint');}
 await writeFile(info.outputPath('native-session-footprint-lifecycle.json'),JSON.stringify(rows,null,2));
});
