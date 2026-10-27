import {it,expect,vi,afterEach}from 'vitest';
import {IccSession}from '../src/core/color/icc-client';
import {iccTransformOptionsSchema,iccRgbOptionsSchema}from '../src/core/color/icc-types';
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
  const reply=message.operation==='prepare-rgb'?{id:message.id,kind:'rgb-prepared',prepared:{source:profile,destination:profile,settings:iccRgbOptionsSchema.parse(message.settings),usesIntentFallback:false,warnings:[]}}:message.operation==='prepare'?{id:message.id,kind:'prepared',prepared:{profile,settings:iccTransformOptionsSchema.parse(message.settings),usesIntentFallback:false,warnings:[]}}:message.operation==='inspect'?{id:message.id,kind:'report',report:profile}:{id:message.id,kind:'pixels',pixels:message.operation==='apply-window'?(message.pixels instanceof Uint16Array?new Uint16Array(message.pixels):message.pixels instanceof Float32Array?new Float32Array(message.pixels):new Uint8ClampedArray(message.pixels)):new Uint8ClampedArray(message.pixels)};
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

async function prepareRgb(control:Parameters<typeof IccSession.prepareRgb>[3]={}){const owner=await IccSession.prepareRgb(source,source,{inputFormat:'rgba-float32'},control);owners.push(owner.session);return owner;}
for(const failure of ['wrong-type','wrong-size','shared','subview','nonfinite','bad-alpha']as const)it('RGB worker rejects '+failure+' output and releases the owner',async()=>{
 install();const{session}=await prepareRgb();WorkerFixture.alter=(message,reply)=>{
  if(message.operation!=='apply-window')return reply;
  const pixels=failure==='wrong-type'?new Uint16Array(4):failure==='wrong-size'?new Float32Array(8):failure==='shared'?new Float32Array(new SharedArrayBuffer(16)):failure==='subview'?new Float32Array(8).subarray(4):failure==='nonfinite'?new Float32Array([NaN,0,0,1]):new Float32Array([0,0,0,2]);return{...reply,pixels};
 };
 await expect(session.applyWindow(new Float32Array([0,0,0,1]))).rejects.toThrow();expect(WorkerFixture.all[0].terminations).toBe(1);WorkerFixture.alter=(_message,reply)=>reply;const a=await prepare(),b=await prepareRgb();a.dispose();b.session.dispose();
});
for(const failure of ['settings','profile','extra']as const)it('RGB preparation rejects mismatched '+failure,async()=>{
 install();WorkerFixture.alter=(_message,reply)=>failure==='settings'?{...reply,prepared:{...reply.prepared,settings:{...reply.prepared.settings,outputFormat:'rgba16'}}}:failure==='profile'?{...reply,prepared:{...reply.prepared,source:{...profile,colorSpace:'CMYK'}}}:{...reply,extra:true};await expect(prepareRgb()).rejects.toThrow();expect(WorkerFixture.all[0].terminations).toBe(1);
});
it('RGB and legacy transforms share the same two-owner queue and cancellation',async()=>{
 install();const a=await prepare(),b=await prepareRgb(),abort=new AbortController(),queued=prepareRgb({signal:abort.signal}).then(()=>false,error=>error.name==='AbortError');expect(WorkerFixture.all).toHaveLength(2);abort.abort();expect(await queued).toBe(true);a.dispose();b.session.dispose();const next=await prepareRgb();next.session.dispose();expect(WorkerFixture.all).toHaveLength(3);
});
it('RGB input/output windows retain owned types and precision, unaffected by mutable preparation reports',async()=>{
 install();const{session,prepared}=await prepareRgb(),input=new Float32Array([-.125,2,.50001,.625]);prepared.settings.inputFormat='rgba16';prepared.settings.outputFormat='rgba8';const output=await session.applyWindow(input);expect(output).toBeInstanceOf(Float32Array);expect(output).toEqual(input);expect(output.buffer).not.toBe(input.buffer);await expect(session.apply(input as never)).rejects.toThrow('applyWindow');
});
it('RGB callback errors, concurrent calls and cancellation leave source samples attached',async()=>{
 install();const abort=new AbortController(),{session}=await prepareRgb({signal:abort.signal}),input=new Float32Array([.5,.50001,.50002,1]),pending=session.applyWindow(input),concurrent=session.applyWindow(input);abort.abort();await expect(concurrent).rejects.toThrow('Wait');await expect(pending).rejects.toThrow();expect(input.length).toBe(4);expect(input[1]).toBeCloseTo(.50001,6);
 const broken=await prepareRgb({onProgress:phase=>{if(phase==='processing')throw new Error('Processing callback failed');}});await expect(broken.session.applyWindow(input)).rejects.toThrow('Processing callback failed');const fresh=await prepareRgb();fresh.session.dispose();
});
