import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import type {FloatSourceWindow,FloatSourceControl} from '../src/core/float-source/types';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('real scalar-field worker retains extended mask support, independent coverage and caller ownership',async({page},info)=>{
  const folder='tests/fixtures/projective-field/',manifest=JSON.parse(await readFile(folder+'manifest.json','utf8'));
  const source=[...new Uint8Array(gunzipSync(await readFile(folder+'source.f32le.gz')))];
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const records=[];
  for(const row of manifest.cases){
    const result=await page.evaluate(async({row,source})=>{
      const {PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts'));
      const {projectPerspectiveFieldWindow}=await import(/* @vite-ignore */String('/src/engine/projective-field.ts'));
      const processor=new PixelProcessor(),original=new Float32Array(new Uint8Array(source).buffer),alpha=original.slice(),options=structuredClone(row.options);
      const before=JSON.stringify(window.luma.editor.document.toJSON()),reads:FloatSourceWindow[]=[];
      try{
        const pending=processor.floatProjectiveField(alpha,options);alpha.fill(99);options.corners[0].x=999;options.field.width=1;options.output.width=1;options.background=0;
        const actual=await pending,b=row.options.field;
        const projected=await projectPerspectiveFieldWindow({width:row.options.sourceWidth,height:row.options.sourceHeight,bounds:b,background:row.options.background,
          readWindow:async(area:FloatSourceWindow)=>{
            reads.push({...area});const out=new Float32Array(area.width*area.height);
            for(let y=0;y<area.height;y++)out.set(original.subarray((area.y-b.y+y)*b.width+area.x-b.x,(area.y-b.y+y)*b.width+area.x-b.x+area.width),y*area.width);
            return out;
          }},processor,row.options.corners,row.options.output);
        const a=new Uint32Array(actual.buffer),p=new Uint32Array(projected.buffer);
        return{actual:[...actual],partitionExact:a.length===p.length&&a.every((v,i)=>v===p[i]),reads,
          owned:alpha.byteLength===source.length&&alpha.every(v=>v===99),unchanged:before===JSON.stringify(window.luma.editor.document.toJSON())};
      }finally{processor.dispose();}
    },{row,source});
    expect(result.partitionExact&&result.owned&&result.unchanged).toBe(true);
    expect(Math.max(...result.reads.map(b=>b.width*b.height))).toBeLessThanOrEqual(262144);
    const expected=new Float32Array(new Uint8Array(gunzipSync(await readFile(folder+row.reference))).buffer);
    expect(result.actual.length).toBe(expected.length);let maximum=0;
    for(let i=0;i<expected.length;i++)maximum=Math.max(maximum,Math.abs(result.actual[i]-expected[i]));
    expect(maximum).toBeLessThanOrEqual(manifest.absoluteError);
    records.push({...result,actual:undefined,name:row.name,samples:expected.length,maximum});
  }
  await writeFile(info.outputPath('projective-field-worker.json'),JSON.stringify(records,null,2));
});

test('scalar-field IPC rejects malformed coverage and disposal, then permits a fresh native retry',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async()=>{
    const {PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts')),Native=window.Worker;
    const alpha=new Float32Array([.25]),options={sourceWidth:1,sourceHeight:1,source:{x:0,y:0,width:1,height:1},field:{x:0,y:0,width:1,height:1},
      output:{x:0,y:0,width:1,height:1},background:1,corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] as const};
    const failures=[];let processor:InstanceType<typeof PixelProcessor>|undefined,disposed='';
    try{
      for(const mode of ['length','range','view']){
        let intercepted=false,rejected='';
        window.Worker=class extends Native{
          set onmessage(listener:((this:Worker,event:MessageEvent)=>unknown)|null){super.onmessage=event=>{
            if(event.data.pixels){
              intercepted=true;const pixels=mode==='length'?new Float32Array(0):mode==='range'?new Float32Array([2]):new Float32Array(new ArrayBuffer(8),4,1);
              listener?.call(this,new MessageEvent('message',{data:{...event.data,pixels}}));
            }else listener?.call(this,event);
          };}get onmessage(){return super.onmessage;}
        };
        processor=new PixelProcessor();try{await processor.floatProjectiveField(alpha,options);}catch(error){rejected=String(error);}finally{processor.dispose();}
        failures.push({mode,intercepted,rejected});window.Worker=Native;
      }
      window.Worker=class extends Native{
        postMessage(message:unknown,transfer?:Transferable[]|StructuredSerializeOptions){
          if(Array.isArray(transfer))super.postMessage(message,transfer);else super.postMessage(message,transfer);
          if((message as {floatProjectiveField?:unknown})?.floatProjectiveField)queueMicrotask(()=>processor?.dispose());
        }
      };
      processor=new PixelProcessor();try{await processor.floatProjectiveField(alpha,options);}catch(error){disposed=String(error);}finally{processor.dispose();window.Worker=Native;}
      const fresh=new PixelProcessor();try{return{failures,disposed,actual:[...await fresh.floatProjectiveField(alpha,options)],original:[...alpha]};}finally{fresh.dispose();}
    }finally{processor?.dispose();window.Worker=Native;}
  });
  for(const row of result.failures){expect(row.intercepted).toBe(true);expect(row.rejected).toMatch(/coverage|geometry|expected length/);}
  expect(result.disposed).toBe('Error: Image worker closed.');expect(result.actual).toEqual([.25]);expect(result.original).toEqual([.25]);
  await writeFile(info.outputPath('projective-field-rejections.json'),JSON.stringify(result,null,2));
});

test('genuine 50 MP original alpha projects through the scalar-field worker with bounded reads and independent coverage',async({page},info)=>{
  test.setTimeout(600000);
  const original=new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-native-50mp.tif'));
  const corners=[{x:3.5,y:2.25},{x:63,y:.5},{x:56,y:35},{x:1.5,y:29}],output={x:0,y:0,width:65,height:37};
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async({original,corners,output})=>{
    const {FloatRasterSource}=await import(/* @vite-ignore */String('/src/core/float-source/source.ts'));
    const {PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts'));
    const {projectPerspectiveFieldWindow}=await import(/* @vite-ignore */String('/src/engine/projective-field.ts'));
    const blob=new Blob([new Uint8Array(original)],{type:'image/tiff'}),source=await FloatRasterSource.openTiff(blob,{editingPrecision:'float32'}),processor=new PixelProcessor();
    const before=JSON.stringify(window.luma.editor.document.toJSON()),reads:FloatSourceWindow[]=[];
    try{
      const actual=await projectPerspectiveFieldWindow({width:source.width,height:source.height,bounds:{x:0,y:0,width:source.width,height:source.height},background:0,
        readWindow:async(bounds:FloatSourceWindow,control?:FloatSourceControl)=>{
          reads.push({...bounds});const pixels=await source.readWindow(bounds,control),alpha=new Float32Array(bounds.width*bounds.height);
          for(let i=0;i<alpha.length;i++)alpha[i]=pixels[i*4+3];return alpha;
        }},processor,corners,output);
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await source.original.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
      return{bytes:[...new Uint8Array(actual.buffer)],sourceWidth:source.width,sourceHeight:source.height,sourceSha256:hash,sourceIdentity:source.original===blob,
        reads,largestRead:Math.max(...reads.map(b=>b.width*b.height)),unchanged:before===JSON.stringify(window.luma.editor.document.toJSON())};
    }finally{source.dispose();processor.dispose();}
  },{original:[...original],corners,output});
  expect(result).toMatchObject({sourceWidth:10000,sourceHeight:5000,sourceSha256:createHash('sha256').update(original).digest('hex'),sourceIdentity:true,unchanged:true});
  expect(result.largestRead).toBeLessThanOrEqual(262144);expect(result.reads.length).toBeGreaterThan(1);
  const actual=info.outputPath('projective-field-50mp.f32le'),casePath=info.outputPath('projective-field-50mp-case.json');
  await writeFile(actual,new Uint8Array(result.bytes));await writeFile(casePath,JSON.stringify({corners,output}));
  const checked=spawnSync(process.env.CANOLI_PDF_PYTHON??'python3',['scripts/check-projective-field-source.py',actual,'--case',casePath,'--source-name','u16-native-50mp.tif'],{encoding:'utf8',timeout:180000});
  expect(checked.status,checked.stderr||checked.stdout).toBe(0);
  await writeFile(info.outputPath('projective-field-50mp.json'),JSON.stringify({...result,bytes:undefined,independent:JSON.parse(checked.stdout)},null,2));
});
