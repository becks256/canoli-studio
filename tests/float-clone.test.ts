import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Document,PaintLayer,PaintFill,CloneStroke,BrushStroke,LayerMask,LayerGroup,AffineTransform} from '../src/dom';
import {SCHEMA_VERSION,validateDocument} from '../src/core/model';
import {assertFloatSources} from '../src/core/float-document';
import {captureFloatCloneAssets,validateFloatCloneAssets} from '../src/core/float-clone-assets';
import {commandHasPreparedPaint,hasPreparedPaint,validatePreparedPaintAssets} from '../src/core/prepared-paint-assets';
import {encodeFloatWetTile} from '../src/core/float-wet-tile';
import type {WetAssetProvider,WetImageSource} from '../src/core/wet-assets';
import {captureFloatClone} from '../src/engine/float-clone';
import {replayFloatPaint} from '../src/engine/float-paint';
import {instantiateKernel} from '../src/engine/wasm';
import {FloatPixelProcessor} from '../src/engine/float-pixels';

const tile={x:3,y:4,width:2,height:1,assetId:'native'},world=new AffineTransform(),words=(p:Float32Array)=>[...new Uint32Array(p.buffer,p.byteOffset,p.length)];
const stroke=(opacity=.64123)=>new CloneStroke({precision:'float32',points:[{x:3.5,y:4.5}],size:4,pressureSize:false,tiles:[tile],opacity});
let native:FloatPixelProcessor;beforeAll(async()=>{native=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));});
const processor={floatComposite:async(...args:Parameters<FloatPixelProcessor['composite']>)=>native.composite(...args)};
async function fixture(){
 const blob=await encodeFloatWetTile(new Float32Array([4,-2,8,.375,16,-8,4,.125]),2,1),sources=new Map<string,WetImageSource>([['native',{blob,width:2,height:1,identity:{},pixels:{}}]]),calls:string[]=[];
 const provider:WetAssetProvider={get(id,precision){expect(precision).toBe('float32');calls.push(id);const source=sources.get(id);if(!source)throw new Error('Missing '+id);return source;},async *alpha(){throw new Error('No display alpha');}};
 return{blob,sources,provider,calls};
}
it('strict versioned CloneStroke values retain byte defaults and reject false roles, ages and null flags atomically',()=>{
 const value=stroke();expect(value.precision).toBe('float32');expect(new CloneStroke({points:[{x:1,y:1}],tiles:[tile]}).precision).toBeUndefined();
 for(const precision of [null,'uint8','float16'])expect(()=>new CloneStroke({points:[{x:1,y:1}],tiles:[tile],precision} as never)).toThrow();
 expect(()=>new BrushStroke({points:[{x:1,y:1}],precision:'float32'})).toThrow('only for clone');expect(()=>new LayerMask({base:1,strokes:[{mode:'hide',stroke:value}]})).toThrow();
 const d=new Document({precision:'float32'}),paint=d.layers.add(new PaintLayer()),before=d.toJSON();paint.strokes.add(value);const after=d.toJSON();expect(after.schemaVersion).toBe(SCHEMA_VERSION);expect(SCHEMA_VERSION).toBe(58);d.undo();expect(d.toJSON()).toEqual(before);d.redo();expect(d.toJSON()).toEqual(after);
 const old=structuredClone(after);old.schemaVersion=57;expect(()=>validateDocument(old)).toThrow('58');
 const byte=new Document(),b=byte.layers.add(new PaintLayer());expect(()=>b.strokes.add(value)).toThrow('float32');const group=d.layers.add(new LayerGroup());paint.moveTo(group);group.locked=true;expect(()=>paint.strokes.add(stroke())).toThrow(/unlock/i);
 const fake={tiff:{editingPrecision:'float32'},tiffColor:{}},assets={get:()=>fake as never};expect(()=>assertFloatSources(after,assets)).not.toThrow();const bad=structuredClone(after),layer=bad.children[0];if(layer.kind!=='paint'||layer.strokes[0].kind!=='clone')throw new Error('No clone');layer.strokes[0].texture={assetId:'native',channel:'alpha',invert:false};expect(()=>assertFloatSources(bad,assets)).toThrow('native byte');
});
it('captures all original references and metadata before awaits without a byte pixel reader',async()=>{
 const f=await fixture(),input=[{...tile}],pending=captureFloatCloneAssets(input,f.provider);input[0].assetId='foreign';input[0].x=9000;input.length=0;const capture=await pending;expect(capture.tiles).toEqual([{region:{x:3,y:4,width:2,height:1},original:f.blob}]);expect(Object.isFrozen(capture.tiles[0].region)).toBe(true);capture.dispose();expect(()=>capture.tiles).toThrow('disposed');
});
for(const property of ['blob','width','height','identity','pixels'] as const)it('rejects changed '+property+' sources across async native preparation and permits a valid new owner',async()=>{
 const f=await fixture(),source=f.sources.get('native')!,saved={...source},pending=captureFloatCloneAssets([tile],f.provider);
 if(property==='blob')source.blob=f.blob.slice(0,f.blob.size,'image/tiff');else if(property==='width'||property==='height')source[property]++;else source[property]={};
 await expect(pending).rejects.toThrow('changed');Object.assign(source,saved);const owner=await captureFloatCloneAssets([tile],f.provider);owner.dispose();
});
it('validates hidden/inert originals and rejects missing, malformed, mismatched or non-native metadata',async()=>{
 const f=await fixture(),d=new Document({precision:'float32'}),paint=d.layers.add(new PaintLayer({visible:false}));paint.strokes.add(stroke(0));expect(hasPreparedPaint(d.toJSON())).toBe(true);expect(commandHasPreparedPaint({type:'paint.add',id:paint.id,stroke:stroke().toJSON()})).toBe(true);
 await validatePreparedPaintAssets(d.toJSON(),f.provider);f.sources.get('native')!.blob=new Blob([new Uint8Array(await f.blob.arrayBuffer()).slice(0,-7)],{type:'image/tiff'});await expect(validateFloatCloneAssets(d.toJSON(),f.provider)).rejects.toThrow();
 f.sources.get('native')!.blob=f.blob;for(const bad of [[],[{...tile,x:.5}],[{...tile,width:0}],[{...tile,unexpected:true}],[{...tile,assetId:'missing'}],[{...tile,width:1}]])await expect(captureFloatCloneAssets(bad as never,f.provider)).rejects.toThrow();
 const abort=new AbortController(),pending=captureFloatCloneAssets([tile],f.provider,{signal:abort.signal});abort.abort(new Error('Stop clone'));await expect(pending).rejects.toThrow('Stop clone');const valid=await captureFloatCloneAssets([tile],f.provider);valid.dispose();
});
it('clones source-over with independent source alpha and unquantized once-only brush opacity and coverage',async()=>{
 const f=await fixture(),source=await captureFloatClone([tile],f.provider,processor),area={x:3,y:4,width:1,height:1},coverage=Math.fround(17/255),opacity=.64123,clone=stroke(opacity).toJSON(),base=new PaintFill({bounds:area,color:'#ff0000',opacity:.5}).toJSON();
 const mask=async(s:{kind:string})=>new Float32Array([s.kind==='clone'?coverage:1]),result=await replayFloatPaint([base,clone],area,world,mask,processor,()=>{},undefined,(_stroke,area,world)=>source.read(area,world)),a=.375*coverage*opacity,keep=.5*(1-a),alpha=a+keep,expected=new Float32Array([(4*a+keep)/alpha,-2*a/alpha,8*a/alpha,alpha]);expect(words(result)).toEqual(words(expected));expect(result[3]).toBeGreaterThan(.5);source.dispose();
});
it('native source overlaps, interpolation halos and crop partitions preserve HDR source-over without removing paint',async()=>{
 const f=await fixture(),source=await captureFloatClone([tile,tile],f.provider,processor),area={x:3,y:4,width:2,height:1},identity=await source.read(area,world);expect([...identity]).toEqual([4,-2,8,.609375,16,-8,4,.234375]);source.dispose();
 const field=await captureFloatClone([tile],f.provider,processor),pose=AffineTransform.translation(.25,0),region={x:2,y:3,width:5,height:3},all=await field.read(region,pose),cut=new Float32Array(all.length);
 for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++)cut.set(await field.read({x:region.x+x,y:region.y+y,width:1,height:1},pose),(y*region.width+x)*4);expect(words(all)).toEqual(words(cut));const at=((4-region.y)*region.width+4-region.x)*4;expect([...all.subarray(at,at+4)]).toEqual([10,-5,6,.1875]);field.dispose();expect(all[at]).toBe(10);await expect(field.read(region,pose)).rejects.toThrow('disposed');
});
it('reentrant retirement and inactive metadata preserve ownership and avoid unneeded source/coverage reads',async()=>{
 const f=await fixture();let owner:Awaited<ReturnType<typeof captureFloatClone>>|undefined,retire=false;owner=await captureFloatClone([tile],f.provider,processor,{check(){if(retire)owner!.dispose();}});const saved=await owner.read({x:3,y:4,width:1,height:1},world);retire=true;await expect(owner.read({x:3,y:4,width:1,height:1},world)).rejects.toThrow('disposed');expect(saved[0]).toBe(4);
 const result=await replayFloatPaint([stroke(0).toJSON()],{x:3,y:4,width:1,height:1},world,async()=>{throw new Error('Inactive coverage');},processor,()=>{},undefined,async()=>{throw new Error('Inactive source');});expect([...result]).toEqual([0,0,0,0]);
});
