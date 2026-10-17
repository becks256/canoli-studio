import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Document,MarqueeSelection} from '../src/dom';
import {colorRangeOptionsSchema,colorRangeCoverage} from '../src/core/color-range';
import {instantiateKernel,applyColorRange,renderSelection,type PixelKernel} from '../src/engine/wasm';
import {SelectionRows} from '../src/core/selection-rows';
import {RecipeRecorder,executeRecipe} from '../src/ai/recipes';
let kernel:PixelKernel;
beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});

it('Color Range validates strict samples, sources, operations and finite fuzzy distances',()=>{
  expect(colorRangeOptionsSchema.parse({colors:['#ff0000']})).toEqual({colors:['#ff0000'],exclude:[],fuzziness:40,invert:false,operation:'replace',source:{kind:'merged'}});
  for(const options of [{colors:[]},{colors:['red']},{colors:['#fff']},{colors:['#ff000000']},{colors:Array(33).fill('#000000')},{colors:['#000000'],exclude:Array(33).fill('#000000')},{colors:['#000000'],fuzziness:201},{colors:['#000000'],fuzziness:NaN},{colors:['#000000'],operation:'xor'},{colors:['#000000'],source:{kind:'asset',assetId:'id',x:.5}},{colors:['#000000'],extra:true}])expect(()=>colorRangeOptionsSchema.parse(options)).toThrow();
});

it('native WASM selects exact and soft colors, exclusions and inverse among visible pixels without mutating source bytes',()=>{
  const pixels=new Uint8ClampedArray([255,0,0,255,255,0,0,128,255,0,0,0,0,0,255,64,0,255,0,255]);
  const original=pixels.slice();
  expect(Array.from(applyColorRange(kernel,pixels,{colors:['#ff0000'],fuzziness:0}))).toEqual([255,128,0,0,0]);
  expect(Array.from(applyColorRange(kernel,pixels,{colors:['#ff0000'],fuzziness:0,invert:true}))).toEqual([0,0,0,64,255]);
  expect(Array.from(applyColorRange(kernel,pixels,{colors:['#ff0000','#0000ff'],exclude:['#ff0000'],fuzziness:0}))).toEqual([0,0,0,64,0]);
  const soft=applyColorRange(kernel,new Uint8ClampedArray([128,128,128,255]),{colors:['#000000'],fuzziness:100});expect(soft[0]).toBeGreaterThan(0);expect(soft[0]).toBeLessThan(255);
  expect(pixels).toEqual(original);expect(()=>applyColorRange(kernel,new Uint8ClampedArray(3),{colors:['#000000']})).toThrow(/RGBA/);
  expect(applyColorRange(kernel,new Uint8ClampedArray(),{colors:['#000000']})).toHaveLength(0);
});

it('actual WASM matches a separate JS CIELAB oracle across random pixels, fuzzy boundaries, exclusions, alpha and memory growth',()=>{
  const pixels=new Uint8ClampedArray(65536*4);let seed=10485;for(let i=0;i<pixels.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[i]=seed>>>24;}
  const before=pixels.slice();
  for(const fuzziness of [0,.5,40,200])for(const invert of [false,true]){
    const settings={colors:['#ffffff','#ca2050','#32a018'],exclude:['#808080','#2030dc'],fuzziness,invert};
    const actual=applyColorRange(kernel,pixels,settings),reference=colorRangeCoverage(pixels,settings);
    expect(actual.findIndex((value,i)=>value!==reference[i]),JSON.stringify({fuzziness,invert})).toBe(-1);
  }
  expect(pixels).toEqual(before);
});

it('bounded scanline assembly retains fractional coverage, coalesces seams, rejects incomplete output and observes cancellation',async()=>{
  const rows=new SelectionRows({x:10,y:20,width:3,height:2});await rows.append(new Uint8Array([0,128]));await rows.append(new Uint8Array([128,255,0,0]));
  expect(rows.finish()).toEqual({regions:[{shape:'pixels',operation:'add',x:10,y:20,width:3,height:2,coverage:{width:3,height:2,runs:[1,0,3,128,4,255,6,0]}}]});
  const empty=new SelectionRows({x:0,y:0,width:2,height:1});expect(()=>empty.finish()).toThrow(/Incomplete/);await empty.append(new Uint8Array(2));expect(empty.finish()).toEqual({regions:[]});
  const abort=new SelectionRows({x:0,y:0,width:1,height:1});await expect(abort.append(new Uint8Array([255]),()=>{throw new Error('Cancelled');})).rejects.toThrow(/Cancelled/);
});

it('OOP color sampling commits once, shares Boolean operations, rejects stale/invalid/cancelled hosts and remains independent of artwork locks',async()=>{
  const doc=new Document({width:4,height:1});await expect(doc.selectColorRange({colors:['#ff0000']})).rejects.toThrow(/configured/);
  const pixels=new Uint8ClampedArray([255,0,0,255,0,0,255,255,255,0,0,128,0,0,0,0]);
  doc._prepareColorRange=async options=>{const rows=new SelectionRows({x:0,y:0,width:4,height:1});await rows.append(applyColorRange(kernel,pixels,options));return rows.finish();};
  const before=doc.toJSON(),revision=doc.getSnapshot().revision;await doc.selectColorRange({colors:['#ff0000'],fuzziness:0});
  expect(doc.getSnapshot().revision).toBe(revision+1);const selected=doc.toJSON();doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(selected);
  await doc.selectColorRange({colors:['#0000ff'],fuzziness:0,operation:'add'});
  expect(Array.from(renderSelection(kernel,{selection:doc.selection!.toJSON(),width:4,height:1,x:0,y:0,stepX:1,stepY:1})).filter((_,i)=>i%4===3)).toEqual([255,255,128,0]);
  const checkpoint=doc.getSnapshot(),abort=new AbortController();abort.abort();await expect(doc.selectColorRange({colors:['#ff0000']},{signal:abort.signal})).rejects.toThrow();expect(doc.getSnapshot()).toBe(checkpoint);
  let pending!:Promise<void>;doc.transaction('Sync',()=>{pending=doc.selectColorRange({colors:['#ff0000']});});await expect(pending).rejects.toThrow(/synchronous/);
  doc._prepareColorRange=async()=>({regions:[{}]} as any);await expect(doc.selectColorRange({colors:['#ff0000']})).rejects.toThrow();expect(doc.getSnapshot()).toBe(checkpoint);
  doc._prepareColorRange=async()=>{doc.name='Changed';return{regions:[]};};await expect(doc.selectColorRange({colors:['#ff0000']})).rejects.toThrow(/changed/);expect(doc.selection!.toJSON()).toEqual(checkpoint.document.selection);
});

it('color-range results record as portable coverage and replay offline in one undo entry',async()=>{
  const doc=new Document({width:4,height:1}),recorder=new RecipeRecorder();recorder.start();doc.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));
  doc._prepareColorRange=async()=>new MarqueeSelection({shape:'pixels',x:0,y:0,width:4,height:1,coverage:{width:4,height:1,runs:[2,255,4,0]}}).toJSON();
  await doc.selectColorRange({colors:['#ff0000']});const recipe=recorder.stop({name:'Color range'}),target=new Document({width:4,height:1});expect(executeRecipe(recipe,target).success).toBe(true);expect(target.selection!.toJSON()).toEqual(doc.selection!.toJSON());target.undo();expect(target.selection).toBe(null);
});

it('actual WASM agrees with independent Colour Science Lab/distance and fractional-alpha fixtures',async()=>{
  const fixture=JSON.parse(await readFile('tests/fixtures/color-range/reference.json','utf8'));
  expect(fixture.cases).toHaveLength(8);
  for(const entry of fixture.cases)expect(Array.from(applyColorRange(kernel,new Uint8ClampedArray(fixture.pixels),entry.options)),JSON.stringify(entry.options)).toEqual(entry.expected);
});

it('empty Color Range matches combine without throwing or changing nonintersected coverage',async()=>{
  const doc=new Document({width:4,height:1});doc._prepareColorRange=async()=>({regions:[]});
  const previous=new MarqueeSelection({shape:'pixels',x:0,y:0,width:4,height:1,coverage:{width:4,height:1,runs:[4,128]}});
  for(const operation of ['replace','add','subtract','intersect'] as const){
    doc.selection=previous;await doc.selectColorRange({colors:['#ff0000'],operation});
    const rgba=renderSelection(kernel,{selection:doc.selection!.toJSON(),width:4,height:1,x:0,y:0,stepX:1,stepY:1});
    expect([rgba[3],rgba[7],rgba[11],rgba[15]]).toEqual(Array(4).fill(operation==='add'||operation==='subtract'?128:0));
  }
});
