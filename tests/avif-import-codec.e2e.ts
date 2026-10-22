import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const base='tests/fixtures/avif-import/';
const manifest=JSON.parse(await readFile(base+'manifest.json','utf8')) as {cases:{file:string;reference:string;width:number;height:number;depth:number;assumeSrgb:boolean;nativeResolved?:string}[];rejections:{file:string;reason:string}[]};
for(const fixture of manifest.cases)test(`AVIF input worker ${fixture.file} returns oriented native PNG without mutating artwork`,async({page},info)=>{
  await page.goto('/');const bytes=[...await readFile(base+fixture.file)],reference=[...await readFile(base+fixture.reference)];
  const result=await page.evaluate(async({bytes,reference,fixture})=>{
    const {editor}=window.luma,before=JSON.stringify(editor.document.toJSON()),assets=editor.assetStore.values().length;
    const {decodeAvifFile}=await import(/* @vite-ignore */String('/src/core/interchange/avif/client.ts'));
    const file=new File([new Uint8Array(bytes)],fixture.file,{type:'image/avif'}),progress:{phase:string;fraction:number|null}[]=[];
    const report=await editor.inspectAvif(file),decoded=await decodeAvifFile(file,{allowPrecisionLoss:fixture.depth>8,assumeSrgb:fixture.assumeSrgb},{onProgress:(value:{phase:'inspecting'|'decoding';fraction:number|null})=>progress.push(value)});
    const bitmap=await createImageBitmap(decoded.png,{colorSpaceConversion:'none'}),expected=await createImageBitmap(new Blob([new Uint8Array(reference)],{type:'image/png'}),{colorSpaceConversion:'none'});
    const canvas=document.createElement('canvas');let alpha=0,premult=0;
    // Native geometry is independent of browser canvas allocation/axis limits.
    for(let y=0;y<bitmap.height;y+=64)for(let x=0;x<bitmap.width;x+=1024){
      const w=Math.min(1024,bitmap.width-x),h=Math.min(64,bitmap.height-y);canvas.width=w;canvas.height=h;const context=canvas.getContext('2d')!;
      context.drawImage(bitmap,x,y,w,h,0,0,w,h);const a=context.getImageData(0,0,w,h).data;context.clearRect(0,0,w,h);context.drawImage(expected,x,y,w,h,0,0,w,h);const b=context.getImageData(0,0,w,h).data;
      for(let i=0;i<a.length;i+=4){alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(a[i+c]*a[i+3]-b[i+c]*b[i+3])/255);}
    }
    const width=bitmap.width,height=bitmap.height;bitmap.close();expected.close();canvas.width=canvas.height=0;
    return{report,decodedReport:decoded.report,width,height,alpha,premult,progress,sameDocument:before===JSON.stringify(editor.document.toJSON()),sameAssets:assets===editor.assetStore.values().length,original:[...new Uint8Array(await file.arrayBuffer())]};
  },{bytes,reference,fixture});
  if(fixture.nativeResolved){expect(result.report.color.kind).toBe('unspecified');expect(result.decodedReport.color.kind).toBe(fixture.nativeResolved);expect(result.decodedReport.requiresColorAssumption).toBe(false);}else expect(result.report).toEqual(result.decodedReport);
  expect([result.width,result.height]).toEqual([fixture.width,fixture.height]);expect(result.alpha).toBe(0);expect(result.premult).toBeLessThanOrEqual(fixture.file==='premultiplied.avif'?3:2);expect(result.progress.some(value=>value.phase==='decoding'&&value.fraction===1)).toBe(true);expect(result.sameDocument).toBe(true);expect(result.sameAssets).toBe(true);expect(result.original).toEqual(bytes);
  await info.attach('avif-input-worker',{body:JSON.stringify({...result,original:undefined}),contentType:'application/json'});
});
for(const fixture of manifest.rejections)test(`AVIF ${fixture.file} native HDR cannot be relabeled by sRGB assumption`,async({page})=>{
  await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma,before=JSON.stringify(editor.document.toJSON()),assetsBefore=editor.assetStore.values().length,{decodeAvifFile}=await import(/* @vite-ignore */String('/src/core/interchange/avif/client.ts')),file=new File([new Uint8Array(bytes)],'missing-colr-hdr.avif',{type:'image/avif'}),report=await editor.inspectAvif(file);let error='',published=false;
    try{await decodeAvifFile(file,{assumeSrgb:true,allowPrecisionLoss:true});published=true;}catch(cause){error=String(cause);}
    return{report,error,published,unchanged:before===JSON.stringify(editor.document.toJSON()),assetsUnchanged:assetsBefore===editor.assetStore.values().length};
  },[...await readFile(base+fixture.file)]);
  expect(result.report.color.kind).toBe('unspecified');expect(result.published).toBe(false);expect(result.error).toMatch(/HDR/);expect(result.unchanged).toBe(true);expect(result.assetsUnchanged).toBe(true);
});

for(const action of ['abort','callback'] as const)test(`AVIF input ${action} terminates private native work and permits retry`,async({page},info)=>{
  await page.goto('/');const bytes=[...await readFile(base+'grid.avif')];
  const result=await page.evaluate(async({bytes,action})=>{
    const {decodeAvifFile}=await import(/* @vite-ignore */String('/src/core/interchange/avif/client.ts')),source=new Blob([new Uint8Array(bytes)],{type:'image/avif'}),abort=new AbortController();
    let error='',completed=false;try{await decodeAvifFile(source,{}, {signal:abort.signal,onProgress:(progress:{phase:string;fraction:number|null})=>{if(progress.phase==='decoding'){if(action==='abort')abort.abort(new Error('Cancelled AVIF input'));else throw new Error('AVIF input callback failed');}}});completed=true;}catch(cause){error=String(cause);}
    const retry=await decodeAvifFile(source);return{error,completed,retry:retry.report.canDecode};
  },{bytes,action});
  expect(result.completed).toBe(false);expect(result.error).toMatch(action==='abort'?/Cancelled AVIF input/:/callback failed/);expect(result.retry).toBe(true);await info.attach('avif-input-retry',{body:JSON.stringify(result),contentType:'application/json'});
});

test('AVIF preflight does not fetch the codec, and missing codec decoding rejects then retries',async({page})=>{
  await page.goto('/');const bytes=[...await readFile(base+'orientation-1.avif')];let codecRequests=0;
  await page.route('**/canoli_avif_decoder.wasm*',route=>{
    // Vite also serves a JS URL module at .wasm?import&url. Preflight imports
    // that module without loading/initializing the binary codec.
    const url=new URL(route.request().url());if(url.searchParams.has('url')||url.searchParams.has('import'))return route.continue();
    codecRequests++;return route.fulfill({status:404,body:'Missing AVIF input codec'});
  });
  const report=await page.evaluate(async bytes=>window.luma.editor.inspectAvif(new File([new Uint8Array(bytes)],'preflight.avif',{type:'image/avif'})),bytes);expect(report.canDecode).toBe(true);expect(codecRequests).toBe(0);
  const run=()=>page.evaluate(async bytes=>{const {decodeAvifFile}=await import(/* @vite-ignore */String('/src/core/interchange/avif/client.ts'));try{await decodeAvifFile(new Blob([new Uint8Array(bytes)],{type:'image/avif'}));return '';}catch(error){return String(error);}},bytes);
  expect(await run()).toMatch(/AVIF|wasm|fetch|abort/i);expect(codecRequests).toBeGreaterThan(0);await page.unroute('**/canoli_avif_decoder.wasm*');expect(await run()).toBe('');
});

test('AVIF precision and unidentified-color consent reject before loading the native codec',async({page})=>{
  await page.goto('/');let binaryRequests=0;
  await page.route('**/canoli_avif_decoder.wasm*',route=>{const url=new URL(route.request().url());if(url.searchParams.has('url')||url.searchParams.has('import'))return route.continue();binaryRequests++;return route.fulfill({status:404,body:'Consent must precede codec loading'});});
  for(const file of ['rgb-10.avif','rgb-12.avif','unspecified.avif']){
    const error=await page.evaluate(async bytes=>{const {decodeAvifFile}=await import(/* @vite-ignore */String('/src/core/interchange/avif/client.ts'));try{await decodeAvifFile(new Blob([new Uint8Array(bytes)],{type:'image/avif'}));return '';}catch(cause){return String(cause);}},[...await readFile(base+file)]);
    expect(error).toMatch(file==='unspecified.avif'?/sRGB assumption/:/precision-loss consent/);
  }
  expect(binaryRequests).toBe(0);
});

test('AVIF native 50 MP worker cancels, retries and decodes every sample against independent reference',async({page},info)=>{
  test.setTimeout(300000);const path=base+'native-50mp.avif';
  await page.goto('/');const input=await readFile(path),sourceHash=await page.evaluate(async bytes=>{
    const {decodeAvifFile}=await import(/* @vite-ignore */String('/src/core/interchange/avif/client.ts'));
    const source=new Blob([new Uint8Array(bytes)],{type:'image/avif'}),abort=new AbortController();let cancelled=false;
    try{await decodeAvifFile(source,{}, {signal:abort.signal,onProgress:(progress:{phase:string;fraction:number|null})=>{if(progress.phase==='decoding')abort.abort(new Error('Cancel native AVIF input'));}});}catch(error){cancelled=String(error).includes('Cancel native AVIF input');}
    if(!cancelled)throw new Error('Native AVIF cancellation did not reject.');
    const before=performance.now(),decoded=await decodeAvifFile(source);
    const output=(window as unknown as {avifImportOutput?:Blob});output.avifImportOutput=decoded.png;
    return{report:decoded.report,cancelled,milliseconds:performance.now()-before,originalHash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await source.arrayBuffer()))]};
  },[...input]);
  expect([sourceHash.report.width,sourceHash.report.height]).toEqual([10000,5000]);expect(Buffer.from(sourceHash.originalHash).toString('hex')).toBe(createHash('sha256').update(input).digest('hex'));
  const output=await page.evaluate(async()=>[...new Uint8Array(await(window as unknown as {avifImportOutput:Blob}).avifImportOutput.arrayBuffer())]),out=info.outputPath('decoded-50mp.png');await writeFile(out,new Uint8Array(output));
  const independent=spawnSync('python3',['-c',"from PIL import Image,ImageChops;import sys,hashlib,json;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size==(10000,5000);ext=ImageChops.difference(a,b).getextrema();assert max(v[1] for v in ext)==0,ext;print(json.dumps(dict(width=a.width,height=a.height,rgbaSha256=hashlib.sha256(a.tobytes()).hexdigest(),maximumDifference=0)))",out,base+'native-50mp.png'],{encoding:'utf8'});
  expect(independent.status,independent.stderr).toBe(0);await info.attach('avif-input-50mp',{body:JSON.stringify({...sourceHash,independent:JSON.parse(independent.stdout)}),contentType:'application/json'});
});
