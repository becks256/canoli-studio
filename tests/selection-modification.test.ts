import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Document, MarqueeSelection } from '../src/dom';
import { encodeCoverage, coverageAt } from '../src/core/pixel-selection';
import { morphSelectionTile, modifySelectionCoverage } from '../src/engine/selection-modification';
import { instantiateKernel, renderSelection, featherAlpha, type PixelKernel } from '../src/engine/wasm';
import { selectionModificationSchema } from '../src/core/selection-modification';
import { AffineTransform } from '../src/core/affine';
import { RecipeRecorder, executeRecipe } from '../src/ai/recipes';
let kernel: PixelKernel;
beforeAll(async () => {
  const bytes=await readFile('public/wasm/pixels.wasm');
  kernel=await instantiateKernel(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
});
const alpha = (selection: ReturnType<MarqueeSelection['toJSON']>, x:number,y:number) => {
  const region=selection.regions[0];
  return region ? coverageAt(region.coverage!,x-region.x,y-region.y) : 0;
};

it('circular grayscale morphology agrees with an independent disk oracle', () => {
  const width=7,height=6,radius=3,padding=radius,sw=width+2*padding,sh=height+2*padding;
  const pixels=new Uint8ClampedArray(sw*sh*4);
  for(let i=0;i<sw*sh;i++)pixels[i*4+3]=(i*71+i%7*13)%256;
  const original=pixels.slice();
  for(const expand of [true,false]) {
    const actual=morphSelectionTile(pixels,sw,width,height,padding,radius,expand);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      let value=expand?0:255;
      for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)if(dx*dx+dy*dy<=radius*radius) {
        const a=pixels[((y+padding+dy)*sw+x+padding+dx)*4+3];
        value=expand?Math.max(value,a):Math.min(value,a);
      }
      expect(actual[y*width+x]).toBe(value);
    }
  }
  expect(pixels).toEqual(original);
});

it('native tiled coverage matches untiled WASM feather and disk references across seams', async () => {
  const w=1030,h=23;
  const ellipse=new MarqueeSelection({shape:'ellipse',x:498,y:2,width:35,height:18})
    .transformed(AffineTransform.rotation(0.013).around({x:515,y:10}));
  const selection=new MarqueeSelection({shape:'pixels',x:0,y:0,width:w,height:h,coverage:{width:1,height:1,runs:[1,0]}}).combine(ellipse).toJSON();
  const before=structuredClone(selection);
  for(const operation of ['expand','contract','feather'] as const) {
    const radius=4,padding=6,sw=w+2*padding,sh=h+2*padding;
    let input=renderSelection(kernel,{selection,width:sw,height:sh,x:-padding,y:-padding,stepX:1,stepY:1});
    for(let y=0;y<sh;y++)for(let x=0;x<sw;x++)if(x<padding||x>=w+padding||y<padding||y>=h+padding) input[(y*sw+x)*4+3]=0;
    let reference:Uint8Array|undefined;
    if(operation==='feather')input=featherAlpha(kernel,input,{width:sw,height:sh,radiusX:radius/3,radiusY:radius/3});
    else reference=morphSelectionTile(input,sw,w,h,padding,radius,operation==='expand');
    const actual=await modifySelectionCoverage(kernel,{selection,width:w,height:h,operation,radius});
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)
      expect(alpha(actual,x,y)).toBe(reference?reference[y*w+x]:input[((y+padding)*sw+x+padding)*4+3]);
  }
  expect(selection).toEqual(before);
});

it('keeps partial coverage and canvas boundaries and represents an emptied contraction explicitly', async () => {
  const selection=new MarqueeSelection({shape:'pixels',x:0,y:0,width:3,height:3,coverage:encodeCoverage(new Uint8Array([255,128,0,255,64,0,0,0,0]),3,3)}).toJSON();
  const expanded=await modifySelectionCoverage(kernel,{selection,width:9,height:9,operation:'expand',radius:1});
  expect(alpha(expanded,0,0)).toBe(255);
  expect(alpha(expanded,2,0)).toBe(128);
  expect(alpha(expanded,2,1)).toBe(64);
  expect(alpha(expanded,3,1)).toBe(0);
  const contracted=await modifySelectionCoverage(kernel,{selection,width:9,height:9,operation:'contract',radius:3});
  expect(contracted).toEqual({regions:[]});
  expect(await modifySelectionCoverage(kernel,{selection:{regions:[]},width:9,height:9,operation:'expand',radius:3})).toEqual({regions:[]});
});

it('combines all Boolean regions before modifying coverage and reports actual tile progress', async () => {
  const selection=new MarqueeSelection({shape:'rectangle',x:0,y:0,width:1030,height:40})
    .combine(new MarqueeSelection({shape:'rectangle',x:510,y:10,width:10,height:10}),'subtract').toJSON();
  const progress:{completed:number;total:number}[]=[];
  const result=await modifySelectionCoverage(kernel,{selection,width:1030,height:40,operation:'expand',radius:2},value=>progress.push(value));
  expect(alpha(result,511,12)).toBe(255);
  expect(alpha(result,514,14)).toBe(0);
  expect(progress[0]).toEqual({completed:0,total:3});
  expect(progress.at(-1)).toEqual({completed:3,total:3});
});

it('validates options and rejects missing host/selection, stale output, cancellation and bad host coverage atomically', async () => {
  for(const options of [{operation:'expand',radius:0},{operation:'contract',radius:1.5},{operation:'feather',radius:129},{operation:'grow',radius:1},{operation:'expand',radius:2,extra:true}])
    expect(()=>selectionModificationSchema.parse(options)).toThrow();
  const document=new Document({width:10,height:10});
  await expect(document.modifySelection({operation:'expand',radius:1})).rejects.toThrow(/selection first/);
  document.selectAll();
  await expect(document.modifySelection({operation:'expand',radius:1})).rejects.toThrow(/configured/);
  document._prepareSelectionModification=async()=>({regions:[]});
  const before=document.getSnapshot();
  let pending!:Promise<void>;
  document.transaction('Synchronous only',()=>{ pending=document.modifySelection({operation:'expand',radius:1}); });
  await expect(pending).rejects.toThrow(/synchronous/);
  const abort=new AbortController();abort.abort();
  await expect(document.modifySelection({operation:'expand',radius:1},{signal:abort.signal})).rejects.toThrow();
  expect(document.getSnapshot().document.selection).toEqual(before.document.selection);
  document._prepareSelectionModification=async()=>{document.name='Changed';return{regions:[]};};
  await expect(document.modifySelection({operation:'expand',radius:1})).rejects.toThrow(/changed/);
  expect(document.selection!.regions).toHaveLength(1);
  const current=document.getSnapshot();
  document._prepareSelectionModification=async()=>({regions:[{}]} as any);
  await expect(document.modifySelection({operation:'expand',radius:1})).rejects.toThrow();
  expect(document.getSnapshot()).toBe(current);
});

it('successful preparation commits once, preserves source coverage and round-trips undo/redo',async()=>{
  const document=new Document({width:20,height:20});document.selectAll();
  const before=document.getSnapshot();
  document._prepareSelectionModification=options=>modifySelectionCoverage(kernel,{...options,selection:document.selection!.toJSON(),width:20,height:20});
  await document.modifySelection({operation:'contract',radius:2});
  const after=document.getSnapshot();
  expect(after.past.length).toBe(before.past.length+1);
  expect(alpha(after.document.selection!,0,0)).toBe(0);
  expect(alpha(after.document.selection!,5,5)).toBe(255);
  document.undo();expect(document.selection!.toJSON()).toEqual(before.document.selection);
  document.redo();expect(document.selection!.toJSON()).toEqual(after.document.selection);
});

it('recorded modified coverage replays exactly offline without a preparation host',async()=>{
  const document=new Document({width:32,height:32});
  document.selection=new MarqueeSelection({shape:'ellipse',x:10,y:10,width:12,height:12});
  document._prepareSelectionModification=options=>modifySelectionCoverage(kernel,{...options,selection:document.selection!.toJSON(),width:32,height:32});
  const recorder=new RecipeRecorder();recorder.start();
  document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));
  await document.modifySelection({operation:'feather',radius:4});
  const recipe=recorder.stop({name:'Reusable soft selection'});
  const offline=new Document({width:32,height:32});
  expect(executeRecipe(recipe,offline).success).toBe(true);
  expect(offline.selection!.toJSON()).toEqual(document.selection!.toJSON());
  offline.undo();expect(offline.selection).toBeNull();
  offline.redo();expect(offline.selection!.toJSON()).toEqual(document.selection!.toJSON());
});
