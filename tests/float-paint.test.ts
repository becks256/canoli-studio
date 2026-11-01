import {beforeAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {instantiateKernel} from '../src/engine/wasm';
import {FloatPixelProcessor} from '../src/engine/float-pixels';
import {replayFloatPaint,renderFloatPaint} from '../src/engine/float-paint';
import {Document,PaintLayer,PencilStroke,EraserStroke,PaintFill,CloneStroke,AffineTransform,LayerGroup,WetPaintStroke} from '../src/dom';
let native:FloatPixelProcessor;
beforeAll(async()=>{native=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));});
const processor={floatComposite:async(...args:Parameters<FloatPixelProcessor['composite']>)=>native.composite(...args)},area={x:0,y:0,width:1,height:1},world=new AffineTransform();
const words=(pixels:Float32Array)=>[...new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length)];
it('editable float dry paint uses ordered native source-over and applies each opacity once',async()=>{
 const strokes=[new PencilStroke({points:[{x:.5,y:.5}],size:1,color:'#ff0000',opacity:.375}),new PencilStroke({points:[{x:.5,y:.5}],size:1,color:'#00ff00',opacity:.64123})];
 const a=.64123,b=.375*(1-a),alpha=a+b,expected=new Float32Array([b/alpha,a/alpha,0,alpha]);
 const output=await replayFloatPaint(strokes.map(stroke=>stroke.toJSON()),area,world,async()=>new Float32Array([1]),processor,()=>{});expect(words(output)).toEqual(words(expected));
});
it('eraser/clear keep surviving linear RGB and round alpha once after unquantized opacity',async()=>{
 const opacity=.64123,mask=Math.fround(17/255),strokes=[new PencilStroke({points:[{x:.5,y:.5}],color:'#ff0000',opacity:.375}),new EraserStroke({points:[{x:.5,y:.5}],opacity}),new PaintFill({bounds:area,erase:true,opacity:.125})];
 const expected=new Float32Array([1,0,0,Math.fround(.375*(1-mask*opacity))*(1-.125)]);
 const output=await replayFloatPaint(strokes.map(stroke=>stroke.toJSON()),area,world,async stroke=>new Float32Array([stroke.kind==='eraser'?mask:1]),processor,()=>{});expect(words(output)).toEqual(words(expected));
});
it('float PaintLayers share commands, ancestry locks, rollback, history and strict unsupported operation gates',()=>{
 const document=new Document({precision:'float32'}),group=document.layers.add(new LayerGroup()),paint=group.layers.add(new PaintLayer()),before=document.toJSON();document.transaction('Editable float paint',()=>{paint.strokes.add(new PencilStroke({points:[{x:1,y:1}]}));paint.strokes.add(new PaintFill({bounds:area}));});const after=document.toJSON();document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);group.locked=true;expect(()=>paint.strokes.add(new EraserStroke({points:[{x:1,y:1}]}))).toThrow(/unlock/i);group.locked=false;
 const saved=document.toJSON();expect(()=>document.transaction('Invalid float clone',()=>{paint.name='Must roll back';paint.strokes.add(new CloneStroke({points:[{x:1,y:1}],tiles:[{assetId:'sample',x:0,y:0,width:1,height:1}]}));})).toThrow(/explicit native float sources/);expect(document.toJSON()).toEqual(saved);
});
it('rejects malformed asynchronous coverage/native results and cancellation before publishing',async()=>{
 const strokes=[new PencilStroke({points:[{x:.5,y:.5}],color:'#ff0000'}).toJSON()];
 for(const bad of [new Float32Array(0),new Float32Array([NaN]),new Float32Array([2])])await expect(replayFloatPaint(strokes,area,world,async()=>bad,processor,()=>{})).rejects.toThrow();
 await expect(replayFloatPaint(strokes,area,world,async()=>new Float32Array([1]),{floatComposite:async()=>new Float32Array(8)},()=>{})).rejects.toThrow(/geometry/);
 let cancelled=false;await expect(replayFloatPaint(strokes,area,world,async()=>{cancelled=true;return new Float32Array([1]);},processor,()=>{if(cancelled)throw new Error('Cancelled dry paint');})).rejects.toThrow('Cancelled dry paint');
});

it('source leases reject replaced TIFF interpretation metadata even with identical bytes and geometry',async()=>{
 const {AssetStore,captureAssetSource}=await import('../src/core/assets'),{tiffDecodeOptionsSchema}=await import('../src/core/interchange/tiff/types');const assets=new AssetStore();
 try{const asset=await assets.add(new Blob(['source'],{type:'image/png'}),'Lease',undefined,false),choice=Object.freeze(tiffDecodeOptionsSchema.parse({}));Object.assign(asset,{tiff:choice});const pin=captureAssetSource(assets,asset.id);pin.check();Object.assign(asset,{tiff:{...choice}});expect(()=>pin.check()).toThrow('Source image asset changed');}finally{assets.dispose();}
});

it('native paint replays dry, HDR replacement, clear and later dry paint with once-only independent envelopes',async()=>{
 const wet=new WetPaintStroke({precision:'float32',brush:new PencilStroke({points:[{x:.5,y:.5}],opacity:.01}),opacity:.64123,tiles:[{...area,assetId:'pigment',coverage:{assetId:'removal'}}]}),strokes=[new PaintFill({bounds:area,color:'#ff0000',opacity:.375}),wet,new PaintFill({bounds:area,erase:true,opacity:.125}),new PaintFill({bounds:area,color:'#0000ff',opacity:.25})];
 const envelope=.64123,keep=.375*(1-.5*envelope),alpha=.375*envelope+keep,wetColor=[(4*.375*envelope+keep)/alpha,-2*.375*envelope/alpha,8*.375*envelope/alpha],wetPixels=new Float32Array([...wetColor,alpha]),erasedAlpha=Math.fround(wetPixels[3]*(1-.125)),back=erasedAlpha*.75,finalAlpha=.25+back,expected=new Float32Array([wetPixels[0]*back/finalAlpha,wetPixels[1]*back/finalAlpha,(.25+wetPixels[2]*back)/finalAlpha,finalAlpha]);
 let reads=0;const result=await replayFloatPaint(strokes.map(s=>s.toJSON()),area,world,async()=>new Float32Array([1]),{...processor,floatCompositeHdrWet:async(...args)=>native.compositeHdrWet(...args)},()=>{},async()=>{reads++;return new Float64Array([1.5,-.75,3,.375,.5]);});expect(reads).toBe(1);expect(words(result)).toEqual(words(expected));
});

it('inert HDR paint preserves dry affine coverage while active wet reconstructs on the local lattice',async()=>{
 const wet=(opacity:number)=>new WetPaintStroke({precision:'float32',brush:new PencilStroke({points:[{x:.5,y:.5}]}),opacity,tiles:[{...area,assetId:'pigment',coverage:{assetId:'removal'}}]}).toJSON(),dry=new PaintFill({bounds:area,color:'#ff0000'}).toJSON(),placed=AffineTransform.translation(8,4),calls:AffineTransform[]=[];
 const coverage=async(_stroke:unknown,region:{width:number;height:number},matrix:AffineTransform)=>{calls.push(matrix);return new Float32Array(region.width*region.height).fill(1);},all={...processor,floatCompositeHdrWet:async(...args:Parameters<FloatPixelProcessor['compositeHdrWet']>)=>native.compositeHdrWet(...args)};
 await renderFloatPaint([dry,wet(0)],area,placed,coverage,all,()=>{},async()=>{throw new Error('Inert field must not be sampled');});expect(calls.every(matrix=>matrix===placed)).toBe(true);calls.length=0;
 const output=await renderFloatPaint([dry,wet(1)],{...area,x:8,y:4},placed,coverage,all,()=>{},async(_stroke,region)=>{const field=new Float64Array(region.width*region.height*5);for(let p=0;p<field.length;p+=5)field.set([1.5,-.75,3,.375,.5],p);return field;});expect(calls.every(matrix=>JSON.stringify(matrix.toJSON())===JSON.stringify(world.toJSON()))).toBe(true);expect([...output]).toEqual([...new Float32Array([2/.875,-.75/.875,3/.875,.875])]);
});
