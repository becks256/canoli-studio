import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Document, AdjustmentLayer, RedEyeAdjustment, LayerGroup, MarqueeSelection, AffineTransform } from '../src/dom';
import { defaultRedEyeAdjustment, redEyeAdjustmentSchema } from '../src/core/red-eye';
import { selectionRegionTransform } from '../src/core/drawing';
import { validateDocument } from '../src/core/model';
import { parseCommands } from '../src/core/validation';
import { computeAdjustmentLuts } from '../src/core/adjustments';
import { instantiateKernel, applyRedEye, type PixelKernel } from '../src/engine/wasm';
import { RecipeRecorder, executeRecipe } from '../src/ai/recipes';

let kernel: PixelKernel;
beforeAll(async () => { kernel = await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))); });

it('corrects red-dominant pixels at the threshold, protects neutrals and preserves G/B/alpha and source bytes', () => {
  const source = new Uint8ClampedArray([220,20,40,255, 64,32,16,128, 63,32,16,255, 255,255,255,255, 20,40,20,1, 220,20,40,0]);
  const copy = source.slice(), settings = defaultRedEyeAdjustment();
  expect([...applyRedEye(kernel, source, settings)]).toEqual([30,20,40,255, 24,32,16,128, 63,32,16,255, 255,255,255,255, 20,40,20,1, 220,20,40,0]);
  expect([...applyRedEye(kernel, source, {...settings, strength:50}).slice(0,4)]).toEqual([125,20,40,255]);
  expect(applyRedEye(kernel, source, {...settings, strength:0})).toEqual(copy);
  expect([...applyRedEye(kernel, source, {...settings, threshold:32.01}).slice(4,8)]).toEqual([64,32,16,128]);
  expect(source).toEqual(copy);
  expect(() => computeAdjustmentLuts(settings)).toThrow(/cross-channel/);
});

it('actual WASM matches an independent weighted-channel oracle across a seeded corpus and memory growth', () => {
  const source = new Uint8ClampedArray(65536*4);let seed=62917;
  for(let i=0;i<source.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;source[i]=seed>>>24;}
  const original=source.slice();
  for(const threshold of [0,.001,31.999,32,32.001,255])for(const strength of [0,25,50,100]){
    const actual=applyRedEye(kernel,source,{kind:'red-eye',threshold,strength});
    for(let i=0;i<source.length;i+=4){
      const [r,g,b,a]=source.subarray(i,i+4),active=a>0&&r>g&&r>b&&r-g>=threshold&&r-b>=threshold;
      const expected=active?Math.round((2*r*(100-strength)+(g+b)*strength)/200):r;
      if(actual[i]!==expected||actual[i+1]!==g||actual[i+2]!==b||actual[i+3]!==a)throw new Error(`Mismatch ${i}/${threshold}/${strength}`);
    }
  }
  expect(source).toEqual(original);
  expect(() => applyRedEye(kernel,new Uint8ClampedArray(3),defaultRedEyeAdjustment())).toThrow(/RGBA/);
  expect(applyRedEye(kernel,new Uint8ClampedArray(),defaultRedEyeAdjustment())).toHaveLength(0);
});

it('captures a borrowed WASM view before growth and returns output independent of future kernel work', () => {
  const view=new Uint8ClampedArray(kernel.memory.buffer,kernel.bufferOffset(),4);view.set([220,20,40,255]);
  const oldSize=kernel.memory.buffer.byteLength;
  const result=applyRedEye({...kernel,bufferOffset:()=>oldSize},view,defaultRedEyeAdjustment());
  expect(kernel.memory.buffer.byteLength).toBeGreaterThan(oldSize);expect([...result]).toEqual([30,20,40,255]);
  applyRedEye(kernel,new Uint8ClampedArray([255,0,0,255]),defaultRedEyeAdjustment());
  expect([...result]).toEqual([30,20,40,255]);
});

it('immutable constructors, strict commands, ancestral locks and failed transactions share validation and history', () => {
  const settings=new RedEyeAdjustment(),values=settings.toJSON();values.strength=0;
  expect(settings.strength).toBe(100);expect(settings.threshold).toBe(32);expect(Object.isFrozen(settings)).toBe(true);
  for(const options of [null,{threshold:null},{threshold:-1},{threshold:256},{strength:101},{strength:NaN},{strength:Infinity},{extra:1}])expect(()=>new RedEyeAdjustment(options as any)).toThrow();
  expect(new RedEyeAdjustment({strength:undefined}).toJSON()).toEqual(defaultRedEyeAdjustment());
  const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new AdjustmentLayer({adjustment:settings}));
  const before=doc.toJSON(),checkpoint=doc.getSnapshot();
  for(const adjustment of [{kind:'red-eye',strength:100}, {...settings.toJSON(),extra:true},{...settings.toJSON(),strength:null}]){
    expect(()=>redEyeAdjustmentSchema.parse(adjustment)).toThrow();expect(()=>parseCommands([{type:'layer.update',id:layer.id,patch:{adjustment}}])).toThrow();
    expect(()=>{layer.adjustment=adjustment as any;}).toThrow();expect(doc.getSnapshot()).toBe(checkpoint);
  }
  layer.setRedEye(new RedEyeAdjustment({threshold:64,strength:50}));doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect((layer.adjustment as any).strength).toBe(50);
  const stable=doc.getSnapshot();expect(()=>doc.transaction('Bad correction',()=>{layer.setRedEye(settings);doc.resize(-1,1);})).toThrow();expect(doc.getSnapshot()).toBe(stable);
  group.locked=true;expect(()=>layer.setRedEye(settings)).toThrow(/lock/i);expect(()=>layer.setRedEye({} as any)).toThrow(/RedEyeAdjustment/);
});

it('selection masks inverse-map into transformed parents, commit with creation once, and survive versioned restoration', () => {
  const doc=new Document(),group=doc.layers.add(new LayerGroup({x:10,y:20}));
  group.transform=new AffineTransform(2,0,0,2,10,20);
  const before=doc.toJSON(),past=doc.getSnapshot().past.length,layer=new AdjustmentLayer({adjustment:new RedEyeAdjustment()});
  doc.transaction('Correct pupils',()=>{group.layers.add(layer);layer.maskFromSelection(new MarqueeSelection({shape:'rectangle',x:14,y:24,width:8,height:8}));});
  expect(doc.getSnapshot().past).toHaveLength(past+1);
  const saved=doc.toJSON();expect(saved.schemaVersion).toBe(43);expect(Document.fromJSON(saved).toJSON()).toEqual(saved);
  const mask=layer.mask!.toJSON();if(mask.kind!=='selection')throw new Error('Expected selection mask');
  const region=mask.selection.regions[0],basis=selectionRegionTransform(region);
  expect(basis.point({x:region.x,y:region.y})).toEqual({x:2,y:2});
  expect(basis.point({x:region.x+region.width,y:region.y+region.height})).toEqual({x:6,y:6});
  for(let schemaVersion=1;schemaVersion<=34;schemaVersion++)expect(()=>validateDocument({...saved,schemaVersion})).toThrow();
  doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(saved);
  expect(Document.fromJSON({...before,schemaVersion:34}).toJSON().schemaVersion).toBe(43);
});

it('rejects old-labelled red-eye records inside embedded masters, including immutable cached definitions', () => {
  const doc=new Document(),master=new Document();master.layers.add(new AdjustmentLayer({adjustment:new RedEyeAdjustment()}));
  const componentId=doc.defineComponent(master);doc.placeSmartObject(componentId);
  const snapshot=doc.toJSON();validateDocument(snapshot);validateDocument(doc.getSnapshot().document);
  const old=structuredClone(snapshot);(old.components![0].source as any).document.schemaVersion=34;
  expect(()=>validateDocument(old)).toThrow(/schema version 35/);
  expect(Document.fromJSON(snapshot).toJSON()).toEqual(snapshot);
});

it('records correction and editable masks for deterministic offline recipe replay in one undo step', () => {
  const doc=new Document(),recorder=new RecipeRecorder();recorder.start();doc.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));
  const layer=doc.layers.add(new AdjustmentLayer({adjustment:new RedEyeAdjustment({strength:75})}));
  layer.maskFromSelection(new MarqueeSelection({shape:'ellipse',x:4,y:8,width:10,height:10}));
  const target=new Document(),recipe=recorder.stop({name:'Pupil correction'});expect(executeRecipe(recipe,target).success).toBe(true);
  expect((target.layers.at(0) as AdjustmentLayer).adjustment).toEqual(layer.adjustment);expect(target.layers.at(0)!.mask!.toJSON()).toEqual(layer.mask!.toJSON());
  target.undo();expect(target.layers.length).toBe(0);
});
