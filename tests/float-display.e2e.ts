import{test,expect,type Page}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{gunzipSync}from'node:zlib';
import type{IccSession as Session}from'../src/core/color/icc-client';
import type{borrowFloatDisplay as BorrowDisplay}from'../src/engine/float-display';
type DisplayLease=Awaited<ReturnType<typeof BorrowDisplay>>;

async function trackNativeOwners(page:Page){
 await page.addInitScript(()=>{
  const Native=window.Worker,state={live:0,maximum:0,records:[]as{url:string;started:boolean;terminated:boolean}[]};(window as any).nativeDisplayWorkers=state;
  window.Worker=class extends Native{
   private record:{url:string;started:boolean;terminated:boolean};private counted=false;
   constructor(url:URL|string,options?:WorkerOptions){super(url,options);this.record={url:String(url),started:false,terminated:false};state.records.push(this.record);if(this.record.url.includes('/color/icc.worker.ts'))this.startNative();}
   private startNative(){if(this.counted)return;this.counted=true;this.record.started=true;state.live++;state.maximum=Math.max(state.maximum,state.live);}
   postMessage(value:any,options?:any){if(value?.kind==='continue'&&this.record.url.includes('/float-source/prepare.worker.ts'))this.startNative();super.postMessage(value,options);}
   terminate(){if(this.counted){this.counted=false;state.live--;}this.record.terminated=true;super.terminate();}
  };
 });
}
const directory='tests/fixtures/float-display/';

test('retained native display matches independent complete words across leases and request partitions',async({page},info)=>{
 const manifest=JSON.parse(await readFile(directory+'manifest.json','utf8')),source=await readFile(directory+'native-input.f32le'),expected=await readFile(directory+'native-display.rgba8');
 for(const[name,bytes]of[['native-input.f32le',source],['native-display.rgba8',expected]]as const)expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.files[name].sha256);
 await trackNativeOwners(page);await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async({bytes,expected})=>{
  const{borrowFloatDisplay,retireFloatDisplay}=await import(/* @vite-ignore */String('/src/engine/float-display.ts')),input=new Float32Array(new Uint8Array(bytes).buffer),copy=new Uint8Array(input.buffer).slice(),a=Symbol(),b=Symbol(),abort=new AbortController(),oldPhases:string[]=[],newPhases:string[]=[],first=await borrowFloatDisplay(a,{signal:abort.signal,onProgress:(phase:string)=>oldPhases.push(phase)});let second:Awaited<ReturnType<typeof borrowFloatDisplay>>|undefined;
  try{
   const full=await first.applyWindow(input);first.release();const oldCount=oldPhases.length;second=await borrowFloatDisplay(b,{onProgress:(phase:string)=>newPhases.push(phase)});abort.abort();const part=await second.applyWindow(input.subarray(37*4,550*4));second.release();
   const workers=(window as any).nativeDisplayWorkers,liveBefore=workers.live;retireFloatDisplay(a);const foreignRetirementPreserved=workers.live===liveBefore;retireFloatDisplay(b);
   return{fullExact:full.length===expected.length&&full.every((v:number,i:number)=>v===expected[i]),partExact:part.length===513*4&&part.every((v:number,i:number)=>v===expected[37*4+i]),inputExact:copy.every((v,i)=>v===new Uint8Array(input.buffer)[i]),oldCallbacksDetached:oldPhases.length===oldCount,newPhases,foreignRetirementPreserved,workers};
  }finally{first.release();second?.release();retireFloatDisplay(a);retireFloatDisplay(b);}
 },{bytes:[...source],expected:[...expected]});
 expect(result).toMatchObject({fullExact:true,partExact:true,inputExact:true,oldCallbacksDetached:true,foreignRetirementPreserved:true});expect(result.newPhases).toEqual(['processing']);expect(result.workers.maximum).toBe(1);expect(result.workers.live).toBe(0);expect(result.workers.records.filter((r:{started:boolean})=>r.started)).toHaveLength(1);await writeFile(info.outputPath('native-display-reference.json'),JSON.stringify({manifest,result},null,2));
});

test('idle native display yields to real original-source preparation without blocking held ICC work',async({page},info)=>{
 const original=await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif'),manifest=JSON.parse(await readFile('tests/fixtures/float-source/manifest.json','utf8')),row=manifest.cases.find((r:any)=>r.file==='rgba-raw-le.tif'),reference=gunzipSync(await readFile('tests/fixtures/float-source/'+row.reference)),expected=createHash('sha256').update(reference).digest('hex');
 await trackNativeOwners(page);await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async bytes=>{
  const{borrowFloatDisplay,retireFloatDisplay}=await import(/* @vite-ignore */String('/src/engine/float-display.ts')),{IccSession}=await import(/* @vite-ignore */String('/src/core/color/icc-client.ts')),{iccTarget}=await import(/* @vite-ignore */String('/src/core/color/profile-source.ts')),{FloatRasterSource}=await import(/* @vite-ignore */String('/src/core/float-source/source.ts')),a=Symbol(),b=Symbol(),display=await borrowFloatDisplay(a);let legacy:Session|undefined,source:InstanceType<typeof FloatRasterSource>|undefined,next:Awaited<ReturnType<typeof borrowFloatDisplay>>|undefined;
  try{
   await display.applyWindow(new Float32Array([.2,.3,.4,1]));display.release();const held:Session=(await IccSession.prepare(iccTarget('srgb').source,{mode:'convert'})).session;legacy=held;
   source=await FloatRasterSource.openTiff(new Blob([new Uint8Array(bytes)],{type:'image/tiff'}));await source.prepare();const pixels=await source.readWindow({x:0,y:0,width:131,height:79}),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels.buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');source.dispose();source=undefined;
   const tracker=(window as any).nativeDisplayWorkers,displayRetired=tracker.records.find((r:{url:string})=>r.url.includes('/color/icc.worker.ts'))?.terminated,legacyAlive=tracker.live===1;
   held.dispose();legacy=undefined;next=await borrowFloatDisplay(b);const output=await next.applyWindow(new Float32Array([.2,.3,.4,1]));next.release();retireFloatDisplay(b);return{hash,displayRetired,legacyAlive,retryLength:output.length,workers:tracker};
  }finally{display.release();next?.release();source?.dispose();legacy?.dispose();retireFloatDisplay(a);retireFloatDisplay(b);}
 },[...original]);
 expect(result).toMatchObject({hash:expected,displayRetired:true,legacyAlive:true,retryLength:4});expect(result.workers.maximum).toBe(2);expect(result.workers.live).toBe(0);await writeFile(info.outputPath('native-display-source-queue.json'),JSON.stringify(result,null,2));
});

test('real display cancellation retires active and queued leases and recovers native ownership',async({page},info)=>{
 await trackNativeOwners(page);await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async()=>{
  const{borrowFloatDisplay,retireFloatDisplay}=await import(/* @vite-ignore */String('/src/engine/float-display.ts')),a=Symbol(),b=Symbol(),c=Symbol(),active=new AbortController(),queued=new AbortController(),first=await borrowFloatDisplay(a,{signal:active.signal}),second=await borrowFloatDisplay(b);let next:Awaited<ReturnType<typeof borrowFloatDisplay>>|undefined;
  try{
   const waiting=borrowFloatDisplay(c,{signal:queued.signal}).then((value:DisplayLease)=>{value.release();return false;},()=>true);queued.abort();const queuedCancelled=await waiting,input=new Float32Array(65536*4),pending=first.applyWindow(input).then(()=>false,()=>true);active.abort();const activeCancelled=await pending;first.release();second.release();retireFloatDisplay(b);
   next=await borrowFloatDisplay(c);const output=await next.applyWindow(new Float32Array([.2,.3,.4,1]));next.release();retireFloatDisplay(c);return{queuedCancelled,activeCancelled,inputAttached:input.length===65536*4,retryLength:output.length,workers:(window as any).nativeDisplayWorkers};
  }finally{first.release();second.release();next?.release();for(const id of[a,b,c])retireFloatDisplay(id);}
 });
 expect(result).toMatchObject({queuedCancelled:true,activeCancelled:true,inputAttached:true,retryLength:4});expect(result.workers.maximum).toBe(2);expect(result.workers.live).toBe(0);await writeFile(info.outputPath('native-display-cancel.json'),JSON.stringify(result,null,2));
});

test('renderer cache clear retires its real idle display and later rendering preserves pixels',async({page},info)=>{
 await trackNativeOwners(page);await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async bytes=>{
  const{editor}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),{execute}=await import(/* @vite-ignore */String('/src/core/commands.ts'));await editor.openTiff(new File([new Uint8Array(bytes)],'Display owner.tif',{type:'image/tiff'}),{allowPrecisionLoss:true});const document=execute(editor.document.toJSON(),{type:'document.precision.float'}),model=JSON.stringify(editor.document.toJSON()),renderer=new CanvasRenderer();let a:HTMLCanvasElement|undefined,b:HTMLCanvasElement|undefined;
  try{
   const first:HTMLCanvasElement=await renderer.render(document,editor.assetStore,{cache:false,readback:true});a=first;const before=[...first.getContext('2d')!.getImageData(0,0,first.width,first.height).data],workers=(window as any).nativeDisplayWorkers,warm=workers.live;renderer.clearCache();const cleared=workers.live;const second:HTMLCanvasElement=await renderer.render(document,editor.assetStore,{cache:false,readback:true});b=second;const after=second.getContext('2d')!.getImageData(0,0,second.width,second.height).data;renderer.dispose();return{warm,cleared,pixelsExact:before.length===after.length&&before.every((v,i)=>v===after[i]),modelExact:model===JSON.stringify(editor.document.toJSON()),workers};
  }finally{if(a)a.width=a.height=0;if(b)b.width=b.height=0;renderer.dispose();}
 },[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);
 expect(result).toMatchObject({warm:1,cleared:0,pixelsExact:true,modelExact:true});expect(result.workers.maximum).toBeLessThanOrEqual(2);expect(result.workers.live).toBe(0);await writeFile(info.outputPath('native-display-renderer-clear.json'),JSON.stringify(result,null,2));
});
