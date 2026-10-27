import{beforeAll,it,expect,vi,afterEach}from'vitest';
import{readFile}from'node:fs/promises';
import{decodeTiff}from'../src/core/interchange/tiff/decode';
import{decodeTiffFile}from'../src/core/interchange/tiff/client';
let pngBytes:Uint8Array<ArrayBuffer>,source:Blob,valid:Awaited<ReturnType<typeof decodeTiff>>;
beforeAll(async()=>{source=new Blob([new Uint8Array(await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif'))],{type:'image/tiff'});valid=await decodeTiff(source,{allowPrecisionLoss:true});pngBytes=new Uint8Array(await valid.png.arrayBuffer());});
class WorkerFixture{
 static instances:WorkerFixture[]=[];static response:()=>unknown=()=>structuredClone(valid);static launchError=false;
 onmessage:((event:{data:unknown})=>void)|null=null;onerror:unknown;onmessageerror:unknown;terminated=0;
 constructor(){if(WorkerFixture.launchError)throw new Error('Worker launch failed');WorkerFixture.instances.push(this);}
 postMessage(){queueMicrotask(()=>{if(!this.terminated)this.onmessage?.({data:WorkerFixture.response()});});}terminate(){this.terminated++;}
}
function install(response=()=>structuredClone(valid)){WorkerFixture.instances=[];WorkerFixture.launchError=false;WorkerFixture.response=response;vi.stubGlobal('Worker',WorkerFixture);}
afterEach(()=>vi.unstubAllGlobals());
for(const failure of['engine','profile','kind','integer-label','wrong-size','wrong-srgb','extra-field']as const)it('native float result '+failure+' rejects and releases its owner for retry',async()=>{
 install(()=>{const result=structuredClone(valid);if(!result.color)throw new Error('Missing fixture color');if(failure==='engine')result.color.wasmSha256='0'.repeat(64);if(failure==='profile')result.color.source.sha256='0'.repeat(64);if(failure==='kind')result.color.source={kind:'assumed',id:'linear-srgb',sha256:result.color.source.sha256};if(failure==='integer-label'){delete result.page.sampleFormat;result.report.pages[0]=result.page;delete result.color;}if(failure==='extra-field')return{...result,unexpected:true};if(failure==='wrong-size'||failure==='wrong-srgb'){const bytes=pngBytes.slice();if(failure==='wrong-size')new DataView(bytes.buffer).setUint32(16,1);else bytes[41]=1;return{...result,png:new Blob([bytes],{type:'image/png'})};}return result;});
 await expect(decodeTiffFile(source,{allowPrecisionLoss:true})).rejects.toThrow();expect(WorkerFixture.instances[0].terminated).toBe(1);WorkerFixture.response=()=>structuredClone(valid);expect((await decodeTiffFile(source,{allowPrecisionLoss:true})).color?.outputSpace).toBe('srgb8');
});
it('worker launch and callback failures do not hold the shared native owner',async()=>{
 install();WorkerFixture.launchError=true;await expect(decodeTiffFile(source,{allowPrecisionLoss:true})).rejects.toThrow('launch failed');WorkerFixture.launchError=false;await expect(decodeTiffFile(source,{allowPrecisionLoss:true},{onProgress(){throw new Error('Callback failed');}})).rejects.toThrow('Callback failed');expect(WorkerFixture.instances).toHaveLength(0);await expect(decodeTiffFile(source,{allowPrecisionLoss:true})).resolves.toHaveProperty('color');
});
it('active cancellation cannot detach source bytes or allow a late result to publish',async()=>{
 install();const abort=new AbortController(),before=await source.arrayBuffer();let sent=false;WorkerFixture.response=()=>{sent=true;abort.abort();return structuredClone(valid);};await expect(decodeTiffFile(source,{allowPrecisionLoss:true},{signal:abort.signal})).rejects.toThrow();expect(sent).toBe(true);expect(WorkerFixture.instances[0].terminated).toBe(1);expect(await source.arrayBuffer()).toEqual(before);WorkerFixture.response=()=>structuredClone(valid);await expect(decodeTiffFile(source,{allowPrecisionLoss:true})).resolves.toHaveProperty('color');
});
