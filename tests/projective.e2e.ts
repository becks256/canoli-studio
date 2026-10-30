import {test,expect} from '@playwright/test';
import type {FloatSourceWindow,FloatSourceControl} from '../src/core/float-source/types';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('real perspective pixel worker matches independent native windows and captures caller-owned data',async({page},info)=>{
  const folder='tests/fixtures/projective/',manifest=JSON.parse(await readFile(folder+'manifest.json','utf8')),source=[...new Uint8Array(gunzipSync(await readFile(folder+'source.f32le.gz')))];
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const records=[];
  for(const row of manifest.cases){
    const result=await page.evaluate(async({row,source})=>{
      const {PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts')),processor=new PixelProcessor(),pixels=new Float32Array(new Uint8Array(source).buffer),before=JSON.stringify(window.luma.editor.document.toJSON()),options={sourceWidth:row.width,sourceHeight:row.height,source:{x:0,y:0,width:row.width,height:row.height},output:{...row.output},corners:structuredClone(row.corners)};
      try{const pending=processor.floatProjective(pixels,options);pixels.fill(99);options.corners[0].x=999;options.output.width=1;const actual=await pending;return{actual:[...actual],owned:pixels.byteLength===source.length&&pixels.every(v=>v===99),unchanged:before===JSON.stringify(window.luma.editor.document.toJSON())};}finally{processor.dispose();}
    },{row,source});
    expect(result.owned&&result.unchanged).toBe(true);const expected=new Float32Array(new Uint8Array(gunzipSync(await readFile(folder+row.reference))).buffer);expect(result.actual.length).toBe(expected.length);let maximum=0;for(let i=0;i<expected.length;i++)maximum=Math.max(maximum,Math.abs(result.actual[i]-expected[i])/Math.max(1,Math.abs(expected[i])));expect(maximum).toBeLessThanOrEqual(manifest.colorErrorScale);records.push({name:row.name,maximum,samples:expected.length,owned:result.owned,unchanged:result.unchanged});
  }
  await writeFile(info.outputPath('projective-native-worker.json'),JSON.stringify(records,null,2));
});

test('genuine 50 MP original perspective windows keep native geometry, bounded reads and independently verified colors',async({page},info)=>{
  test.setTimeout(600000);const original=new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-native-50mp.tif')),corners=[{x:3.5,y:2.25},{x:63,y:.5},{x:56,y:35},{x:1.5,y:29}],output={x:0,y:0,width:65,height:37};
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async({original,corners,output})=>{
    const {FloatRasterSource}=await import(/* @vite-ignore */String('/src/core/float-source/source.ts')),{PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts')),{projectPerspectiveWindow}=await import(/* @vite-ignore */String('/src/engine/projective-projection.ts'));
    const blob=new Blob([new Uint8Array(original)],{type:'image/tiff'}),source=await FloatRasterSource.openTiff(blob,{editingPrecision:'float32'}),processor=new PixelProcessor(),before=JSON.stringify(window.luma.editor.document.toJSON()),reads:{x:number;y:number;width:number;height:number}[]=[];
    try{
      const actual=await projectPerspectiveWindow({width:source.width,height:source.height,readWindow:async(bounds:FloatSourceWindow,control?:FloatSourceControl)=>{reads.push({...bounds});return source.readWindow(bounds,control);}},processor,corners,output),hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
      return{bytes:[...new Uint8Array(actual.buffer)],sourceWidth:source.width,sourceHeight:source.height,sourceSha256:await hash(source.original),sourceIdentity:source.original===blob,reads,largestRead:Math.max(...reads.map(b=>b.width*b.height)),unchanged:before===JSON.stringify(window.luma.editor.document.toJSON())};
    }finally{source.dispose();processor.dispose();}
  },{original:[...original],corners,output});
  expect(result).toMatchObject({sourceWidth:10000,sourceHeight:5000,sourceSha256:createHash('sha256').update(original).digest('hex'),sourceIdentity:true,unchanged:true});expect(result.largestRead).toBeLessThanOrEqual(262144);expect(result.reads.length).toBeGreaterThan(1);
  const actual=info.outputPath('projective-50mp-window.f32le'),casePath=info.outputPath('projective-50mp-case.json');await writeFile(actual,new Uint8Array(result.bytes));await writeFile(casePath,JSON.stringify({corners,output}));
  const checked=spawnSync(process.env.CANOLI_PDF_PYTHON??'python3',['scripts/check-projective-source.py',actual,'--case',casePath,'--source-name','u16-native-50mp.tif'],{encoding:'utf8',timeout:180000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
  await writeFile(info.outputPath('projective-50mp.json'),JSON.stringify({...result,bytes:undefined,independent:JSON.parse(checked.stdout)},null,2));
});

test('invalid perspective worker output and disposal reject owned work without preventing a fresh native retry',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const result=await page.evaluate(async()=>{
    const {PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts')),Native=window.Worker,options={sourceWidth:1,sourceHeight:1,source:{x:0,y:0,width:1,height:1},output:{x:0,y:0,width:1,height:1},corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] as const},pixels=new Float32Array([-.5,2,.25,1]);
    let rejected='',disposed='',changed=false,processor:InstanceType<typeof PixelProcessor>|undefined;
    try{
      window.Worker=class extends Native{set onmessage(listener:((this:Worker,event:MessageEvent)=>unknown)|null){super.onmessage=event=>{if(event.data.pixels){changed=true;listener?.call(this,new MessageEvent('message',{data:{...event.data,pixels:new Float32Array(0)}}));}else listener?.call(this,event);};}get onmessage(){return super.onmessage;}};
      processor=new PixelProcessor();try{await processor.floatProjective(pixels,options);}catch(error){rejected=String(error);}processor.dispose();window.Worker=Native;
      window.Worker=class extends Native{postMessage(message:unknown,options?:Transferable[]|StructuredSerializeOptions){if(Array.isArray(options))super.postMessage(message,options);else super.postMessage(message,options);if((message as {floatProjective?:unknown})?.floatProjective)queueMicrotask(()=>processor?.dispose());}};
      processor=new PixelProcessor();try{await processor.floatProjective(pixels,options);}catch(error){disposed=String(error);}processor.dispose();window.Worker=Native;
      const fresh=new PixelProcessor();try{const actual=await fresh.floatProjective(pixels,options);return{rejected,disposed,changed,actual:[...actual],original:[...pixels]};}finally{fresh.dispose();}
    }finally{window.Worker=Native;processor?.dispose();}
  });expect(result.changed).toBe(true);expect(result.rejected).toMatch(/geometry/);expect(result.disposed).toBe('Error: Image worker closed.');expect(result.actual).toEqual([-.5,2,.25,1]);expect(result.original).toEqual(result.actual);await writeFile(info.outputPath('projective-worker-rejection.json'),JSON.stringify(result,null,2));
});
