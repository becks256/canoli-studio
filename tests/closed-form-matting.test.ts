import {beforeAll,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {wasmMattingIterations} from '../src/engine/matting-iterations';
import {ClosedFormMatting} from '../src/intelligence/matting/closed-form';
import {refineEdgeOptionsSchema,mattingHalo} from '../src/core/matting';
import {prepareMattingTile,refineMattingTile,type MattingTileRequest} from '../src/engine/matting-tile';
import {runMattingJob} from '../src/engine/matting-workflow';
import {instantiateKernel,type PixelKernel} from '../src/engine/wasm';
import {openPngRows} from '../server/png-rows';
interface Fixture {name:string;width:number;height:number;rgba:number[];labels:number[];alpha:number[];syntheticQuality?:{meanAbsoluteError:number}}
const reference=JSON.parse(await readFile('tests/fixtures/matting/closed-form-reference.json','utf8')) as {cases:Fixture[]};
let kernel:PixelKernel;beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});
function capture(fixture:Fixture,ox:number,oy:number,w:number,h:number,prior?:Uint8Array){
  const options=refineEdgeOptionsSchema.parse({radius:10,smoothness:0}),halo=mattingHalo(options),width=w+2*halo,height=h+2*halo,pixels=new Uint8ClampedArray(width*height*4),labels=new Uint8Array(width*height),initial=prior?new Uint8Array(width*height):undefined;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const xx=ox-halo+x,yy=oy-halo+y;if(xx<0||yy<0||xx>=fixture.width||yy>=fixture.height)continue;const i=yy*fixture.width+xx,j=y*width+x;pixels.set(fixture.rgba.slice(i*4,i*4+4),j*4);labels[j]=fixture.labels[i];if(initial)initial[j]=prior![i];}
  const request:MattingTileRequest={x:ox-halo,y:oy-halo,width,height,sourceWidth:fixture.width,sourceHeight:fixture.height,core:{x:halo,y:halo,width:w,height:h},initial,labels,options};return{pixels,request};
}
async function solve(fixture:Fixture,tileWidth=fixture.width,tileHeight=fixture.height,prior?:Uint8Array,preconditioner:'ic0'|'jacobi'='ic0',wasm=false,budget?:number){
  const solver=new ClosedFormMatting(fixture.width,fixture.height,budget);
  for(let y=0;y<fixture.height;y+=tileHeight)for(let x=0;x<fixture.width;x+=tileWidth){const tile=capture(fixture,x,y,Math.min(tileWidth,fixture.width-x),Math.min(tileHeight,fixture.height-y),prior);solver.add({...tile.request,...prepareMattingTile(tile.pixels,tile.request)});}
  const diagnostics=await solver.solve(undefined,2000,preconditioner,true,wasm?wasmMattingIterations(kernel):undefined),alpha=Uint8Array.from(fixture.labels,(value,i)=>value===128?(solver.sample(i%fixture.width,Math.floor(i/fixture.width))?.alpha??prior?.[i]??0):value);return{alpha,diagnostics,solver};
}

it('IC(0) preserves the same constrained solution as Jacobi while reducing iterations on the wide unknown fixture',async()=>{
  const fixture=reference.cases.find(item=>item.name==='wide-unknown')!,ic=await solve(fixture,17,3),jacobi=await solve(fixture,17,3,undefined,'jacobi');
  expect(Math.max(...ic.alpha.map((value,i)=>Math.abs(value-jacobi.alpha[i])))).toBeLessThanOrEqual(1);expect(ic.diagnostics.preconditioner).toBe('ic0');expect(ic.diagnostics.iterations).toBeLessThan(jacobi.diagnostics.iterations);expect(ic.diagnostics.estimatedGraphBytes).toBeLessThanOrEqual(192*1024*1024);ic.solver.dispose();jacobi.solver.dispose();
});

it('a graph that fits the original budget still solves globally when IC(0) work cannot fit',async()=>{
  const fixture=reference.cases.find(item=>item.name==='wide-unknown')!,tile=capture(fixture,0,0,fixture.width,fixture.height),budget=1_100_000,solver=new ClosedFormMatting(fixture.width,fixture.height,budget);solver.add({...tile.request,...prepareMattingTile(tile.pixels,tile.request)});const result=await solver.solve();
  expect(result.preconditioner).toBe('jacobi');expect(result.estimatedGraphBytes).toBeLessThanOrEqual(budget);for(let i=0;i<fixture.alpha.length;i++)if(fixture.labels[i]===128)expect(Math.abs(solver.sample(i%fixture.width,Math.floor(i/fixture.width))!.alpha-fixture.alpha[i])).toBeLessThanOrEqual(1);solver.dispose();
});

it('the optional coarse system does not reduce the original IC(0) graph capacity',async()=>{
  const fixture=reference.cases.find(item=>item.name==='distant-native-patch')!,tile=capture(fixture,0,0,fixture.width,fixture.height),budget=3*2048*644,solver=new ClosedFormMatting(fixture.width,fixture.height,budget);
  solver.add({...tile.request,...prepareMattingTile(tile.pixels,tile.request)});
  try{
    const result=await solver.solve();expect(result.preconditioner).toBe('ic0');expect(result.coarseBlocks).toBe(0);expect(result.coarseBytes).toBe(0);expect(result.estimatedGraphBytes).toBe(budget);
    for(let i=0;i<fixture.alpha.length;i++)if(fixture.labels[i]===128)expect(Math.abs(solver.sample(i%fixture.width,Math.floor(i/fixture.width))!.alpha-fixture.alpha[i])).toBeLessThanOrEqual(1);
  }finally{solver.dispose();}
});

it('a physical coarse-buffer allocation failure retains the original global solver',async()=>{
  const fixture=reference.cases.find(item=>item.name==='distant-native-patch')!,tile=capture(fixture,0,0,fixture.width,fixture.height),solver=new ClosedFormMatting(fixture.width,fixture.height);
  solver.add({...tile.request,...prepareMattingTile(tile.pixels,tile.request)});
  const Native=Float64Array;let allocationFailed=false;
  vi.stubGlobal('Float64Array',new Proxy(Native,{construct(target,args){if(args.length===1&&args[0]>0&&args[0]<4096){allocationFailed=true;throw new RangeError('Injected coarse-buffer allocation failure');}return Reflect.construct(target,args);}}));
  try{
    const result=await solver.solve();expect(allocationFailed).toBe(true);expect(result.coarseBlocks).toBe(0);expect(result.preconditioner).toBe('ic0');expect(result.relativeResidual).toBeLessThanOrEqual(1e-7);
    for(let i=0;i<fixture.alpha.length;i++)if(fixture.labels[i]===128)expect(Math.abs(solver.sample(i%fixture.width,Math.floor(i/fixture.width))!.alpha-fixture.alpha[i])).toBeLessThanOrEqual(1);
  }finally{vi.unstubAllGlobals();solver.dispose();}
});

it('coarse RGB correction excludes large unconstrained islands and preserves every genuine prior byte',async()=>{
  const left=reference.cases.find(item=>item.name==='color-line')!,width=130,height=50,fixture:Fixture={name:'coarse-mixed-components',width,height,rgba:Array(width*height*4).fill(0),labels:Array(width*height).fill(0),alpha:[]},prior=Uint8Array.from({length:width*height},(_,i)=>(i*19)%256);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    if(x<left.width&&y<left.height){const from=y*left.width+x;for(let c=0;c<4;c++)fixture.rgba[i*4+c]=left.rgba[from*4+c];fixture.labels[i]=left.labels[from];}
    else if(x>=13){fixture.rgba[i*4]=73;fixture.rgba[i*4+1]=127;fixture.rgba[i*4+2]=201;fixture.rgba[i*4+3]=255;fixture.labels[i]=128;}
  }
  const result=await solve(fixture,17,11,prior,'ic0',true);
  expect(result.diagnostics.iterationBackend).toBe('wasm');
  try{
    expect(result.diagnostics.coarseBlocks).toBeGreaterThan(0);expect(result.diagnostics.relativeResidual).toBeLessThanOrEqual(1e-9);expect(result.diagnostics.unresolvedPixels).toBe((width-13)*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x;
      if(x<left.width&&y<left.height)expect(Math.abs(result.alpha[i]-left.alpha[y*left.width+x])).toBeLessThanOrEqual(1);
      else if(x>=13)expect(result.alpha[i]).toBe(prior[i]);
      else expect(result.alpha[i]).toBe(0);
    }
  }finally{result.solver.dispose();}
});

it('a physical optional-factor allocation failure retains the global Jacobi solution',async()=>{
  const fixture=reference.cases.find(item=>item.name==='wide-unknown')!,tile=capture(fixture,0,0,fixture.width,fixture.height),solver=new ClosedFormMatting(fixture.width,fixture.height);
  solver.add({...tile.request,...prepareMattingTile(tile.pixels,tile.request)});
  const Native=Float64Array;let allocationFailed=false;
  vi.stubGlobal('Float64Array',new Proxy(Native,{construct(target,args){if(args.length===1&&args[0]===2048*25){allocationFailed=true;throw new RangeError('Injected optional-factor allocation failure');}return Reflect.construct(target,args);}}));
  try{
    const result=await solver.solve();expect(allocationFailed).toBe(true);expect(result.preconditioner).toBe('jacobi');expect(result.relativeResidual).toBeLessThanOrEqual(1e-7);
    for(let i=0;i<fixture.alpha.length;i++)if(fixture.labels[i]===128)expect(Math.abs(solver.sample(i%fixture.width,Math.floor(i/fixture.width))!.alpha-fixture.alpha[i])).toBeLessThanOrEqual(1);
  }finally{vi.unstubAllGlobals();solver.dispose();}
});

it('disconnected unknown islands preserve priors while a constrained component solves across capture tiles',async()=>{
  const left=reference.cases.find(item=>item.name==='color-line')!,width=23,height=left.height,fixture:Fixture={name:'mixed-components',width,height,rgba:Array(width*height*4).fill(0),labels:Array(width*height).fill(0),alpha:[]},prior=Uint8Array.from({length:width*height},(_,i)=>(i*19)%256);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    if(x<left.width){const from=y*left.width+x;fixture.rgba.splice(i*4,4,...left.rgba.slice(from*4,from*4+4));fixture.labels[i]=left.labels[from];}
    else if(x>=13){fixture.rgba.splice(i*4,4,73,127,201,255);fixture.labels[i]=128;}
  }
  const result=await solve(fixture,7,3,prior);
  try{
    expect(result.diagnostics.unresolvedPixels).toBe(10*height);expect(result.diagnostics.relativeResidual).toBeLessThanOrEqual(1e-7);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x;
      if(x<left.width)expect(Math.abs(result.alpha[i]-left.alpha[y*left.width+x])).toBeLessThanOrEqual(1);
      else if(x>=13)expect(result.alpha[i]).toBe(prior[i]);
      else expect(result.alpha[i]).toBe(0);
    }
  }finally{result.solver.dispose();}
});

for(const fixture of reference.cases)it(`global closed-form ${fixture.name} matches the independent SciPy direct solution`,async()=>{
  const result=await solve(fixture,37,11),errors=result.alpha.map((value,i)=>Math.abs(value-fixture.alpha[i]));expect(Math.max(...errors)).toBeLessThanOrEqual(1);expect(errors.reduce((sum,value)=>sum+value,0)/errors.length).toBeLessThan(.02);expect(result.diagnostics.relativeResidual).toBeLessThanOrEqual(1e-7);expect(result.diagnostics.unresolvedPixels).toBe(0);expect(result.diagnostics.iterations).toBeGreaterThan(0);
  if(fixture.name==='distant-native-patch'){expect(result.diagnostics.coarseBlocks).toBeGreaterThan(0);expect(result.diagnostics.relativeResidual).toBeLessThanOrEqual(1e-9);}
  for(let i=0;i<fixture.labels.length;i++)if(fixture.labels[i]!==128)expect(result.alpha[i]).toBe(fixture.labels[i]);
  if(fixture.name==='color-line'){const tile=capture(fixture,0,0,fixture.width,fixture.height);tile.request.options=refineEdgeOptionsSchema.parse({...tile.request.options,decontaminate:true,outputTo:'new-layer'});const output=refineMattingTile(kernel,tile.pixels,tile.request,result.solver),i=2*fixture.width+4,a=output.alpha[i]/255;expect(Array.from(output.rgba.slice(i*4,i*4+4))).toEqual([105,25,105].map((value,c)=>Math.round(Math.max(0,Math.min(255,(value-(1-a)*[10,30,200][c])/Math.max(a,.12))))).concat(255));}
  console.log('Closed-form reference',fixture.name,JSON.stringify({iterations:result.diagnostics.iterations,relativeResidual:result.diagnostics.relativeResidual,maxByteError:Math.max(...errors),unknownPixels:result.diagnostics.unknownPixels,syntheticQuality:fixture.syntheticQuality}));result.solver.dispose();
});

it('the global solution carries constraints across capture seams rather than independently solving each tile',async()=>{
  const fixture=reference.cases.find(item=>item.name==='wide-unknown')!,whole=await solve(fixture),tiled=await solve(fixture,7,3);
  expect(Math.max(...whole.alpha.map((value,i)=>Math.abs(value-tiled.alpha[i])))).toBeLessThanOrEqual(1);expect(tiled.alpha[4*fixture.width+32]).toBeGreaterThan(100);expect(tiled.alpha[4*fixture.width+32]).toBeLessThan(155);whole.solver.dispose();tiled.solver.dispose();
});

it('unconstrained components preserve genuine priors and reject without evidence; transparent hidden RGB is irrelevant',async()=>{
  const width=8,height=5,fixture:Fixture={name:'unconstrained',width,height,rgba:Array(width*height*4).fill(255),labels:Array(width*height).fill(128),alpha:[]};
  await expect(solve(fixture)).rejects.toThrow(/constraints/);const prior=Uint8Array.from({length:width*height},(_,i)=>i*5),result=await solve(fixture,width,height,prior);expect(result.alpha).toEqual(prior);expect(result.diagnostics.unresolvedPixels).toBe(width*height);result.solver.dispose();
  const padded=reference.cases.find(item=>item.name==='distant-native-patch')!,changed=structuredClone(padded);for(let i=0;i<changed.labels.length;i++)if(!changed.rgba[i*4+3]){changed.rgba[i*4]=37;changed.rgba[i*4+1]=195;changed.rgba[i*4+2]=249;}
  const first=await solve(padded,128,7),second=await solve(changed,128,7);expect(second.alpha).toEqual(first.alpha);first.solver.dispose();second.solver.dispose();
},30000);

it('graph allocation, incomplete coverage and nonconvergence reject instead of returning approximate success',async()=>{
  const fixture=reference.cases[1],tile=capture(fixture,0,0,fixture.width,fixture.height),prepared={...tile.request,...prepareMattingTile(tile.pixels,tile.request)};
  const budget=new ClosedFormMatting(fixture.width,fixture.height,0);expect(()=>budget.add(prepared)).toThrow(/working budget/);
  const incomplete=new ClosedFormMatting(fixture.width,fixture.height);await expect(incomplete.solve()).rejects.toThrow(/Incomplete/);
  const solver=new ClosedFormMatting(fixture.width,fixture.height);solver.add(prepared);await expect(solver.solve(undefined,0)).rejects.toThrow(/converge/);expect(()=>solver.sample(0,0)).toThrow(/not converged/);solver.dispose();
});

it('shared native workflow solves globally then streams actual matte PNG bytes and reports cancellable phases',async()=>{
  const fixture=reference.cases[1],settings=refineEdgeOptionsSchema.parse({trimapAssetId:'fixture',radius:10,smoothness:0}),phases:string[]=[],solver=new ClosedFormMatting(fixture.width,fixture.height),backend={async begin(){},async accumulate(pixels:Uint8ClampedArray,request:MattingTileRequest){solver.add({...request,...prepareMattingTile(pixels,request)});},async solve(progress?:(iteration:number,residual:number)=>void){return solver.solve(progress);},async tile(pixels:Uint8ClampedArray,request:MattingTileRequest){return refineMattingTile(kernel,pixels,request,solver);}};
  const output=await runMattingJob(fixture.width,fixture.height,settings,async region=>capture(fixture,region.x+region.core.x,region.y+region.core.y,region.core.width,region.core.height),backend,{onProgress:progress=>{if(progress.phase)phases.push(progress.phase);}});
  const image=openPngRows(new Uint8Array(await output.maskBlob.arrayBuffer())),alpha:number[]=[];for await(const strip of image.strips)for(let i=3;i<strip.pixels.length;i+=4)alpha.push(strip.pixels[i]);expect(Math.max(...alpha.map((value,i)=>Math.abs(value-fixture.alpha[i])))).toBeLessThanOrEqual(1);expect(new Set(phases)).toEqual(new Set(['capture','solve','encode']));solver.dispose();
  for(const bad of [{...output.diagnostics!,iterationBackend:'gpu'},{...output.diagnostics!,iterationBytes:-1},{...output.diagnostics!,iterationBackend:'wasm',iterationBytes:0},{...output.diagnostics!,iterationBytes:output.diagnostics!.estimatedGraphBytes+1},{...output.diagnostics!,iterations:2001},{...output.diagnostics!,relativeResidual:1e-4},{...output.diagnostics!,unresolvedPixels:fixture.width*fixture.height+1},{...output.diagnostics!,estimatedGraphBytes:-1},{...output.diagnostics!,preconditionerShift:Infinity},{...output.diagnostics!,coarseBlocks:fixture.width*fixture.height+1},{...output.diagnostics!,coarseBandwidth:-1},{...output.diagnostics!,coarseBytes:-1},{...output.diagnostics!,coarseRidge:Infinity},{...output.diagnostics!,coarseBlocks:1,coarseBandwidth:3,coarseBytes:1024,coarseRidge:1e-8,relativeResidual:1e-8}]){
    await expect(runMattingJob(fixture.width,fixture.height,settings,async region=>capture(fixture,region.x+region.core.x,region.y+region.core.y,region.core.width,region.core.height),{...backend,async begin(){},async accumulate(){},async solve(){return bad as Awaited<ReturnType<ClosedFormMatting['solve']>>;},async tile(){throw new Error('Invalid solver output reached encoding.');}})).rejects.toThrow(/Invalid closed-form solver result/);
  }
  const cancelled=new AbortController();await expect(runMattingJob(fixture.width,fixture.height,settings,async()=>{cancelled.abort();throw new Error('cancelled');},backend,{signal:cancelled.signal})).rejects.toThrow();
});


for(const preconditioner of ['ic0','jacobi'] as const)it(`actual WASM ${preconditioner} iterations retain the independently solved native matte across chunks`,async()=>{
  const fixture=reference.cases.find(item=>item.name==='distant-native-patch')!;
  const js=await solve(fixture,37,11,undefined,preconditioner),wasm=await solve(fixture,37,11,undefined,preconditioner,true);
  try{
    expect(wasm.diagnostics.iterationBackend).toBe('wasm');expect(wasm.diagnostics.iterationBytes).toBeGreaterThan(0);
    expect(wasm.diagnostics.estimatedGraphBytes).toBeLessThanOrEqual(192*1024*1024);
    expect(wasm.diagnostics.relativeResidual).toBeLessThanOrEqual(1e-9);
    expect(wasm.diagnostics.iterations).toBe(js.diagnostics.iterations);expect(wasm.alpha).toEqual(js.alpha);
    for(let i=0;i<fixture.alpha.length;i++)expect(Math.abs(wasm.alpha[i]-fixture.alpha[i])).toBeLessThanOrEqual(1);
  }finally{js.solver.dispose();wasm.solver.dispose();}
});

it('WASM scratch cannot shrink the original IC(0) graph capacity',async()=>{
  const fixture=reference.cases.find(item=>item.name==='distant-native-patch')!,budget=3*2048*644;
  const result=await solve(fixture,fixture.width,fixture.height,undefined,'ic0',true,budget);
  try{
    expect(result.diagnostics.iterationBackend).toBe('javascript');expect(result.diagnostics.iterationBytes).toBe(0);
    expect(result.diagnostics.preconditioner).toBe('ic0');expect(result.diagnostics.estimatedGraphBytes).toBe(budget);
    for(let i=0;i<fixture.alpha.length;i++)expect(Math.abs(result.alpha[i]-fixture.alpha[i])).toBeLessThanOrEqual(1);
  }finally{result.solver.dispose();}
});

for(const failAt of [1,2,4])it(`optional WASM growth failure at step ${failAt} retains the entire global JS solve`,async()=>{
  const fixture=reference.cases.find(item=>item.name==='distant-native-patch')!,nativeGrow=WebAssembly.Memory.prototype.grow;let calls=0;
  const spy=vi.spyOn(WebAssembly.Memory.prototype,'grow').mockImplementation(function(this:WebAssembly.Memory,pages:number){if(++calls===failAt)throw new RangeError('Injected optional WASM growth failure');return nativeGrow.call(this,pages);});
  try{
    const result=await solve(fixture,37,11,undefined,'ic0',true);
    try{
      expect(calls).toBe(failAt);expect(result.diagnostics.iterationBackend).toBe('javascript');expect(result.diagnostics.iterationBytes).toBeGreaterThan(0);
      expect(result.diagnostics.preconditioner).toBe('ic0');expect(result.diagnostics.relativeResidual).toBeLessThanOrEqual(1e-9);
      for(let i=0;i<fixture.alpha.length;i++)expect(Math.abs(result.alpha[i]-fixture.alpha[i])).toBeLessThanOrEqual(1);
    }finally{result.solver.dispose();}
  }finally{spy.mockRestore();}
});

it('unrelated pixel-kernel work cannot overwrite a long-lived matting graph',async()=>{
  const fixture=reference.cases.find(item=>item.name==='distant-native-patch')!,solver=new ClosedFormMatting(fixture.width,fixture.height),factory=wasmMattingIterations(kernel);
  const tile=capture(fixture,0,0,fixture.width,fixture.height);solver.add({...tile.request,...prepareMattingTile(tile.pixels,tile.request)});
  let interleaved=0;
  try{
    const diagnostics=await solver.solve(undefined,2000,'ic0',true,graph=>{
      const backend=factory(graph),multiply=backend.multiply!;
      return{...backend,multiply(input,output){new Uint8Array(kernel.memory.buffer).fill(237,kernel.bufferOffset());interleaved++;multiply(input,output);}};
    });
    expect(interleaved).toBeGreaterThan(1);expect(diagnostics.iterationBackend).toBe('wasm');
    for(let i=0;i<fixture.alpha.length;i++)if(fixture.labels[i]===128)expect(Math.abs(solver.sample(i%fixture.width,Math.floor(i/fixture.width))!.alpha-fixture.alpha[i])).toBeLessThanOrEqual(1);
  }finally{solver.dispose();}
});
