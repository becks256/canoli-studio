import {beforeAll,it,expect,vi,afterEach} from 'vitest';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {floatPoissonBlend} from '../src/core/retouch/poisson';
import {findFloatRetouchDonor} from '../src/core/retouch/donor';
import {captureFloatPoissonOptions} from '../src/core/retouch/float-types';
import {wasmPoissonSolver,wasmDonorValidity,instantiateKernel,type PixelKernel} from '../src/engine/wasm';
import {PixelProcessor} from '../src/engine/processor';
const directory='tests/fixtures/float-retouch/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'));
const f32=(b:Uint8Array)=>new Float32Array(new Uint8Array(b).buffer),f64=(b:Uint8Array)=>new Float64Array(new Uint8Array(b).buffer),words=(a:Float32Array)=>[...new Uint32Array(a.buffer,a.byteOffset,a.length)],sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
let kernel:PixelKernel;
beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});
for(const row of manifest.cases)it('actual native '+row.name+' linear Poisson matches the independent sparse solve within its equation/storage bound',async()=>{
 const target=f32(gunzipSync(await readFile(directory+'target.f32.gz'))),donor=f32(gunzipSync(await readFile(directory+'donor.f32.gz'))),coverage=new Uint8Array(gunzipSync(await readFile(directory+'coverage.u8.gz'))),expected=f64(gunzipSync(await readFile(directory+row.reference))),before=target.slice(),beforeDonor=donor.slice(),support=row.soft?coverage:coverage.map(v=>v?255:0),tolerance=1e-10;
 const actual=floatPoissonBlend(target,donor,manifest.width,manifest.height,support,{mode:row.mode,tolerance,maxIterations:1000},wasmPoissonSolver(kernel)),reference=floatPoissonBlend(target,donor,manifest.width,manifest.height,support,{mode:row.mode,tolerance,maxIterations:1000});expect(actual.converged).toBe(true);expect(actual.residual).toBeLessThanOrEqual(tolerance);expect(actual.iterations).toBeGreaterThan(0);expect(reference.converged).toBe(true);
 for(let i=0;i<target.length;i++){
  if(i%4===3||!support[Math.floor(i/4)]||target[i-i%4+3]===0){expect(words(actual.pixels)[i]).toBe(words(target)[i]);continue;}
  const halfUlp=Math.max(2**-150,2**(Math.floor(Math.log2(Math.max(Math.abs(expected[i]),2**-126)))-24)),bound=row.inverseInfinityBound*(actual.residual+row.referenceResidual)+halfUlp+1e-12;
  expect(Math.abs(actual.pixels[i]-expected[i]),JSON.stringify({case:row.name,index:i,actual:actual.pixels[i],expected:expected[i],bound})).toBeLessThanOrEqual(bound);expect(Math.abs(actual.pixels[i]-reference.pixels[i])).toBeLessThanOrEqual(bound*2);
 }
 expect(words(target)).toEqual(words(before));expect(words(donor)).toEqual(words(beforeDonor));expect(actual.pixels.some((v,i)=>i%4!==3&&v<0)).toBe(true);expect(actual.pixels.some((v,i)=>i%4!==3&&v>1)).toBe(true);
});
it('float donor search retains intact support, excludes damaged RGB and matches independent scalar scoring/ties',async()=>{
 const d=manifest.donor,pixels=f32(gunzipSync(await readFile(directory+'donor-search.f32.gz'))),coverage=new Uint8Array(gunzipSync(await readFile(directory+'donor-search.u8.gz'))),before=pixels.slice(),result=findFloatRetouchDonor(pixels,d.width,d.height,coverage,{radius:d.radius},wasmDonorValidity(kernel));expect(result).toEqual({x:d.x,y:d.y,score:d.score,candidates:d.candidates});
 for(let p=0;p<coverage.length;p++)if(coverage[p])pixels.set([-1234,65536,3e20],p*4);expect(findFloatRetouchDonor(pixels,d.width,d.height,coverage,{radius:d.radius})).toEqual(result);expect(findFloatRetouchDonor(before,d.width,d.height,coverage,{radius:d.radius})).toEqual(result);
});
it('native defaults, padding, alpha, malformed options, nonconvergence and overflow retain explicit failure semantics',()=>{
 expect(captureFloatPoissonOptions({})).toEqual({mode:'source',tolerance:1e-7,maxIterations:500});const target=Float32Array.from({length:5*5*4},(_,i)=>i%4===3?.375:i%4===0?4:i%4===1?-2:8),donor=target.slice(),mask=new Uint8Array(25);mask[12]=255;donor[12*4]=12;
 expect(floatPoissonBlend(target,donor,5,5,mask,{},wasmPoissonSolver(kernel)).converged).toBe(true);for(const invalid of [{mode:'bad'},{tolerance:NaN},{maxIterations:0},{maxIterations:0x80000000},{extra:1}])expect(()=>floatPoissonBlend(target,donor,5,5,mask,invalid as never)).toThrow();
 const edge=mask.slice();edge[0]=255;expect(()=>floatPoissonBlend(target,donor,5,5,edge)).toThrow('boundary');const nan=target.slice();nan[nan.length-4]=NaN;expect(()=>floatPoissonBlend(nan,donor,5,5,mask)).toThrow('finite');const alpha=target.slice();alpha[3]=1.1;expect(()=>floatPoissonBlend(alpha,donor,5,5,mask)).toThrow('alpha');
 const huge=target.slice();huge[12*4]=3.4e38;expect(()=>floatPoissonBlend(target,huge,5,5,mask,{},wasmPoissonSolver(kernel))).not.toThrow();
 for(const p of [7,11,13,17])huge[p*4]=-3.4e38;expect(()=>floatPoissonBlend(target,huge,5,5,mask,{},wasmPoissonSolver(kernel))).toThrow(/finite|overflow/i);
 const altered=target.slice();for(let i=0;i<altered.length;i+=4)altered[i]=Math.sin(i)*7;const broad=new Uint8Array(25);for(let y=1;y<4;y++)for(let x=1;x<4;x++)broad[y*5+x]=255;const failed=floatPoissonBlend(target,altered,5,5,broad,{tolerance:1e-30,maxIterations:1},wasmPoissonSolver(kernel));expect(failed.converged).toBe(false);expect(failed.iterations).toBe(1);expect(target[0]).toBe(4);
});

class ControlledWorker {
 static current:ControlledWorker;onmessage?:(event:{data:any})=>void;onerror?:()=>void;postMessage=vi.fn();terminate=vi.fn();constructor(){ControlledWorker.current=this;}ready(){this.onmessage?.({data:{type:'ready'}});}reply(data:unknown){this.onmessage?.({data});}
}
afterEach(()=>vi.unstubAllGlobals());
it('float worker packets snapshot complete inputs before readiness and retain caller ownership',async()=>{
 vi.stubGlobal('Worker',ControlledWorker);const processor=new PixelProcessor(),target=new Float32Array([4,-2,8,.375]),donor=target.slice(),coverage=new Uint8Array([0]),options={mode:'source' as const,tolerance:1e-8},expected=target.slice(),pending=processor.floatPoissonBlend(target,donor,1,1,coverage,options);target.fill(0);donor.fill(0);coverage.fill(255);options.tolerance=.5;const worker=ControlledWorker.current;worker.ready();await Promise.resolve();await Promise.resolve();const request=worker.postMessage.mock.calls[0][0];expect([...request.floatPoisson.pixels]).toEqual([...expected]);expect(request.floatPoisson.coverage[0]).toBe(0);expect(request.floatPoisson.options.tolerance).toBe(1e-8);worker.reply({id:request.id,floatPoissonResult:{pixels:expected.slice(),converged:true,iterations:0,residual:0}});expect(words((await pending).pixels)).toEqual(words(expected));expect(target.byteLength).toBe(16);processor.dispose();
});
for(const kind of ['wrong-kind','wrong-alpha','wrong-geometry','aliased-buffer','false-convergence'] as const)it('rejects malformed '+kind+' worker results and leaves a new request usable',async()=>{
 vi.stubGlobal('Worker',ControlledWorker);const processor=new PixelProcessor(),target=new Float32Array([4,-2,8,.375]),worker=ControlledWorker.current;worker.ready();const pending=processor.floatPoissonBlend(target,target,1,1,new Uint8Array([0]));await Promise.resolve();await Promise.resolve();const request=worker.postMessage.mock.calls[0][0],pixels=kind==='wrong-geometry'?new Float32Array(8):kind==='aliased-buffer'?new Float32Array(8).subarray(0,4):target.slice();if(kind==='wrong-alpha')pixels[3]=.5;const result={pixels,converged:kind!=='false-convergence',iterations:0,residual:0};worker.reply({id:request.id,[kind==='wrong-kind'?'poissonResult':'floatPoissonResult']:result});await expect(pending).rejects.toThrow();const healthy=processor.floatPoissonBlend(target,target,1,1,new Uint8Array([0]));await Promise.resolve();await Promise.resolve();const next=worker.postMessage.mock.calls[1][0];worker.reply({id:next.id,floatPoissonResult:{pixels:target.slice(),converged:true,iterations:0,residual:0}});expect((await healthy).converged).toBe(true);processor.dispose();
});
it('worker shutdown rejects active native donor and Poisson requests and malformed requests never post',async()=>{
 vi.stubGlobal('Worker',ControlledWorker);const processor=new PixelProcessor(),worker=ControlledWorker.current;worker.ready();await expect(processor.floatPoissonBlend(new Float32Array([NaN,0,0,1]),new Float32Array(4),1,1,new Uint8Array([0]))).rejects.toThrow();expect(worker.postMessage).not.toHaveBeenCalled();const pixels=new Float32Array([4,-2,8,.375]),solve=processor.floatPoissonBlend(pixels,pixels,1,1,new Uint8Array([0])),search=processor.findFloatDonor(pixels,1,1,new Uint8Array([0]));processor.dispose();await expect(solve).rejects.toThrow('closed');await expect(search).rejects.toThrow('closed');expect(worker.terminate).toHaveBeenCalledOnce();
});
for(const kind of ['wrong-kind','zero-offset','radius','geometry','fractional','candidates','nonfinite-score','negative-score','extra-key'] as const)it('rejects malformed native donor '+kind+' replies and permits a healthy retry',async()=>{
 vi.stubGlobal('Worker',ControlledWorker);const processor=new PixelProcessor(),worker=ControlledWorker.current;worker.ready();const pixels=Float32Array.from({length:5*5*4},(_,i)=>i%4===3?.375:i%4===1?-2:4),coverage=new Uint8Array(25),pending=processor.findFloatDonor(pixels,5,5,coverage,{radius:2});await Promise.resolve();await Promise.resolve();const packet=worker.postMessage.mock.calls[0][0],reply:{x:number;y:number;score:number;candidates:number;extra?:boolean}={x:1,y:0,score:0,candidates:1};
 if(kind==='zero-offset')reply.x=0;if(kind==='radius')reply.x=3;if(kind==='geometry')reply.x=5;if(kind==='fractional')reply.x=.5;if(kind==='candidates')reply.candidates=0;if(kind==='nonfinite-score')reply.score=NaN;if(kind==='negative-score')reply.score=-1;if(kind==='extra-key')reply.extra=true;worker.reply({id:packet.id,[kind==='wrong-kind'?'donorResult':'floatDonorResult']:reply});await expect(pending).rejects.toThrow();
 const healthy=processor.findFloatDonor(pixels,5,5,coverage,{radius:2});await Promise.resolve();await Promise.resolve();const next=worker.postMessage.mock.calls[1][0];worker.reply({id:next.id,floatDonorResult:{x:1,y:0,score:0,candidates:1}});expect(await healthy).toEqual({x:1,y:0,score:0,candidates:1});processor.dispose();
});
it('the independent generator and every input/reference stream match their sealed hashes',async()=>{
 expect(sha(await readFile('scripts/generate-float-retouch.py'))).toBe(manifest.generatorSha256);for(const[name,row]of Object.entries(manifest.files) as [string,{bytes:number;sha256:string;rawSha256?:string}][]){const packed=await readFile(directory+name);expect(packed.length).toBe(row.bytes);expect(sha(packed)).toBe(row.sha256);if(row.rawSha256)expect(sha(gunzipSync(packed))).toBe(row.rawSha256);}
});
