import {it,expect,vi,afterEach}from 'vitest';
import {IccSession}from '../src/core/color/icc-client';
import {iccTransformOptionsSchema}from '../src/core/color/icc-types';
const source=new Blob([new Uint8Array(132)]),profile={version:1,engine:'Little CMS 2.19.1',nativeVersion:2190,profileVersion:'2.4.0',deviceClass:'mntr',colorSpace:'RGB ',connectionSpace:'XYZ ',channels:3,description:'Protocol fixture',copyright:'',manufacturer:'',model:'',inputIntents:['relative-colorimetric'],outputIntents:['relative-colorimetric'],proofIntents:['relative-colorimetric']};
const owners:IccSession[]=[];
class WorkerFixture{
 static all:WorkerFixture[]=[];
 static launchError=false;
 static alter:(message:Record<string,any>,reply:Record<string,any>)=>Record<string,any>=(_message,reply)=>reply;
 onmessage:((event:{data:unknown})=>void)|null=null;
 onerror:(()=>void)|null=null;
 onmessageerror:(()=>void)|null=null;
 terminations=0;
 constructor(){if(WorkerFixture.launchError){WorkerFixture.launchError=false;throw new Error('Worker launch failed');}WorkerFixture.all.push(this);}
 postMessage(message:Record<string,any>){
  const reply=message.operation==='prepare'?{id:message.id,kind:'prepared',prepared:{profile,settings:iccTransformOptionsSchema.parse(message.settings),usesIntentFallback:false,warnings:[]}}:message.operation==='inspect'?{id:message.id,kind:'report',report:profile}:{id:message.id,kind:'pixels',pixels:new Uint8ClampedArray(message.pixels)};
  queueMicrotask(()=>{if(!this.terminations)this.onmessage?.({data:WorkerFixture.alter(message,reply)});});
 }
 terminate(){this.terminations++;}
}
function install(){WorkerFixture.all=[];WorkerFixture.launchError=false;WorkerFixture.alter=(_message,reply)=>reply;vi.stubGlobal('Worker',WorkerFixture);}
async function prepare(control:Parameters<typeof IccSession.prepare>[2]={}){const owner=await IccSession.prepare(source,{mode:'proof',gamutWarning:true},control);owners.push(owner.session);return owner.session;}
afterEach(()=>{owners.splice(0).forEach(owner=>owner.dispose());vi.unstubAllGlobals();});
for(const failure of ['wrong-id','wrong-kind','different-settings','extra-field','native-error'])it(`ICC protocol ${failure} rejects before a transform is exposed and releases its slot`,async()=>{
 install();WorkerFixture.alter=(message,reply)=>{
  if(failure==='wrong-id')return{...reply,id:message.id+1};if(failure==='wrong-kind')return{id:message.id,kind:'report',report:profile};if(failure==='different-settings')return{...reply,prepared:{...reply.prepared,settings:{...reply.prepared.settings,gamutWarning:false}}};if(failure==='extra-field')return{...reply,unexpected:true};return{id:message.id,kind:'error',error:'Native ICC validation failed'};
 };
 await expect(prepare()).rejects.toThrow();expect(WorkerFixture.all[0].terminations).toBe(1);WorkerFixture.alter=(_message,reply)=>reply;const a=await prepare(),b=await prepare();a.dispose();b.dispose();
});
it('malformed converted windows cannot be returned, and their owner cannot accept more pixels',async()=>{
 install();const session=await prepare();WorkerFixture.alter=(message,reply)=>message.operation==='apply'?{...reply,pixels:new Uint8ClampedArray(8)}:reply;
 await expect(session.apply(new Uint8ClampedArray([1,2,3,4]))).rejects.toThrow('invalid RGBA window');await expect(session.apply(new Uint8Array(4))).rejects.toThrow('closed');expect(WorkerFixture.all[0].terminations).toBe(1);
});
for(const phase of ['waiting','preparing','processing']as const)it(`throwing ${phase} callback releases current resources without detaching input`,async()=>{
 install();const input=new Uint8ClampedArray([1,2,3,4]);
 if(phase==='processing'){const session=await prepare({onProgress:p=>{if(p===phase)throw new Error('Callback failed');}});await expect(session.apply(input)).rejects.toThrow('Callback failed');}
 else await expect(prepare({onProgress:p=>{if(p===phase)throw new Error('Callback failed');}})).rejects.toThrow('Callback failed');
 expect([...input]).toEqual([1,2,3,4]);const a=await prepare(),b=await prepare();a.dispose();b.dispose();
});
it('launch failures and already-aborted calls do not consume either native owner slot',async()=>{
 install();WorkerFixture.launchError=true;await expect(prepare()).rejects.toThrow('launch failed');const abort=new AbortController();abort.abort();await expect(prepare({signal:abort.signal})).rejects.toThrow();expect(WorkerFixture.all).toHaveLength(0);const a=await prepare(),b=await prepare();a.dispose();b.dispose();
});
it('a worker error after preparation rejects its pending pixels and later output cannot revive it',async()=>{
 install();const session=await prepare();WorkerFixture.alter=(message,reply)=>{if(message.operation==='apply')WorkerFixture.all[0].onerror?.();return reply;};await expect(session.apply(new Uint8Array(4))).rejects.toThrow('worker failed');expect(WorkerFixture.all[0].terminations).toBe(1);WorkerFixture.alter=(_message,reply)=>reply;expect((await IccSession.inspect(source)).description).toBe('Protocol fixture');
});
