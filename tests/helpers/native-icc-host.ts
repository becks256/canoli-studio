import{vi}from'vitest';
import{readFile}from'node:fs/promises';
import{NativeIccEngine}from'../../src/core/color/icc-native';
/** Test-only browser-host protocol backed by the real pinned WASM. */
export async function nativeIccHost(){
 const bytes=new Uint8Array(await readFile('src/core/color/codec/canoli_icc.wasm')),owners=new Set<NativeWorker>();
 class NativeWorker{
  onmessage:((event:{data:unknown})=>void)|null=null;onerror:unknown;onmessageerror:unknown;
  closed=false;engine?:NativeIccEngine;
  constructor(private url:URL){owners.add(this);}
  addEventListener(){}removeEventListener(){}
  postMessage(message:any){if(!String(this.url).includes('icc.worker'))return;void(async()=>{
   let data;try{
    if(message.operation==='apply')data={id:message.id,kind:'pixels',pixels:this.engine!.apply(message.pixels)};
    else{this.engine=await NativeIccEngine.create(bytes);if(this.closed){this.engine.dispose();return;}const source=new Uint8Array(await message.source.arrayBuffer());data=message.operation==='inspect'?{id:message.id,kind:'report',report:this.engine.inspect(source)}:{id:message.id,kind:'prepared',prepared:this.engine.begin(source,message.settings)};}
   }catch(error){data={id:message.id,kind:'error',error:error instanceof Error?error.message:String(error)};}
   if(!this.closed)this.onmessage?.({data});
  })();}
  terminate(){this.closed=true;this.engine?.dispose();owners.delete(this);}
 }
 vi.stubGlobal('Worker',NativeWorker);
 return()=>{for(const owner of owners)owner.terminate();vi.unstubAllGlobals();};
}
