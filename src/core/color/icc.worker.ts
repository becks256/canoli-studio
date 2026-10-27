import {z}from 'zod';
import {NativeIccEngine}from './icc-native';
import {iccTransformOptionsSchema,iccRgbOptionsSchema}from './icc-types';
const requestSchema=z.discriminatedUnion('operation',[
 z.object({id:z.number().int().positive(),operation:z.literal('inspect'),source:z.instanceof(Blob)}).strict(),
 z.object({id:z.number().int().positive(),operation:z.literal('prepare'),source:z.instanceof(Blob),settings:iccTransformOptionsSchema}).strict(),
 z.object({id:z.number().int().positive(),operation:z.literal('prepare-rgb'),source:z.instanceof(Blob),destination:z.instanceof(Blob),settings:iccRgbOptionsSchema}).strict(),
 z.object({id:z.number().int().positive(),operation:z.literal('apply'),pixels:z.instanceof(Uint8ClampedArray)}).strict(),
 z.object({id:z.number().int().positive(),operation:z.literal('apply-window'),pixels:z.union([z.instanceof(Uint8ClampedArray),z.instanceof(Uint16Array),z.instanceof(Float32Array)])}).strict(),
]);
let engine:NativeIccEngine|undefined,started=false,busy=false,ready=false,lastId=0;
self.onmessage=async(event:MessageEvent)=>{
 let id=Number.isSafeInteger(event.data?.id)?event.data.id:0;
 try{
  const request=requestSchema.parse(event.data);id=request.id;
  if(busy||id<=lastId)throw new Error('Out-of-order ICC worker operation.');lastId=id;busy=true;
  if(request.operation==='apply'||request.operation==='apply-window'){
   if(!ready||!engine||!(request.pixels.buffer instanceof ArrayBuffer)||request.pixels.byteOffset!==0||request.pixels.byteLength!==request.pixels.buffer.byteLength)throw new Error('ICC worker requires a prepared transform and an owned RGBA window.');
   const pixels=request.operation==='apply'?engine.apply(request.pixels):engine.applyWindow(request.pixels);self.postMessage({id,kind:'pixels',pixels},{transfer:[pixels.buffer]});
  }else{
   if(started)throw new Error('This ICC worker already owns a profile.');started=true;
   engine=await NativeIccEngine.create();const bytes=new Uint8Array(await request.source.arrayBuffer());
   if(request.operation==='inspect'){const report=engine.inspect(bytes);engine.dispose();self.postMessage({id,kind:'report',report});}
   else if(request.operation==='prepare-rgb'){const prepared=engine.beginRgb(bytes,new Uint8Array(await request.destination.arrayBuffer()),request.settings);ready=true;self.postMessage({id,kind:'rgb-prepared',prepared});}
   else{const prepared=engine.begin(bytes,request.settings);ready=true;self.postMessage({id,kind:'prepared',prepared});}
  }
 }catch(error){ready=false;engine?.dispose();self.postMessage({id,kind:'error',error:error instanceof Error?error.message:String(error)});}
 finally{busy=false;}
};
