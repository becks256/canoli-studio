import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Document,MarqueeSelection} from '../src/dom';
import {quickSelectionOptionsSchema,quickSelectionRequestSchema,quickSelectionSeeds,type QuickSelectionOptions} from '../src/core/quick-selection';
import {growQuickSelection} from '../src/engine/quick-selection';
import {instantiateKernel,renderSelection,type PixelKernel} from '../src/engine/wasm';
import {RecipeRecorder,executeRecipe} from '../src/ai/recipes';
let kernel:PixelKernel;beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});
const request=(options:QuickSelectionOptions,width:number,height:number)=>quickSelectionRequestSchema.parse({...options,x:0,y:0,width,height});
const alpha=(selection:any,width:number,height:number)=>Array.from(renderSelection(kernel,{selection,width,height,x:0,y:0,stepX:1,stepY:1})).filter((_,i)=>i%4===3);

it('Quick Selection strictly validates sources, brush points and finite control values and clips distant strokes before sampling',()=>{
  const defaults=quickSelectionOptionsSchema.parse({points:[{x:1,y:2}]});expect(defaults).toMatchObject({size:32,tolerance:32,edgeThreshold:64,operation:'add',source:{kind:'merged'}});
  for(const options of [{points:[]},{points:[{x:NaN,y:0}]},{points:[{x:0,y:0}],size:0},{points:[{x:0,y:0}],edgeThreshold:256},{points:[{x:0,y:0}],source:{kind:'layer'}},{points:[{x:0,y:0}],extra:true}])expect(()=>quickSelectionOptionsSchema.parse(options)).toThrow();
  const clipped=quickSelectionSeeds(request({points:[{x:-1e12,y:.5},{x:1e12,y:.5}],size:.5},8,1));expect(Array.from(clipped)).toEqual([0,8]);
});

it('actual WASM follows nonrectangular connected shapes, respects holes and transparency, and preserves disconnected source colors',async()=>{
  const width=8,height=5,pixels=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++)pixels.set([0,0,255,255],i*4);
  for(let y=0;y<4;y++)for(let x=0;x<4;x++)pixels.set([255,0,0,255],(y*width+x)*4);
  pixels.set([0,0,255,255],(width+1)*4);pixels.set([255,0,0,0],(width+2)*4);pixels.set([255,0,0,128],(2*width+1)*4);pixels.set([255,0,0,255],(4*width+7)*4);
  const original=pixels.slice(),progress:{completed:number;total:number}[]=[];
  const selection=await growQuickSelection(kernel,pixels,request({points:[{x:.5,y:.5}],size:.5,tolerance:0,edgeThreshold:64},width,height),value=>progress.push(value));
  const expected=Array(width*height).fill(0);for(let y=0;y<4;y++)for(let x=0;x<4;x++)expected[y*width+x]=255;expected[width+1]=expected[width+2]=0;expected[2*width+1]=128;
  expect(alpha(selection,width,height)).toEqual(expected);expect(pixels).toEqual(original);expect(progress[0].completed).toBe(0);expect(progress.at(-1)).toEqual({completed:80,total:80});
});

it('local edges prevent weak global-color drift and sampled variation admits texture beyond the painted pixels',async()=>{
  const pixels=new Uint8ClampedArray([0,10,20,30,40,50,60,70].flatMap(value=>[value,20,30,255]));
  for(const edgeThreshold of [9,10]){
    const selected=await growQuickSelection(kernel,pixels,request({points:[{x:.5,y:.5}],size:.5,tolerance:255,edgeThreshold},8,1));expect(alpha(selected,8,1)).toEqual(edgeThreshold===9?[255,0,0,0,0,0,0,0]:Array(8).fill(255));
  }
  const texture=new Uint8ClampedArray([40,80,100,110,0,255,40,40].flatMap(value=>[value,20,30,255]));
  const selected=await growQuickSelection(kernel,texture,request({points:[{x:.5,y:.5},{x:1.5,y:.5}],size:.5,tolerance:0},8,1));expect(alpha(selected,8,1)).toEqual([255,255,255,0,0,0,0,0]);
});

it('scanline WASM agrees with an independent pixel-queue graph oracle across seeds, edge limits and semi-transparent texture',async()=>{
  const width=31,height=19,pixels=new Uint8ClampedArray(width*height*4);let seed=47;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.set([30+x*4+(seed>>>29),40+y*5,(x+y)%6*20,seed%17?seed%3?255:128:0],(y*width+x)*4);}
  for(const tolerance of [0,25,100])for(const edgeThreshold of [0,32,255]){
    const settings=request({points:[{x:5.5,y:7.5},{x:10.5,y:10.5}],size:3,tolerance,edgeThreshold},width,height),spans=quickSelectionSeeds(settings),forced=new Set<number>();
    for(let s=0;s<spans.length;s+=2)for(let i=spans[s];i<spans[s+1];i++)if(pixels[i*4+3])forced.add(i);
    const samples=[...forced],mean=[0,1,2].map(c=>samples.reduce((sum,i)=>sum+pixels[i*4+c],0)/samples.length),limits=mean.map((m,c)=>tolerance+2*Math.sqrt(Math.max(0,samples.reduce((sum,i)=>sum+pixels[i*4+c]**2,0)/samples.length-m*m)));
    const seen=new Set(samples),queue=[...samples];
    for(let q=0;q<queue.length;q++){
      const i=queue[q],x=i%width,y=Math.floor(i/width);
      for(const next of [x?i-1:-1,x<width-1?i+1:-1,y?i-width:-1,y<height-1?i+width:-1]){
        if(next<0||seen.has(next)||!pixels[next*4+3])continue;
        if(!forced.has(next)&&mean.some((m,c)=>Math.abs(pixels[next*4+c]-m)>limits[c]))continue;
        if([0,1,2].some(c=>Math.abs(pixels[next*4+c]-pixels[i*4+c])>edgeThreshold))continue;
        seen.add(next);queue.push(next);
      }
    }
    const selected=await growQuickSelection(kernel,pixels,settings);expect(alpha(selected,width,height),JSON.stringify({tolerance,edgeThreshold})).toEqual(Array.from({length:width*height},(_,i)=>seen.has(i)?pixels[i*4+3]:0));
  }
});

it('resumable native frontier batches retain more than 4096 isolated painted runs',async()=>{
  const width=9001,pixels=new Uint8ClampedArray(Array.from({length:width},(_,i)=>[i%2?0:255,0,0,255]).flat());
  const selected=await growQuickSelection(kernel,pixels,request({points:[{x:.5,y:.5},{x:width-.5,y:.5}],size:.5,edgeThreshold:0},width,1));expect(alpha(selected,width,1)).toEqual(Array(width).fill(255));
});

it('OO Quick Selection is atomic, owns options, shares Boolean history and rejects stale/cancelled/invalid hosts',async()=>{
  const doc=new Document({width:4,height:1}),options={points:[{x:0,y:0}],size:1};await expect(doc.selectQuickSelection(options)).rejects.toThrow(/host/);
  const coverage=new MarqueeSelection({shape:'pixels',x:0,y:0,width:4,height:1,coverage:{width:4,height:1,runs:[4,128]}}).toJSON();let copied:any;
  doc._prepareQuickSelection=async settings=>{copied=settings;return coverage;};const before=doc.toJSON();await doc.selectQuickSelection(options);expect(alpha(doc.selection!.toJSON(),4,1)).toEqual([128,128,128,128]);doc.undo();expect(doc.toJSON()).toEqual(before);
  const pending=doc.selectQuickSelection(options);options.points[0].x=9;await pending;expect(copied.points[0].x).toBe(0);
  await doc.selectQuickSelection({points:[{x:0,y:0}],operation:'subtract'});expect(alpha(doc.selection!.toJSON(),4,1)).toEqual([64,64,64,64]);
  const checkpoint=doc.toJSON(),abort=new AbortController();abort.abort();await expect(doc.selectQuickSelection(options,{signal:abort.signal})).rejects.toThrow();expect(doc.toJSON()).toEqual(checkpoint);
  let sync!:Promise<void>;doc.transaction('Sync',()=>{sync=doc.selectQuickSelection(options);});await expect(sync).rejects.toThrow(/synchronous/);
  doc._prepareQuickSelection=async()=>({regions:[{}]} as any);await expect(doc.selectQuickSelection(options)).rejects.toThrow();expect(doc.toJSON()).toEqual(checkpoint);
  doc._prepareQuickSelection=async()=>{doc.name='Concurrent';return coverage;};await expect(doc.selectQuickSelection(options)).rejects.toThrow(/changed/);expect(doc.selection!.toJSON()).toEqual(checkpoint.selection);
});

it('loaded native Quick Selection coverage replays offline through ordinary selection recipes',async()=>{
  const doc=new Document({width:4,height:1}),recorder=new RecipeRecorder();doc._prepareQuickSelection=async()=>new MarqueeSelection({shape:'rectangle',x:0,y:0,width:2,height:1}).toJSON();recorder.start();doc.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));await doc.selectQuickSelection({points:[{x:0,y:0}]});const recipe=recorder.stop({name:'Quick'}),target=new Document({width:4,height:1});expect(executeRecipe(recipe,target).success).toBe(true);expect(target.selection!.toJSON()).toEqual(doc.selection!.toJSON());target.undo();expect(target.selection).toBe(null);
});

it('invisible or off-canvas seeds and malformed native buffers fail without fabricating coverage',async()=>{
  await expect(growQuickSelection(kernel,new Uint8ClampedArray(16),request({points:[{x:0,y:0}]},2,2))).rejects.toThrow(/visible/);
  await expect(growQuickSelection(kernel,new Uint8ClampedArray([255,0,0,255]),request({points:[{x:100,y:100}],size:1},1,1))).rejects.toThrow(/visible/);
  await expect(growQuickSelection(kernel,new Uint8ClampedArray(3),request({points:[{x:0,y:0}]},1,1))).rejects.toThrow(/geometry/);
});
