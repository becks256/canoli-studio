import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import type {FloatSourceWindow} from '../src/core/float-source/types';
const base='tests/fixtures/hdr-wet-field/';
async function inputs(){return Object.fromEntries(await Promise.all(['before','field','full-field','spatial-source'].map(async name=>[name,[...gunzipSync(await readFile(base+name+'.bin.gz'))]])));}

test('real HDR wet worker preserves all independent composition and projective field words',async({page},info)=>{
  const manifest=JSON.parse(await readFile(base+'manifest.json','utf8'));await page.goto('/');
  const rows=await page.evaluate(async({manifest,raw})=>{
    const {PixelProcessor}=await import(/* @vite-ignore */ String('/src/engine/processor.ts')) as typeof import('../src/engine/processor');
    const {projectMappedHdrWetFieldWindow,projectPerspectiveHdrWetFieldWindow}=await import(/* @vite-ignore */ String('/src/engine/projective-field.ts')) as typeof import('../src/engine/projective-field');
    const p=new PixelProcessor(),decode=(name:string)=>Uint8Array.from(raw[name]).buffer,before=new Float32Array(decode('before')),field=new Float64Array(decode('field')),source=new Float64Array(decode('spatial-source')),rows:{name:string;bytes:number[]}[]=[];
    const save=(name:string,value:Float32Array|Float64Array)=>rows.push({name,bytes:[...new Uint8Array(value.buffer,value.byteOffset,value.byteLength)]});
    try{
      for(const [name,opacity]of [['zero',0],['partial',.625],['covered',1],['full',1]] as const)save('composite-'+name,await p.floatCompositeHdrWet(before,name==='full'?new Float64Array(decode('full-field')):field,opacity));
      const read=async(region:FloatSourceWindow)=>{const value=new Float64Array(region.width*region.height*5);for(let row=0;row<region.height;row++){const at=((region.y+row-manifest.bounds.y)*manifest.bounds.width+region.x-manifest.bounds.x)*5;value.set(source.subarray(at,at+region.width*5),row*region.width*5);}return value;};
      for(let index=0;index<manifest.mappings.length;index++){
        save('spatial-'+index,await p.floatMappedHdrWet(source,{mapping:manifest.mappings[index],field:manifest.bounds,source:manifest.bounds,output:manifest.window,background:0}));
        save('streamed-'+index,await projectMappedHdrWetFieldWindow({bounds:manifest.bounds,readWindow:read},p,manifest.mappings[index],manifest.window));
      }
      const region={x:0,y:0,width:23,height:17},corners=[{x:0,y:0},{x:23,y:0},{x:23,y:17},{x:0,y:17}] as const;
      save('identity',await p.floatProjectiveHdrWet(source,{sourceWidth:23,sourceHeight:17,corners,field:region,source:region,output:region,background:0}));
      save('perspective-identity',await projectPerspectiveHdrWetFieldWindow({width:23,height:17,bounds:region,readWindow:async area=>{const value=new Float64Array(area.width*area.height*5);for(let y=0;y<area.height;y++)value.set(source.subarray(((area.y+y)*23+area.x)*5,((area.y+y)*23+area.x+area.width)*5),y*area.width*5);return value;}},p,corners,region));
      return rows;
    }finally{p.dispose();}
  },{manifest,raw:await inputs()});
  for(const row of rows){const name=row.name.startsWith('streamed-')?row.name.replace('streamed-','spatial-'):row.name.includes('identity')?'spatial-source':row.name,actual=Buffer.from(row.bytes);expect(actual.equals(gunzipSync(await readFile(base+name+'.bin.gz'))),row.name).toBe(true);await writeFile(info.outputPath(row.name+'.bin'),actual);}
  await writeFile(info.outputPath('hdr-worker.json'),JSON.stringify(rows.map(row=>({name:row.name,bytes:row.bytes.length,exact:true})),null,2));
});

test('HDR worker captures typed inputs before readiness and rejects malformed output, overflow and disposal',async({page},info)=>{
  const manifest=JSON.parse(await readFile(base+'manifest.json','utf8'));await page.goto('/');
  const result=await page.evaluate(async({raw,manifest})=>{
    const {PixelProcessor}=await import(/* @vite-ignore */ String('/src/engine/processor.ts')) as typeof import('../src/engine/processor');
    const p=new PixelProcessor(),internals=p as unknown as {ready:Promise<void>;worker:Worker},ready=internals.ready,decode=(name:string)=>Uint8Array.from(raw[name]).buffer;await ready;
    const hold=()=>{let release!:()=>void;internals.ready=new Promise<void>(resolve=>release=resolve);return release;};
    try{
      const before=new Float32Array(decode('before')),field=new Float64Array(decode('field'));let release=hold();const pending=p.floatCompositeHdrWet(before,field,.625);before.fill(0);field.fill(0);release();const composite=await pending;
      const source=new Float64Array(decode('spatial-source')),mapping=structuredClone(manifest.mappings[0]);release=hold();const sampling=p.floatMappedHdrWet(source,{mapping,field:manifest.bounds,source:manifest.bounds,output:manifest.window,background:0});source.fill(0);mapping.matrix.fill(0);release();const sampled=await sampling;
      internals.ready=ready;const worker=internals.worker,handler=worker.onmessage!,errors:string[]=[],small=new Float64Array([1,-2,4,.5,1]),region={x:0,y:0,width:1,height:1},options={mapping:{matrix:[1,0,0,0,1,0,0,0,1] as const,inputOrigin:{x:0,y:0},sourceOrigin:{x:0,y:0}},field:region,source:region,output:region,background:0};
      for(const fault of ['type','extent','subarray','nonfinite','alpha']){
        worker.onmessage=event=>{const data=event.data;if(data.pixels){if(fault==='type')data.pixels=new Float32Array(5);else if(fault==='extent')data.pixels=new Float64Array(10);else if(fault==='subarray')data.pixels=new Float64Array(10).subarray(0,5);else if(fault==='nonfinite')data.pixels[0]=Infinity;else data.pixels[3]=2;}handler.call(worker,new MessageEvent('message',{data}));};
        try{await p.floatMappedHdrWet(small,options);}catch(error){errors.push(String(error));}finally{worker.onmessage=handler;}
      }
      let overflow='';try{await p.floatCompositeHdrWet(new Float32Array([2,-4,8,.375]),new Float64Array([1e300,0,0,1,1]));}catch(error){overflow=String(error);}
      const retry=await p.floatCompositeHdrWet(new Float32Array([2,-4,8,.375]),small);release=hold();const stopped=p.floatMappedHdrWet(small,options).then(()=>'',error=>String(error));p.dispose();release();const disposed=await stopped;
      return {composite:[...new Uint8Array(composite.buffer)],sampled:[...new Uint8Array(sampled.buffer)],errors,overflow,disposed,retry:[...retry],sourceOwned:small.buffer.byteLength===40};
    }finally{internals.ready=ready;p.dispose();}
  },{raw:await inputs(),manifest});
  expect(Buffer.from(result.composite).equals(gunzipSync(await readFile(base+'composite-partial.bin.gz')))).toBe(true);expect(Buffer.from(result.sampled).equals(gunzipSync(await readFile(base+'spatial-0.bin.gz')))).toBe(true);
  expect(result.errors).toHaveLength(5);expect(result.overflow).toMatch(/float32/);expect(result.disposed).toMatch(/closed|disposed/);expect(result.retry).toEqual([2,-4,8,.5]);expect(result.sourceOwned).toBe(true);
  await writeFile(info.outputPath('hdr-worker-failures.json'),JSON.stringify({...result,composite:undefined,sampled:undefined},null,2));
});

for(const file of ['rgba-raw-le.tif','native-50mp.tif'])test('lossless prepared HDR assets replay every retained native word after file and source reopening: '+file,async({page},info)=>{
  test.setTimeout(600000);await page.goto('/');
  const result=await page.evaluate(async({file,bytes})=>{
    const {PixelProcessor}=await import(/* @vite-ignore */ String('/src/engine/processor.ts')) as typeof import('../src/engine/processor');
    const {createFloatWetStrokeSession}=await import(/* @vite-ignore */ String('/src/engine/wet-session.ts')) as typeof import('../src/engine/wet-session');
    const {encodeFloatWetTile}=await import(/* @vite-ignore */ String('/src/core/float-wet-tile.ts')) as typeof import('../src/core/float-wet-tile');
    const {captureHdrWetField}=await import(/* @vite-ignore */ String('/src/engine/hdr-wet-field.ts')) as typeof import('../src/engine/hdr-wet-field');
    const {projectMappedHdrWetFieldWindow}=await import(/* @vite-ignore */ String('/src/engine/projective-field.ts')) as typeof import('../src/engine/projective-field');
    const {editor,PencilStroke}=window.luma,p=new PixelProcessor();await editor.openTiff(new File([new Uint8Array(bytes)],file,{type:'image/tiff'}),{editingPrecision:'float32'});
    const document=JSON.stringify(editor.document.toJSON()),asset=editor.assetStore.values()[0],dimensions=[asset.width,asset.height],scope={x:0,y:0,width:64,height:48},scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore),before=await scene.read(scope);
    const input=new PencilStroke({size:8,opacity:.625,flow:.7,pressureSize:false,points:[{x:12,y:12},{x:20,y:18},{x:16,y:24}]}).toJSON(),session=await createFloatWetStrokeSession(input,region=>scene.read(region),p,{tileSize:16,cacheBytes:0,load:{color:[4.5,-2.25,13.125,.375],load:.37},mix:{pickup:.7,wetness:.2}}),prepared=await session.finish();await session.dispose();
    const expected=before.slice(),tiles:import('../src/engine/hdr-wet-field').HdrWetTile[]=[];
    try{for await(const tile of prepared.tiles(scope)){
      const pixels=new Float32Array(tile.pixels.length),coverage=new Float32Array(pixels.length);
      for(let at=0;at<tile.changed.length;at++)if(tile.changed[at]){pixels.set(tile.pixels.subarray(at*4,at*4+4),at*4);coverage[at*4+3]=1;}
      for(let y=0;y<tile.region.height;y++)expected.set(tile.pixels.subarray(y*tile.region.width*4,(y+1)*tile.region.width*4),((tile.region.y+y)*scope.width+tile.region.x)*4);
      tiles.push({region:tile.region,pixels:await encodeFloatWetTile(pixels,tile.region.width,tile.region.height),coverage:await encodeFloatWetTile(coverage,tile.region.width,tile.region.height)});
    }}finally{await prepared.dispose();}
    const sourceBytes=new Uint8Array(await asset.blob.arrayBuffer()),sourceExact=sourceBytes.length===bytes.length&&sourceBytes.every((v,i)=>v===bytes[i]),modelUnchanged=document===JSON.stringify(editor.document.toJSON());scene.dispose();editor.newDocument({width:16,height:16});
    const mapping={matrix:[1,0,0,0,1,0,0,0,1] as const,inputOrigin:{x:0,y:0},sourceOrigin:{x:0,y:0}},captured=await captureHdrWetField(tiles),field=await projectMappedHdrWetFieldWindow(captured,p,mapping,scope),actual=await p.floatCompositeHdrWet(before,field);captured.dispose();
    const assets=[];for(const tile of tiles)assets.push({region:tile.region,pixels:[...new Uint8Array(await tile.pixels.arrayBuffer())],coverage:[...new Uint8Array(await tile.coverage.arrayBuffer())]});
    const reopened=await captureHdrWetField(assets.map(tile=>({region:tile.region,pixels:new Blob([new Uint8Array(tile.pixels)],{type:'image/tiff'}),coverage:new Blob([new Uint8Array(tile.coverage)],{type:'image/tiff'})}))),after=await p.floatCompositeHdrWet(before,await projectMappedHdrWetFieldWindow(reopened,p,mapping,scope));reopened.dispose();p.dispose();
    const same=(a:Float32Array,b:Float32Array)=>new Uint32Array(a.buffer).every((word,i)=>word===new Uint32Array(b.buffer)[i]);return {file,dimensions,sourceExact,modelUnchanged,scope,exact:same(actual,expected),reopenedExact:same(after,expected),assets,before:[...new Uint8Array(before.buffer)],expected:[...new Uint8Array(expected.buffer)],actual:[...new Uint8Array(actual.buffer)],reopened:[...new Uint8Array(after.buffer)]};
  },{file,bytes:[...await readFile('tests/fixtures/tiff-float/'+file)]});
  expect(result).toMatchObject({sourceExact:true,modelUnchanged:true,exact:true,reopenedExact:true});expect(result.dimensions).toEqual(file==='native-50mp.tif'?[10000,5000]:[131,79]);expect(result.assets.length).toBeGreaterThan(0);
  for(let index=0;index<result.assets.length;index++)for(const kind of ['pixels','coverage'] as const)await writeFile(info.outputPath(`${index}-${kind}.tif`),Buffer.from(result.assets[index][kind]));
  for(const name of ['before','expected','actual','reopened'] as const)await writeFile(info.outputPath(name+'.f32le'),Buffer.from(result[name]));
  await writeFile(info.outputPath('hdr-assets-replay.json'),JSON.stringify({...result,assets:result.assets.map(({region},index)=>({region,pixels:index+'-pixels.tif',coverage:index+'-coverage.tif'})),before:undefined,expected:undefined,actual:undefined,reopened:undefined},null,2));
  const checked=spawnSync(process.env.CANOLI_REFERENCE_PYTHON??'python3',['scripts/check-hdr-wet-assets.py',info.outputDir],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);await writeFile(info.outputPath('independent-hdr-assets.json'),checked.stdout);
});
