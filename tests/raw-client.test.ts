import {beforeAll,afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import createRaw from '../src/core/interchange/raw/codec/canoli_raw_decoder.js';
import {rawDecoder} from '../src/core/interchange/raw/codec';
import {encodeRawWorkingImage} from '../src/core/interchange/raw/working-output';
import {inspectRawFile,developRawFile} from '../src/core/interchange/raw/client';
import type {RawImportReport} from '../src/core/interchange/raw/types';
let blob:Blob,png:Blob,report:RawImportReport;
beforeAll(async()=>{
  const bytes=new Uint8Array(await readFile('tests/fixtures/raw/bayer-rggb.dng')),codec=rawDecoder(await createRaw({wasmBinary:new Uint8Array(await readFile('src/core/interchange/raw/codec/canoli_raw_decoder.wasm'))}));
  blob=new Blob([bytes]);report=codec.inspect(bytes);png=await encodeRawWorkingImage(codec.develop(bytes));
});
afterEach(()=>vi.unstubAllGlobals());
class MockWorker {
  static instances:MockWorker[]=[];static posted:(worker:MockWorker)=>void=()=>{};
  onmessage:((event:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;request:any;terminations=0;
  constructor(){MockWorker.instances.push(this);}postMessage(value:unknown){this.request=value;MockWorker.posted(this);}terminate(){this.terminations++;}reply(value:unknown){this.onmessage?.({data:value}as MessageEvent);}
}
function mock(posted:(worker:MockWorker)=>void){MockWorker.instances=[];MockWorker.posted=posted;vi.stubGlobal('Worker',MockWorker);}
const consent={allowPrecisionLoss:true};
it('requires explicit working-output consent before creating a worker and preserves one immutable source',async()=>{
  mock(()=>{});await expect(developRawFile(blob)).rejects.toThrow(/consent/);expect(MockWorker.instances).toHaveLength(0);
  mock(worker=>queueMicrotask(()=>worker.reply({report,png})));expect((await developRawFile(blob,consent)).report).toEqual(report);
  expect(MockWorker.instances[0].request.blob).toBe(blob);expect(MockWorker.instances[0].terminations).toBe(1);expect(MockWorker.instances[0].onmessage).toBeNull();
});
it('queues native inspection behind development without a second worker and removes cancelled waiting work',async()=>{
  mock(()=>{});const first=developRawFile(blob,consent);await Promise.resolve();expect(MockWorker.instances).toHaveLength(1);
  const abort=new AbortController(),queued=inspectRawFile(blob,0,{signal:abort.signal});abort.abort(new Error('Cancel queued RAW'));await expect(queued).rejects.toThrow('Cancel queued RAW');expect(MockWorker.instances).toHaveLength(1);
  const last=inspectRawFile(blob);MockWorker.instances[0].reply({report,png});await first;
  await vi.waitFor(()=>expect(MockWorker.instances).toHaveLength(2));MockWorker.instances[1].reply({report});await last;expect(MockWorker.instances.every(worker=>worker.terminations===1)).toBe(true);
});
it('terminates active preparation on abort and retains cancellation through async result validation',async()=>{
  mock(()=>{});const abort=new AbortController(),pending=inspectRawFile(blob,0,{signal:abort.signal});await Promise.resolve();abort.abort(new Error('Cancel native RAW'));await expect(pending).rejects.toThrow('Cancel native RAW');expect(MockWorker.instances[0].terminations).toBe(1);
  let release!:(value:ArrayBuffer)=>void;const gate=new Promise<ArrayBuffer>(resolve=>release=resolve),held=new Blob([png],{type:'image/png'});vi.spyOn(held,'slice').mockReturnValue({arrayBuffer:()=>gate}as Blob);
  mock(worker=>queueMicrotask(()=>worker.reply({report,png:held})));const validation=new AbortController(),result=developRawFile(blob,consent,{signal:validation.signal});await Promise.resolve();await Promise.resolve();validation.abort(new Error('Cancel RAW validation'));await expect(result).rejects.toThrow('Cancel RAW validation');release(await png.slice(0,46).arrayBuffer());
});
for(const kind of ['error','message-error','post-error','schema','wrong-image','wrong-geometry','wrong-color','wrong-precision','missing-camera-wb','extra-samples','callback']as const)it(`contains RAW ${kind} and permits a fresh preparation`,async()=>{
  const changed=new Uint8Array(await png.arrayBuffer());if(kind==='wrong-color')changed[41]=1;if(kind==='wrong-precision')changed[24]=16;
  mock(worker=>{if(kind==='post-error')throw new Error('Post failed');queueMicrotask(()=>{
    if(kind==='error')worker.onerror?.();else if(kind==='message-error')worker.onmessageerror?.();else if(kind==='callback')worker.reply({progress:{phase:'developing',fraction:null}});
    else worker.reply({report:kind==='schema'?{...report,extra:1}:kind==='wrong-image'?{...report,image:1,imageCount:2}:kind==='wrong-geometry'?{...report,displayWidth:18}:kind==='missing-camera-wb'?{...report,hasCameraWhiteBalance:false}:kind==='extra-samples'?{...report,hasExtraSamples:true}:report,png:new Blob([changed],{type:'image/png'})});
  });});
  await expect(developRawFile(blob,consent,{onProgress(){throw new Error('RAW callback failed');}})).rejects.toThrow();expect(MockWorker.instances[0].terminations).toBe(1);
  mock(worker=>queueMicrotask(()=>worker.reply({report,png})));expect((await developRawFile(blob,consent)).report).toEqual(report);
});
