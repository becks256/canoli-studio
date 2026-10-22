import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import type {RawDevelopOptions} from '../src/core/interchange/raw/types';
const base='tests/fixtures/raw/';
const manifest=JSON.parse(await readFile(base+'manifest.json','utf8'))as {cases:{file:string;png:string;width:number;height:number;rawWidth:number;rawHeight:number;sha256:string;rgb16Sha256:string;bytes:number;options:RawDevelopOptions}[]};

for(const fixture of manifest.cases.filter(value=>!value.file.endsWith('.gz')))test(`RAW worker develops ${fixture.file} with native settings and independent pixels`,async({page},info)=>{
  await page.goto('/');const result=await page.evaluate(async({bytes,reference,fixture})=>{
    const {editor}=window.luma,before=JSON.stringify(editor.document.toJSON()),assets=editor.assetStore.values().length;
    const {developRawFile}=await import(/* @vite-ignore */String('/src/core/interchange/raw/client.ts'))as typeof import('../src/core/interchange/raw/client');
    const source=new File([new Uint8Array(bytes)],fixture.file),preflight=await editor.inspectRaw(source,0,{signal:new AbortController().signal}),progress:{phase:string;fraction:number|null}[]=[];
    const decoded=await developRawFile(source,{allowPrecisionLoss:true,development:fixture.options},{onProgress:value=>progress.push(value)});
    const actual=await createImageBitmap(decoded.png,{colorSpaceConversion:'none'}),expected=await createImageBitmap(new Blob([new Uint8Array(reference)],{type:'image/png'}),{colorSpaceConversion:'none'}),canvas=document.createElement('canvas');canvas.width=actual.width;canvas.height=actual.height;const context=canvas.getContext('2d')!;
    context.drawImage(actual,0,0);const a=context.getImageData(0,0,actual.width,actual.height).data;context.clearRect(0,0,actual.width,actual.height);context.drawImage(expected,0,0);const b=context.getImageData(0,0,actual.width,actual.height).data;
    let maximum=0;for(let i=0;i<a.length;i++)maximum=Math.max(maximum,Math.abs(a[i]-b[i]));actual.close();expected.close();canvas.width=canvas.height=0;
    return{preflight,report:decoded.report,maximum,progress,unchanged:before===JSON.stringify(editor.document.toJSON())&&assets===editor.assetStore.values().length,original:[...new Uint8Array(await source.arrayBuffer())]};
  },{fixture,bytes:[...await readFile(base+fixture.file)],reference:[...await readFile(base+fixture.png)]});
  expect(result.maximum).toBe(0);expect(result.unchanged).toBe(true);expect(result.original).toEqual([...await readFile(base+fixture.file)]);
  expect([result.report.displayWidth,result.report.displayHeight]).toEqual([fixture.width,fixture.height]);expect([result.preflight.rawWidth,result.preflight.rawHeight]).toEqual([fixture.rawWidth,fixture.rawHeight]);expect(result.progress.some(value=>value.phase==='encoding'&&value.fraction===1)).toBe(true);
  await info.attach('raw-native-worker',{body:JSON.stringify({...result,original:undefined}),contentType:'application/json'});
});

for(const action of ['abort','callback']as const)test(`RAW native ${action} releases private work and permits retry`,async({page})=>{
  await page.goto('/');const result=await page.evaluate(async({bytes,action})=>{
    const {developRawFile}=await import(/* @vite-ignore */String('/src/core/interchange/raw/client.ts'))as typeof import('../src/core/interchange/raw/client');
    const source=new Blob([new Uint8Array(bytes)]),abort=new AbortController();let error='',entered=false;
    try{await developRawFile(source,{allowPrecisionLoss:true},{signal:abort.signal,onProgress:value=>{if(value.phase!=='developing')return;entered=true;if(action==='abort')abort.abort(new Error('Cancel native RAW'));else throw new Error('RAW progress callback failed');}});}catch(cause){error=String(cause);}
    const retry=await developRawFile(source,{allowPrecisionLoss:true});return{entered,error,retry:retry.report.canDevelop};
  },{bytes:[...await readFile(base+'bayer-rggb.dng')],action});
  expect(result.entered).toBe(true);expect(result.error).toMatch(action==='abort'?/Cancel native RAW/:/callback failed/);expect(result.retry).toBe(true);
});

test('RAW consent precedes native loading, and missing native code rejects then retries',async({page})=>{
  await page.goto('/');let requests=0;await page.route('**/canoli_raw_decoder.wasm*',route=>{const url=new URL(route.request().url());if(url.searchParams.has('url')||url.searchParams.has('import'))return route.continue();requests++;return route.fulfill({status:404,body:'Missing RAW codec'});});
  const bytes=[...await readFile(base+'bayer-rggb.dng')],run=(consent:boolean)=>page.evaluate(async({bytes,consent})=>{const {developRawFile}=await import(/* @vite-ignore */String('/src/core/interchange/raw/client.ts'))as typeof import('../src/core/interchange/raw/client');try{await developRawFile(new Blob([new Uint8Array(bytes)]),{allowPrecisionLoss:consent});return'';}catch(error){return String(error);}},{bytes,consent});
  expect(await run(false)).toMatch(/consent/);expect(requests).toBe(0);expect(await run(true)).toMatch(/RAW|wasm|fetch|abort/i);expect(requests).toBeGreaterThan(0);await page.unroute('**/canoli_raw_decoder.wasm*');expect(await run(true)).toBe('');
});

test('RAW uncalibrated color, missing camera WB and corrupt sensor data never publish an image',async({page})=>{
  await page.goto('/');for(const name of ['no-calibration.dng','no-camera-wb.dng','truncated']){
    const input=await readFile(base+(name==='truncated'?'bayer-rggb.dng':name)),result=await page.evaluate(async bytes=>{
      const {editor}=window.luma,before=JSON.stringify(editor.document.toJSON()),{developRawFile}=await import(/* @vite-ignore */String('/src/core/interchange/raw/client.ts'))as typeof import('../src/core/interchange/raw/client');let error='',published=false;
      try{await developRawFile(new Blob([new Uint8Array(bytes)]),{allowPrecisionLoss:true});published=true;}catch(cause){error=String(cause);}return{error,published,unchanged:before===JSON.stringify(editor.document.toJSON()),assets:editor.assetStore.values().length};
    },[...(name==='truncated'?input.subarray(0,input.length-3000):input)]);
    expect(result).toMatchObject({published:false,unchanged:true,assets:0});expect(result.error).toMatch(/calibration|white balance|corrupt|data|unpacking|inspection/i);
  }
});

test('RAW native 50 MP workers retain every RGB16 sample and produce exact independent working pixels',async({page},info)=>{
  test.setTimeout(300000);const fixture=manifest.cases.find(value=>value.file==='native-50mp.dng.gz')!;await page.goto('/');
  const result=await page.evaluate(async bytes=>{
    const source=await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))).blob(),{editor}=window.luma,before=JSON.stringify(editor.document.toJSON());
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join(''),original=await hash(source);
    const {developRawFile}=await import(/* @vite-ignore */String('/src/core/interchange/raw/client.ts'))as typeof import('../src/core/interchange/raw/client'),abort=new AbortController();let cancelled=false;
    try{await developRawFile(source,{allowPrecisionLoss:true},{signal:abort.signal,onProgress:value=>{if(value.phase==='developing')abort.abort(new Error('Cancel large native RAW'));}});}catch(error){cancelled=String(error).includes('Cancel large native RAW');}
    const output=await developRawFile(source,{allowPrecisionLoss:true});Object.assign(window,{rawNativeWorkingPng:output.png});
    const native=await new Promise<{report:unknown;sha256:string;maximumRowBytes:number}>((resolve,reject)=>{const worker=new Worker('/tests/fixtures/raw/linear-digest.worker.ts',{type:'module'});worker.onmessage=event=>{worker.terminate();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data);};worker.onerror=event=>{worker.terminate();reject(new Error(event.message));};worker.postMessage(source);});
    return{cancelled,report:output.report,native,original,after:await hash(source),sourceBytes:source.size,unchanged:before===JSON.stringify(editor.document.toJSON()),assets:editor.assetStore.values().length};
  },[...await readFile(base+fixture.file)]);
  expect(result).toMatchObject({cancelled:true,sourceBytes:fixture.bytes,original:fixture.sha256,after:fixture.sha256,unchanged:true,assets:0});expect([result.report.displayWidth,result.report.displayHeight]).toEqual([10000,5000]);expect(result.native.sha256).toBe(fixture.rgb16Sha256);expect(result.native.maximumRowBytes).toBeLessThanOrEqual(4_000_000);
  const pending=page.waitForEvent('download');await page.evaluate(()=>{const a=document.createElement('a');a.href=URL.createObjectURL((window as unknown as {rawNativeWorkingPng:Blob}).rawNativeWorkingPng);a.download='native-raw.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});const path=info.outputPath('native-raw.png');await(await pending).saveAs(path);
  const independent=spawnSync('python3',['-c',"from PIL import Image,ImageChops;import sys,hashlib,json;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size==(10000,5000);ext=ImageChops.difference(a,b).getextrema();assert max(x[1] for x in ext)==0,ext;print(json.dumps(dict(width=a.width,height=a.height,maximumDifference=0,rgbaSha256=hashlib.sha256(a.tobytes()).hexdigest())))",path,base+fixture.png],{encoding:'utf8',timeout:120000});expect(independent.status,independent.stderr).toBe(0);
  await info.attach('raw-native-50mp',{body:JSON.stringify({...result,independent:JSON.parse(independent.stdout)}),contentType:'application/json'});
});
