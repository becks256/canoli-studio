import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Document,AdjustmentLayer,defaultColorBalanceAdjustment,defaultVibranceAdjustment,LayerMask,MarqueeSelection} from '../src/dom';
import {adjustChromatic} from '../src/engine/chromatic';
import {instantiateKernel,applyChromatic,type PixelKernel} from '../src/engine/wasm';
import {validateDocument} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {RecipeRecorder,executeRecipe} from '../src/ai/recipes';
let kernel:PixelKernel;
beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});

it('neutral defaults are byte-exact and color balance has independent tonal ranges',()=>{
  const source=new Uint8ClampedArray([0,0,0,0,64,64,64,128,128,128,128,255,192,192,192,1,255,255,255,255]);
  for(const setting of [defaultColorBalanceAdjustment(),defaultVibranceAdjustment()])expect(adjustChromatic(source,setting)).toEqual(source);
  for(const range of ['shadows','midtones','highlights'] as const){
    const setting=defaultColorBalanceAdjustment();setting[range].red=20;setting.preserveLuminosity=false;
    const result=adjustChromatic(source,setting);
    expect(result[3]).toBe(0);expect(result[7]).toBe(128);expect(result[15]).toBe(1);
    if(range==='shadows'){expect(result[0]).toBe(51);expect(result[12]).toBe(192);}
    if(range==='midtones'){expect(result[0]).toBe(0);expect(result[8]).toBe(179);expect(result[16]).toBe(255);}
    if(range==='highlights'){expect(result[4]).toBe(64);expect(result[12]).toBeGreaterThan(192);}
  }
});

it('preserved luminosity stays within byte rounding and vibrance avoids neutral/hue inversion',()=>{
  const source=new Uint8ClampedArray([80,120,150,128,40,40,40,255,255,0,0,64,0,0,0,0,255,255,255,255]);
  const balance=defaultColorBalanceAdjustment();balance.midtones={red:70,green:-40,blue:80};balance.highlights={red:-100,green:90,blue:10};
  const output=adjustChromatic(source,balance);
  for(let i=0;i<source.length;i+=4){
    const y=(p:Uint8ClampedArray)=>.3*p[i]+.59*p[i+1]+.11*p[i+2];
    expect(Math.abs(y(output)-y(source))).toBeLessThanOrEqual(.51);
    expect(output[i+3]).toBe(source[i+3]);
  }
  const vibrant=adjustChromatic(source,{kind:'vibrance',vibrance:100,saturation:0});
  expect([...vibrant.slice(4,8)]).toEqual([40,40,40,255]);
  expect([...vibrant.slice(8,12)]).toEqual([255,0,0,64]);
  expect(vibrant[2]-vibrant[0]).toBeGreaterThan(source[2]-source[0]);
  const grey=adjustChromatic(source,{kind:'vibrance',vibrance:-100,saturation:-100});
  expect(grey[0]).toBe(grey[1]);expect(grey[1]).toBe(grey[2]);
});

it('actual WASM matches independent JS reference across extrema, alpha and memory growth',()=>{
  const input=new Uint8ClampedArray(65536*4);let seed=129;
  for(let i=0;i<input.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;input[i]=seed>>>24;}
  const before=input.slice();
  const balance=defaultColorBalanceAdjustment();balance.shadows={red:100,green:-100,blue:13};balance.midtones={red:-80,green:29,blue:90};balance.highlights={red:17,green:100,blue:-100};
  for(const settings of [defaultColorBalanceAdjustment(),defaultVibranceAdjustment(),balance,{...balance,preserveLuminosity:false},...[-100,0,100].flatMap(vibrance=>[-100,0,100].map(saturation=>({kind:'vibrance' as const,vibrance,saturation})))]){
    const expected=adjustChromatic(input,settings),actual=applyChromatic(kernel,input,settings);
    const mismatch=actual.findIndex((v,i)=>v!==expected[i]);expect(mismatch,JSON.stringify({settings,mismatch,actual:actual[mismatch],expected:expected[mismatch]})).toBe(-1);
  }
  expect(input).toEqual(before);
  expect(()=>applyChromatic(kernel,new Uint8ClampedArray(3),balance)).toThrow(/RGBA/);
});

it('chromatic layers persist in the current schema, upgrade v17 and reject mislabeled legacy data',()=>{
  const doc=new Document({width:20,height:20});
  const original=doc.getSnapshot();
  const layer=doc.layers.add(new AdjustmentLayer({adjustment:defaultColorBalanceAdjustment()}));
  layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:10,height:20})});
  const before=doc.toJSON();expect(before.schemaVersion).toBe(43);
  expect(()=>validateDocument({...before,schemaVersion:16})).toThrow(/schema version 17/);
  expect(Document.fromJSON(before).toJSON()).toEqual(before);
  expect(Document.fromJSON({...before,schemaVersion:17}).toJSON()).toEqual(before);
  const legacy={...original.document,schemaVersion:16};expect(Document.fromJSON(legacy).toJSON().schemaVersion).toBe(43);
  layer.adjustment={kind:'vibrance',vibrance:63,saturation:-10};doc.undo();expect(layer.adjustment.kind).toBe('color-balance');doc.redo();expect(layer.adjustment.kind).toBe('vibrance');
  const checkpoint=doc.getSnapshot();
  for(const value of [{kind:'vibrance',vibrance:101,saturation:0},{...defaultColorBalanceAdjustment(),midtones:{red:0,green:0,blue:NaN}},{...defaultColorBalanceAdjustment(),extra:1}]){
    expect(()=>{layer.adjustment=value as any;}).toThrow();expect(doc.getSnapshot()).toBe(checkpoint);
  }
  layer.locked=true;expect(()=>{layer.adjustment=defaultColorBalanceAdjustment();}).toThrow(/lock/i);
});

it('validated REST commands and recorded recipes preserve nested parameters with atomic rollback',()=>{
  const doc=new Document(),recorder=new RecipeRecorder();recorder.start();
  doc.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));
  const layer=doc.layers.add(new AdjustmentLayer({adjustment:defaultColorBalanceAdjustment()}));
  const settings=defaultColorBalanceAdjustment();settings.midtones.red=38;
  layer.adjustment=settings;settings.midtones.red=-90;
  expect((layer.adjustment as typeof settings).midtones.red).toBe(38);
  const recipe=recorder.stop({name:'Balance'}),target=new Document();
  expect(executeRecipe(recipe,target).success).toBe(true);
  expect((target.layers.at(0) as AdjustmentLayer).adjustment).toEqual(layer.adjustment);
  expect(()=>parseCommands([{type:'layer.update',id:layer.id,patch:{adjustment:{kind:'vibrance',vibrance:0,saturation:0,extra:true}}}])).toThrow();
  const before=doc.getSnapshot();expect(()=>doc.transaction('Bad edit',()=>{layer.adjustment=defaultVibranceAdjustment();doc.resize(-1,1);})).toThrow();expect(doc.getSnapshot()).toBe(before);
});
