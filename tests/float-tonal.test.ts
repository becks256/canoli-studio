import {beforeAll, expect, it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {FloatPixelProcessor} from '../src/engine/float-pixels';
import {applyFloatTonal} from '../src/engine/float-tonal';
import {instantiateKernel} from '../src/engine/wasm';
import {floatTonalOptionsSchema, type FloatTonalOptions} from '../src/core/float-tonal';
import {Document, RasterLayer, AdjustmentLayer, TonalStroke, BrushStroke, PaintLayer} from '../src/dom';
import {parseCommands} from '../src/core/validation';
import {RecipeRecorder} from '../src/ai/recipes/recorder';

const directory='tests/fixtures/float-tonal/';
const manifest=JSON.parse(await readFile(directory+'manifest.json','utf8')) as {cases:{options:FloatTonalOptions;reference:string}[];files:Record<string,{sha256:string;bytes:number}>;tolerance:number;generatorSha256:string};
const floats=(bytes:Uint8Array)=>new Float32Array(new Uint8Array(bytes).buffer);
const words=(value:Float32Array)=>new Uint32Array(value.buffer,value.byteOffset,value.length);
let native:FloatPixelProcessor;
beforeAll(async()=>{native=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));});

it('precision source rebinding is atomic, preserves frozen history and rejects invalid replacements',()=>{
  const document=new Document(),raster=document.layers.add(new RasterLayer({assetId:'byte-original',width:16,height:16})),before=document.toJSON();
  const command={type:'document.precision.float' as const,sources:[{layerId:raster.id,assetId:'native-original'}]};
  for(const sources of [[{layerId:'missing',assetId:'bad'}],[...command.sources,...command.sources],[{layerId:raster.id,assetId:''}]]){expect(()=>document._dispatch({...command,sources})).toThrow();expect(document.toJSON()).toEqual(before);}
  expect(parseCommands([command])).toEqual([command]);document._dispatch(command);const after=document.toJSON();expect(raster.assetId).toBe('native-original');expect(before.children[0]).toMatchObject({assetId:'byte-original'});
  document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);
  expect(()=>document._dispatch(command)).toThrow('byte-to-float');expect(document.toJSON()).toEqual(after);
  const recorder=new RecipeRecorder();recorder.start();recorder.recordCommand(command,before,after);expect(()=>recorder.stop()).toThrow(/prepared source replacements/);
});

for(const [index,row] of manifest.cases.entries())it(`native float tonal ${index} preserves independent signed colors, alpha and partitions`,async()=>{
  const source=floats(gunzipSync(await readFile(directory+'source.f32le.gz'))),coverage=floats(gunzipSync(await readFile(directory+'coverage.f32le.gz')));
  const before=source.slice(),beforeCoverage=coverage.slice(),expected=floats(gunzipSync(await readFile(directory+row.reference))),actual=native.tonal(source,coverage,row.options);
  let maximum=0;
  for(let i=0;i<source.length;i++){
    if(i%4===3)expect(words(actual)[i]).toBe(words(source)[i]);
    else maximum=Math.max(maximum,Math.abs(actual[i]-expected[i])/Math.max(1,Math.abs(expected[i])));
  }
  expect(maximum).toBeLessThanOrEqual(manifest.tolerance);expect(words(source)).toEqual(words(before));expect(words(coverage)).toEqual(words(beforeCoverage));
  const partition=new Float32Array(source.length);
  for(let at=0;at<coverage.length;at+=173){const end=Math.min(coverage.length,at+173);partition.set(native.tonal(source.subarray(at*4,end*4),coverage.subarray(at,end),row.options),at*4);}
  expect(words(partition)).toEqual(words(actual));expect(actual.some((v,i)=>i%4!==3&&v<0)).toBe(true);expect(actual.some((v,i)=>i%4!==3&&v>1)).toBe(true);
});

it('linear stop changes have exact analytic gains and protection never reduces existing HDR',()=>{
  const mid=new Float32Array([.5,.5,.5,.375]),coverage=new Float32Array([1]);
  expect([...native.tonal(mid,coverage,{mode:'dodge',range:'midtones',exposure:.5,protectTones:false})]).toEqual([1,1,1,.375]);
  expect([...native.tonal(mid,coverage,{mode:'burn',range:'midtones',exposure:.5})]).toEqual([.25,.25,.25,.375]);
  const hdr=new Float32Array([2,2,2,.625]);
  expect([...native.tonal(hdr,coverage,{mode:'dodge',range:'highlights',exposure:1,protectTones:false})]).toEqual([8,8,8,.625]);
  expect(words(native.tonal(hdr,coverage,{mode:'dodge',range:'highlights',exposure:1}))).toEqual(words(hdr));
  expect([...native.tonal(hdr,coverage,{mode:'burn',range:'highlights',exposure:1})]).toEqual([.5,.5,.5,.625]);
  expect([...native.tonal(new Float32Array([0,-1,-2,1]),coverage,{mode:'dodge',range:'shadows',exposure:.5})]).toEqual([0,-2,-4,1]);
  expect([...native.tonal(new Float32Array([.75,.75,.75,1]),coverage,{mode:'dodge',range:'highlights',exposure:1})]).toEqual([1,1,1,1]);
});

it('neutral, uncovered and transparent pixels preserve every original word and invalid work remains rejected',()=>{
  const source=new Float32Array([-0,-1,3.4e38,-0,.1234567,.7654321,.3333333,1]),coverage=new Float32Array([1,0]),options={mode:'dodge' as const,range:'shadows' as const,exposure:1,protectTones:false};
  expect(words(native.tonal(source,coverage,options))).toEqual(words(source));
  expect(words(native.tonal(source,new Float32Array([1,1]),{...options,exposure:0}))).toEqual(words(source));
  for(const invalid of [{...options,extra:1},{...options,flow:NaN},{...options,exposure:1.01},{...options,mode:'unknown'},{...options,protectTones:0}])expect(()=>floatTonalOptionsSchema.parse(invalid)).toThrow();
  for(const value of [NaN,Infinity,-.1,1.1])expect(()=>native.tonal(source,new Float32Array([value,0]),{...options,exposure:0})).toThrow();
  expect(()=>native.tonal(new Float32Array([0,0,0,1.1]),new Float32Array([1]),options)).toThrow('invalid');
  expect(()=>native.tonal(new Float32Array([NaN,0,0,0]),new Float32Array([0]),options)).toThrow('invalid');
  const large=new Float32Array([3.4e38,3.4e38,3.4e38,1]),before=large.slice();
  expect(()=>native.tonal(large,new Float32Array([1]),{...options,range:'highlights'})).toThrow('finite float32');expect(words(large)).toEqual(words(before));
  expect(native.tonal(new Float32Array([.25,.25,.25,1]),new Float32Array([1]),{...options,range:'midtones'}).every(Number.isFinite)).toBe(true);
});

it('native memory growth and awkward worker-sized partitions retain every tonal output word',()=>{
  const source=new Float32Array(65539*4),coverage=new Float32Array(65539);
  for(let p=0;p<coverage.length;p++){source.set([p%37/19-.25,p%53/23,p%71/31,p%5/4],p*4);coverage[p]=(p%256)/255;}
  const options={mode:'burn' as const,range:'midtones' as const,exposure:.375},full=native.tonal(source,coverage,options),parts=new Float32Array(source.length);
  for(let at=0;at<coverage.length;at+=491){const end=Math.min(coverage.length,at+491);parts.set(native.tonal(source.subarray(at*4,end*4),coverage.subarray(at,end),options),at*4);}
  expect(words(parts)).toEqual(words(full));
});

it('existing OO tonal constructors share float conversion, exact Undo, lock validation and atomic rollback',()=>{
  const document=new Document(),raster=document.layers.add(new RasterLayer({assetId:'native-original',width:16,height:16}));
  const layer=document.layers.add(new AdjustmentLayer({adjustment:{kind:'tonal',strokes:[]}})),stroke=new TonalStroke({brush:new BrushStroke({points:[{x:8,y:8,pressure:.5}],size:12}),mode:'dodge',range:'midtones',exposure:.5});
  layer.addTonalStroke(stroke);const byte=document.toJSON();document.convertToFloat();const before=document.toJSON();expect(Document.fromJSON(before).toJSON()).toEqual(before);
  layer.addTonalStroke(stroke);const after=document.toJSON();document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);
  expect(()=>document.transaction('Rejected float edit',()=>{raster.opacity=.5;document.layers.add(new PaintLayer());})).toThrow();expect(document.toJSON()).toEqual(after);
  layer.locked=true;const locked=document.toJSON();expect(()=>layer.addTonalStroke(stroke)).toThrow(/lock/i);expect(document.toJSON()).toEqual(locked);
  document.undo();document.undo();document.undo();expect(document.toJSON()).toEqual(byte);
});

it('covered-rectangle execution preserves native whole-window words and owns inputs across a queued worker',async()=>{
  const source=new Float32Array(4*3*4);for(let i=0;i<12;i++)source.set([.125+i/32,.25,.5,i===0?0:.375],i*4);
  const coverage=new Float32Array(12);coverage[6]=.5;coverage[9]=1;const options={mode:'burn' as const,range:'midtones' as const,exposure:.5},before=source.slice(),mask=coverage.slice(),expected=native.tonal(before,mask,options);
  let resume!:()=>void;const paused=new Promise<void>(resolve=>resume=resolve),sent:number[]=[];
  const task=applyFloatTonal(source,coverage,options,4,3,{floatTonal:async(pixels,amount,settings)=>{sent.push(pixels.length/4);await paused;return native.tonal(pixels,amount,settings);}},()=>{});
  source.fill(0);coverage.fill(0);options.exposure=0;resume();expect(words(await task)).toEqual(words(expected));expect(sent).toEqual([4]);
  let calls=0;const neutral=await applyFloatTonal(before,new Float32Array(12),options,4,3,{floatTonal:async()=>{calls++;throw new Error('Unexpected worker');}},()=>{});
  expect(words(neutral)).toEqual(words(before));expect(calls).toBe(0);
  const hidden=before.slice();for(let i=3;i<hidden.length;i+=4)hidden[i]=0;hidden[3]=-0;
  const transparent=await applyFloatTonal(hidden,new Float32Array(12).fill(1),{...options,exposure:.5},4,3,{floatTonal:async()=>{calls++;throw new Error('Unexpected transparent work');}},()=>{});
  expect(words(transparent)).toEqual(words(hidden));expect(calls).toBe(0);
  const invalid=before.slice();invalid[0]=NaN;await expect(applyFloatTonal(invalid,new Float32Array(12),options,4,3,{floatTonal:async()=>before},()=>{})).rejects.toThrow('invalid');
});

it('cancellation after native rectangle computation rejects publication without changing the captured source',async()=>{
  const source=new Float32Array([.25,.5,.75,.375]),before=source.slice();let cancelled=false;
  await expect(applyFloatTonal(source,new Float32Array([1]),{mode:'burn',range:'midtones',exposure:.5},1,1,{floatTonal:async(pixels,coverage,options)=>{const result=native.tonal(pixels,coverage,options);cancelled=true;return result;}},()=>{if(cancelled)throw new Error('Tonal work cancelled');})).rejects.toThrow('cancelled');
  expect(words(source)).toEqual(words(before));
});

it('the independent numerical corpus binds all original sample and expected streams',async()=>{
  expect(manifest.cases).toHaveLength(12);expect(manifest.tolerance).toBe(2**-22);
  expect(createHash('sha256').update(await readFile(directory+'generate.py')).digest('hex')).toBe(manifest.generatorSha256);
  for(const [name,row] of Object.entries(manifest.files)){const bytes=await readFile(directory+name);expect(bytes.length).toBe(row.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);}
});
