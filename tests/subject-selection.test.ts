import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Document,RasterLayer,LayerGroup,PaintLayer,MarqueeSelection,AffineTransform} from '../src/dom';
import {selectSubjectOptionsSchema,subjectSource} from '../src/core/subject-selection';
import {selectNativeSubject} from '../src/engine/subject-selection';
import {detectSalientSubject,maskToSelectionData} from '../src/intelligence/matting/segmentation';
import {instantiateKernel,renderSelection,type PixelKernel} from '../src/engine/wasm';
let kernel:PixelKernel;beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});
const raster=(selection:any,width:number,height:number)=>Array.from(renderSelection(kernel,{selection,width,height,x:0,y:0,stepX:1,stepY:1})).filter((_,i)=>i%4===3);

it('subject options are strict, finite and bounded, with no image-size policy',()=>{
  expect(selectSubjectOptionsSchema.parse({})).toEqual({threshold:.35,expandRadius:0});
  for(const value of [{threshold:NaN},{threshold:-1},{threshold:1.1},{expandRadius:.5},{expandRadius:65},{targetLayerId:''},{source:'fake'}])expect(()=>selectSubjectOptionsSchema.parse(value)).toThrow();
});

it('native saliency equals the independent JavaScript reference across texture, thresholds and disk expansion',async()=>{
  const width=37,height=23,pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const inside=x>3&&x<27&&y>3&&y<19&&!(x>10&&x<15&&y>8&&y<13);
    pixels.set(inside?[180+(x*3+y)%60,20+(x+y*7)%50,20,(x+y)%7===0?128:255]:[0,0,255,255],(y*width+x)*4);
  }
  const original=pixels.slice();
  for(const threshold of [.1,.35,.7,1])for(const expandRadius of [0,2]){
    const reference=detectSalientSubject(new Uint8Array(pixels),width,height,{threshold,expandRadius});
    const selection=await selectNativeSubject(kernel,pixels,{width,height,threshold,expandRadius});
    expect(raster(selection,width,height),JSON.stringify({threshold,expandRadius})).toEqual(Array.from(reference.mask));
  }
  expect(pixels).toEqual(original);
});

it('transparent cutouts retain disconnected thin structures, real holes and byte alpha',async()=>{
  const width=9,height=7,pixels=new Uint8ClampedArray(width*height*4),expected=Array(width*height).fill(0);
  for(const [x,y,a] of [[2,2,255],[3,2,128],[4,2,32],[2,3,255],[4,3,255],[2,4,255],[3,4,255],[4,4,255],[7,5,64]]){pixels.set([255,0,0,a],(y*width+x)*4);expected[y*width+x]=a;}
  const progress:any[]=[];const selection=await selectNativeSubject(kernel,pixels,{width,height,threshold:.35,expandRadius:0},value=>progress.push(value));
  expect(raster(selection,width,height)).toEqual(expected);expect(progress[0].completed).toBe(0);expect(progress.at(-1)).toEqual({completed:width*height*3,total:width*height*3});
});

it('transparent, uniform and malformed sources cannot fabricate foreground',async()=>{
  for(const alpha of [0,128,255]){
    const pixels=new Uint8ClampedArray(20*12*4);for(let i=0;i<pixels.length;i+=4)pixels.set([128,128,128,alpha],i);
    expect(await selectNativeSubject(kernel,pixels,{width:20,height:12,threshold:0,expandRadius:0})).toEqual({regions:[]});
  }
  await expect(selectNativeSubject(kernel,new Uint8ClampedArray(3),{width:1,height:1,threshold:.35,expandRadius:0})).rejects.toThrow(/geometry/);
  expect(maskToSelectionData(new Uint8Array(4),2,2,{x:10,y:20,width:2,height:2})).toEqual({regions:[]});
});

it('hidden RGB under zero alpha cannot change native subject evidence at neighboring visible pixels',async()=>{
  const width=32,height=24,pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.set(x>=8&&x<24&&y>=5&&y<20?[255,0,0,255]:[128,128,128,255],(y*width+x)*4);
  for(let y=10;y<15;y++)for(let x=13;x<18;x++)pixels.set([0,0,0,0],(y*width+x)*4);
  const hidden=pixels.slice();for(let i=0;i<hidden.length;i+=4)if(!hidden[i+3])hidden.set([255,255,255,0],i);
  for(const threshold of [.1,.35,.75,.9]){
    const left=await selectNativeSubject(kernel,pixels,{width,height,threshold,expandRadius:0});
    const right=await selectNativeSubject(kernel,hidden,{width,height,threshold,expandRadius:0});
    expect(raster(right,width,height),String(threshold)).toEqual(raster(left,width,height));
  }
});

it('target sampling separates original geometry from complete nested placement and rejects non-raster sources',()=>{
  const document=new Document({width:100,height:80}),group=document.layers.add(new LayerGroup({x:10,y:20}));
  group.transform=AffineTransform.translation(10,20).multiply(AffineTransform.rotation(Math.PI/2));
  const layer=group.layers.add(new RasterLayer({assetId:'source',width:20,height:12,x:3,y:4}));layer.visible=false;layer.locked=true;
  const source=subjectSource(document.toJSON(),selectSubjectOptionsSchema.parse({targetLayerId:layer.id}),()=>({id:'source',width:10,height:6}));
  const matrix=AffineTransform.fromJSON(source.transform);
  expect(matrix.point({x:2,y:1})).toEqual(group.transform.multiply(AffineTransform.translation(3,4)).multiply(AffineTransform.scale(2)).point({x:2,y:1}));
  expect(source).toMatchObject({width:10,height:6,assetId:'source'});
  const paint=document.layers.add(new PaintLayer());for(const id of [undefined,paint.id,'missing'])expect(()=>subjectSource(document.toJSON(),selectSubjectOptionsSchema.parse({targetLayerId:id}),()=>{throw new Error('Should not fetch');})).toThrow(/raster/);
});

it('OO subject selection owns options, commits once and rejects empty, stale, aborted or unconfigured hosts atomically',async()=>{
  const document=new Document({width:8,height:8}),layer=document.layers.add(new RasterLayer({assetId:'source',width:8,height:8}));document.selectedLayer=layer;
  await expect(document.selectSubject()).rejects.toThrow(/configured/);
  const selection=new MarqueeSelection({shape:'pixels',x:2,y:3,width:2,height:1,coverage:{width:2,height:1,runs:[1,255,2,128]}}).toJSON();
  const options={threshold:.35};let settings:any;
  document._prepareSubject=async input=>{settings=input;await Promise.resolve();return selection;};
  const before=document.toJSON(),pending=document.selectSubject(options);options.threshold=1;
  expect(await pending).toEqual(selection);expect(settings.threshold).toBe(.35);expect(settings.targetLayerId).toBe(layer.id);document.undo();expect(document.toJSON()).toEqual(before);document.redo();
  const retained=document.toJSON();document._prepareSubject=async()=>({regions:[]});await expect(document.selectSubject()).rejects.toThrow(/No foreground/);expect(document.toJSON()).toEqual(retained);
  document._prepareSubject=async()=>{document.name='Concurrent';return selection;};await expect(document.selectSubject()).rejects.toThrow(/changed/);expect(document.selection!.toJSON()).toEqual(selection);
  const abort=new AbortController();document._prepareSubject=async()=>{abort.abort();return selection;};await expect(document.selectSubject({}, {signal:abort.signal})).rejects.toThrow();
  let nested:Promise<unknown>|undefined;document.transaction('Invalid async',()=>{nested=document.selectSubject();});await expect(nested).rejects.toThrow(/transaction/);
});

it('a genuine working-memory allocation failure reports an operation limit without altering source bytes',async()=>{
  const pixels=new Uint8ClampedArray(300*300*4),before=pixels.slice();
  const constrained={...kernel,memory:new WebAssembly.Memory({initial:1,maximum:1}),bufferOffset:()=>16};
  await expect(selectNativeSubject(constrained,pixels,{width:300,height:300,threshold:.35,expandRadius:0})).rejects.toThrow(/working memory/);expect(pixels).toEqual(before);
});
