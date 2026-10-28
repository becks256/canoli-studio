import{it,expect,vi,afterEach}from'vitest';
import{IccSession,acquireIccOwner}from'../src/core/color/icc-client';
import{iccRgbOptionsSchema,iccTransformOptionsSchema}from'../src/core/color/icc-types';
import{borrowFloatDisplay,retireFloatDisplay}from'../src/engine/float-display';

const profile={version:1,engine:'Little CMS 2.19.1',nativeVersion:2190,profileVersion:'2.4.0',deviceClass:'mntr',colorSpace:'RGB ',connectionSpace:'XYZ ',channels:3,description:'Protocol fixture',copyright:'',manufacturer:'',model:'',inputIntents:['relative-colorimetric'],outputIntents:['relative-colorimetric'],proofIntents:['relative-colorimetric']};
class WorkerFixture{
 static all:WorkerFixture[]=[];static hold=false;static invalid=false;
 onmessage:((event:{data:unknown})=>void)|null=null;onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;
 terminations=0;messages:Record<string,any>[]=[];lastId=0;
 constructor(){WorkerFixture.all.push(this);}
 postMessage(message:Record<string,any>){
  expect(message.id).toBeGreaterThan(this.lastId);this.lastId=message.id;this.messages.push(message);
  const reply=message.operation==='prepare-rgb'?{id:message.id,kind:'rgb-prepared',prepared:{source:profile,destination:profile,settings:iccRgbOptionsSchema.parse(message.settings),usesIntentFallback:false,warnings:[]}}:
   message.operation==='prepare'?{id:message.id,kind:'prepared',prepared:{profile,settings:iccTransformOptionsSchema.parse(message.settings),usesIntentFallback:false,warnings:[]}}:
   {id:message.id,kind:'pixels',pixels:WorkerFixture.invalid?new Float32Array(message.pixels.length):new Uint8ClampedArray(message.pixels.length)};
  if(message.operation==='apply-window'&&WorkerFixture.hold)return;
  queueMicrotask(()=>{if(!this.terminations)this.onmessage?.({data:reply});});
 }
 terminate(){this.terminations++;}
}
const owners:symbol[]=[],leases:Awaited<ReturnType<typeof borrowFloatDisplay>>[]=[],sessions:IccSession[]=[];
function install(){WorkerFixture.all=[];WorkerFixture.hold=false;WorkerFixture.invalid=false;vi.stubGlobal('Worker',WorkerFixture);}
function owner(){const id=Symbol();owners.push(id);return id;}
async function borrow(control:Parameters<typeof borrowFloatDisplay>[1]={},id=owner()){const lease=await borrowFloatDisplay(id,control);leases.push(lease);return lease;}
const input=()=>new Float32Array([.2,.3,.4,1]);
afterEach(()=>{leases.splice(0).forEach(l=>l.release());owners.splice(0).forEach(retireFloatDisplay);sessions.splice(0).forEach(s=>s.dispose());vi.unstubAllGlobals();});

it('reuses the actual prepared session without retaining an earlier caller or its abort scope',async()=>{
 install();const a=owner(),b=owner(),abort=new AbortController(),old=vi.fn(),current=vi.fn(),first=await borrow({signal:abort.signal,onProgress:old},a),samples=input(),before=samples.slice();await first.applyWindow(samples);first.release();const oldCalls=old.mock.calls.length;
 const second=await borrow({onProgress:current},b);abort.abort();const result=await second.applyWindow(samples);second.release();
 expect(WorkerFixture.all).toHaveLength(1);expect(WorkerFixture.all[0].messages.map(m=>m.operation)).toEqual(['prepare-rgb','apply-window','apply-window']);expect(old).toHaveBeenCalledTimes(oldCalls);expect(current).toHaveBeenCalledWith('processing');expect(result).toBeInstanceOf(Uint8ClampedArray);expect(samples).toEqual(before);expect(WorkerFixture.all[0].messages[1].pixels.buffer).not.toBe(samples.buffer);
 retireFloatDisplay(a);expect(WorkerFixture.all[0].terminations).toBe(0);retireFloatDisplay(b);expect(WorkerFixture.all[0].terminations).toBe(1);await expect(first.applyWindow(samples)).rejects.toThrow('closed');
});

it('retires an idle transform so queued original-source work can acquire a native slot',async()=>{
 install();const display=await borrow();display.release();const legacy=await IccSession.prepare(new Blob([new Uint8Array(132)]),{mode:'proof',gamutWarning:true});sessions.push(legacy.session);expect(WorkerFixture.all[0].terminations).toBe(0);
 const releaseSource=await acquireIccOwner();expect(WorkerFixture.all[0].terminations).toBe(1);let admitted=false;const next=borrow().then(value=>{admitted=true;return value;});await Promise.resolve();expect(admitted).toBe(false);releaseSource();const replacement=await next;replacement.release();expect(WorkerFixture.all.filter(w=>!w.terminations)).toHaveLength(2);
});

it('keeps only one idle owner when two concurrent displays finish',async()=>{
 install();const a=await borrow(),b=await borrow(),abort=new AbortController(),waiting=borrow({signal:abort.signal});abort.abort();await expect(waiting).rejects.toThrow();expect(WorkerFixture.all).toHaveLength(2);a.release();b.release();expect(WorkerFixture.all.filter(w=>!w.terminations)).toHaveLength(1);
});

it('active cancellation rejects native work, preserves input and never caches the cancelled owner',async()=>{
 install();const abort=new AbortController(),display=await borrow({signal:abort.signal}),samples=input();WorkerFixture.hold=true;const work=display.applyWindow(samples);abort.abort();await expect(work).rejects.toThrow();display.release();expect(samples).toEqual(input());expect(WorkerFixture.all[0].terminations).toBe(1);WorkerFixture.hold=false;const fresh=await borrow();await fresh.applyWindow(samples);expect(WorkerFixture.all).toHaveLength(2);
});

it('releasing pending work closes the session rather than publishing a busy idle transform',async()=>{
 install();const display=await borrow();WorkerFixture.hold=true;const pending=display.applyWindow(input());display.release();await expect(pending).rejects.toThrow();expect(WorkerFixture.all[0].terminations).toBe(1);WorkerFixture.hold=false;const next=await borrow();await next.applyWindow(input());expect(WorkerFixture.all).toHaveLength(2);
});

it('replaces an idle worker that failed after its last successful window',async()=>{
 install();const first=await borrow();await first.applyWindow(input());first.release();WorkerFixture.all[0].onerror?.();expect(WorkerFixture.all[0].terminations).toBe(1);const next=await borrow();await next.applyWindow(input());expect(WorkerFixture.all).toHaveLength(2);
});

it('invalid native output rejects without detaching input and cannot poison later reuse',async()=>{
 install();const first=await borrow(),samples=input();WorkerFixture.invalid=true;await expect(first.applyWindow(samples)).rejects.toThrow();first.release();expect(samples).toEqual(input());expect(WorkerFixture.all[0].terminations).toBe(1);WorkerFixture.invalid=false;const next=await borrow();await next.applyWindow(samples);expect(WorkerFixture.all).toHaveLength(2);
});

it('large valid windows still process but their native scratch does not stay idle',async()=>{
 install();const first=await borrow(),samples=new Float32Array(65537*4),output=await first.applyWindow(samples);expect(output).toHaveLength(samples.length);expect(samples).toHaveLength(65537*4);first.release();expect(WorkerFixture.all[0].terminations).toBe(1);
});

it('a callback error on a reused session releases native ownership and preserves the next request',async()=>{
 install();const first=await borrow();first.release();const next=await borrow({onProgress:phase=>{if(phase==='processing')throw new Error('Current callback failed');}});await expect(next.applyWindow(input())).rejects.toThrow('Current callback failed');next.release();expect(WorkerFixture.all[0].terminations).toBe(1);const fresh=await borrow();await fresh.applyWindow(input());expect(WorkerFixture.all).toHaveLength(2);
});
