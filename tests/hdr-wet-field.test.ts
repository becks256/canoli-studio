import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {instantiateKernel,type PixelKernel} from '../src/engine/wasm';
import {FloatPixelProcessor} from '../src/engine/float-pixels';
import {validateHdrWetField} from '../src/core/hdr-wet-field';
import {encodeFloatWetTile,readFloatWetTileWindow,validateFloatWetTile} from '../src/core/float-wet-tile';
import {captureHdrWetField} from '../src/engine/hdr-wet-field';
import {projectMappedHdrWetFieldWindow} from '../src/engine/projective-field';
import {TiffTileEncoder} from '../src/core/tiff-encoder';
import {STANDARD_PROFILES} from '../src/core/color/icc';
import {compileHdrWetProjectiveField} from '../src/core/hdr-wet-projective';
import type {FloatSourceWindow} from '../src/core/float-source/types';

const base='tests/fixtures/hdr-wet-field/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8'));
async function raw(name:string){return new Uint8Array(gunzipSync(await readFile(base+name+'.bin.gz'))).buffer;}
const f32=async(name:string)=>new Float32Array(await raw(name)),f64=async(name:string)=>new Float64Array(await raw(name));
function exact32(a:Float32Array,b:Float32Array){expect(a.length).toBe(b.length);const x=new Uint32Array(a.buffer,a.byteOffset,a.length),y=new Uint32Array(b.buffer,b.byteOffset,b.length);expect(x.findIndex((v,i)=>v!==y[i])).toBe(-1);}
function exact64(a:Float64Array,b:Float64Array){expect(a.length).toBe(b.length);const x=new BigUint64Array(a.buffer,a.byteOffset,a.length),y=new BigUint64Array(b.buffer,b.byteOffset,b.length);expect(x.findIndex((v,i)=>v!==y[i])).toBe(-1);}
let kernel:PixelKernel,owner:FloatPixelProcessor,before:Float32Array,field:Float64Array;
beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));owner=new FloatPixelProcessor(kernel);before=await f32('before');field=await f64('field');});
for(const [name,opacity]of [['zero',0],['partial',.625],['covered',1],['full',1]] as const)it('native HDR prepared composition matches every independent word: '+name,async()=>{
  const input=name==='full'?await f64('full-field'):field,source=before.slice(),saved=input.slice();exact32(owner.compositeHdrWet(source,input,opacity),await f32('composite-'+name));exact32(source,before);exact64(input,saved);
});
it('full removal preserves complete positive-alpha Float32 replacements, where Float32 premultiplication changes the reference',async()=>{
  const after=await f32('after'),result=owner.compositeHdrWet(before,await f64('full-field'));
  for(let at=0;at<after.length;at+=4)if(after[at+3]===0)after.fill(0,at,at+3);
  exact32(result,after);expect(Object.is(result[4],-0)).toBe(true);
  const rounded=after.slice();for(let at=0;at<rounded.length;at+=4)for(let c=0;c<3;c++)rounded[at+c]=rounded[at+3]===0?0:Math.fround(Math.fround(after[at+c]*after[at+3])/after[at+3]);
  const words=new Uint32Array(rounded.buffer),expected=new Uint32Array(after.buffer);expect(words.reduce((count,word,i)=>count+Number(word!==expected[i]),0)).toBe(manifest.oldFloat32PremultipliedMismatchWords);expect(manifest.oldFloat32PremultipliedMismatchWords).toBe(2818);
});
it('HDR authored identity and exact affine quads keep native pixel centers and preserve signed-zero pigment words',async()=>{
  const field=await f64('spatial-source'),region={x:0,y:0,width:23,height:17},corners=[{x:0,y:0},{x:23,y:0},{x:23,y:17},{x:0,y:17}] as const;
  const options={sourceWidth:23,sourceHeight:17,corners,field:region,source:region,output:region,background:0};
  // The sign of a zero coefficient is equivalent geometry; sampled pigment
  // words, including signed zero, remain exact below.
  const coefficients=(value:Float64Array)=>[...value.subarray(0,9)].map(v=>v===0?0:v);
  expect(coefficients(compileHdrWetProjectiveField(options).values)).toEqual([1,0,0,0,1,0,0,0,1]);exact64(owner.projectiveHdrWet(field,options),field);
  const affine=compileHdrWetProjectiveField({...options,corners:[{x:0,y:0},{x:23,y:11.5},{x:23,y:28.5},{x:0,y:17}]});expect(coefficients(affine.values)).toEqual([1,0,0,-.5,1,0,0,0,1]);
  const origin={x:2**38,y:-(2**38)},box={x:9,y:20,width:12,height:8},forward=compileHdrWetProjectiveField({sourceWidth:4,sourceHeight:2,field:box,source:box,output:{...origin,width:2,height:2},background:0,direction:'source-to-quad',corners:[{x:10.25,y:20.5},{x:18.25,y:24.5},{x:18.75,y:26.5},{x:10.75,y:22.5}],input:{origin,matrix:{a:.5,b:.25,c:0,d:2,e:.125,f:-.25}}});
  expect(coefficients(forward.values)).toEqual([1.0625,.5,-4.5625,.75,2,-3.625,0,0,1]);expect(forward.inputOrigin).toEqual(origin);expect(forward.sourceOrigin).toEqual({x:15,y:24});
});
for(let index=0;index<2;index++)it('native HDR projective sampling matches independent Float64 fields including horizon and large origins: '+index,async()=>{
  const input=await f64('spatial-source'),options={mapping:manifest.mappings[index],field:manifest.bounds,source:manifest.bounds,output:manifest.window,background:0};
  exact64(owner.mappedHdrWet(input,options),await f64('spatial-'+index));
  const streamed=await projectMappedHdrWetFieldWindow({bounds:manifest.bounds,readWindow:async region=>{
    const values=new Float64Array(region.width*region.height*5);for(let row=0;row<region.height;row++){const at=((region.y+row-manifest.bounds.y)*manifest.bounds.width+region.x-manifest.bounds.x)*5;values.set(input.subarray(at,at+region.width*5),row*region.width*5);}return values;
  }},{floatMappedHdrWet:async(...args)=>owner.mappedHdrWet(...args)},manifest.mappings[index],manifest.window);
  exact64(streamed,await f64('spatial-'+index));
});
it('native scratch windows and caller partitions preserve one final store for HDR replacement',()=>{
  const count=65539,pixels=new Float32Array(count*4),values=new Float64Array(count*5);
  for(let i=0;i<pixels.length;i++)pixels[i]=before[i%before.length];for(let i=0;i<values.length;i++)values[i]=field[i%field.length];
  const complete=owner.compositeHdrWet(pixels,values,.625),cut=new Float32Array(pixels.length);
  for(let at=0;at<count;at+=127){const end=Math.min(count,at+127);cut.set(owner.compositeHdrWet(pixels.subarray(at*4,end*4),values.subarray(at*5,end*5),.625),at*4);}exact32(complete,cut);
});
it('invalid or unrepresentable HDR fields reject without publishing or poisoning another owner',()=>{
  const pixels=new Float32Array([2,-4,8,.375]),bad=new Float64Array([1e300,0,0,1,1]);expect(()=>owner.compositeHdrWet(pixels,bad)).toThrow('float32');
  for(const value of [new Float64Array([1,0,0,0,1]),new Float64Array([NaN,0,0,1,1]),new Float64Array([0,0,0,.5,.25]),new Float64Array(new SharedArrayBuffer(40))])expect(()=>validateHdrWetField(value,1)).toThrow();
  exact32(owner.compositeHdrWet(pixels,new Float64Array([0,0,0,0,0])),pixels);const disposed=new FloatPixelProcessor(kernel);disposed.dispose();expect(()=>disposed.compositeHdrWet(pixels,bad)).toThrow('disposed');
});
it('real native float TIFF tiles retain every source word after owned input capture, padding, file reopening and cropped reads',async()=>{
  const pixels=await f32('codec'),expected=pixels.slice(),pending=encodeFloatWetTile(pixels,131,79);pixels.fill(0);const blob=await pending,reopened=new Blob([await blob.arrayBuffer()],{type:'image/tiff'});
  await validateFloatWetTile(reopened,131,79);exact32(await readFloatWetTileWindow(reopened,131,79,{x:0,y:0,width:131,height:79}),expected);
  const region={x:-2,y:73,width:138,height:9},crop=await readFloatWetTileWindow(reopened,131,79,region),reference=new Float32Array(crop.length);
  for(let y=0;y<6;y++)reference.set(expected.subarray((73+y)*131*4,(74+y)*131*4),(y*138+2)*4);exact32(crop,reference);
});
it('strict prepared TIFF identity rejects wrong profiles/geometry, malformed payloads and cancellation without poisoned proofs',async()=>{
  const pixels=new Float32Array([2,-4,8,.375]),valid=await encodeFloatWetTile(pixels,1,1),bytes=new Uint8Array(await valid.arrayBuffer());
  await expect(validateFloatWetTile(valid,2,1)).rejects.toThrow();await expect(validateFloatWetTile(new Blob([bytes.subarray(0,bytes.length-7)],{type:'image/tiff'}),1,1)).rejects.toThrow();
  const wrong=new TiffTileEncoder(1,1,'auto',STANDARD_PROFILES.srgb.iccBytes,'rgba-float32'),padded=new Float32Array(wrong.tileWidth*wrong.tileHeight*4);padded.set(pixels);await wrong.append(padded);await expect(validateFloatWetTile(wrong.finish(),1,1)).rejects.toThrow('exact linear-sRGB profile');
  const abort=new AbortController();await expect(validateFloatWetTile(valid,1,1,{signal:abort.signal,check:()=>abort.abort(new Error('Stop prepared tile'))})).rejects.toThrow('Stop prepared tile');exact32(await readFloatWetTileWindow(valid,1,1,{x:0,y:0,width:1,height:1}),pixels);
});
it('validated native asset pairs retain ordered independent removal, persistence, private ownership and cancellation',async()=>{
  const color=await encodeFloatWetTile(new Float32Array([2,-8,4,.5]),1,1),coverage=await encodeFloatWetTile(new Float32Array([0,0,0,.75]),1,1),second=await encodeFloatWetTile(new Float32Array([8,-4,2,.25]),1,1),secondCoverage=await encodeFloatWetTile(new Float32Array([0,0,0,.5]),1,1);
  const pair={region:{x:3,y:-2,width:1,height:1},pixels:color,coverage},captured=await captureHdrWetField([pair,{...pair,pixels:second,coverage:secondCoverage}]);pair.region.x=999;
  const region={x:3,y:-2,width:1,height:1},result=await captured.readWindow(region);exact64(result,new Float64Array([2.5,-3,1.5,.5,.875]));
  const restored=await captureHdrWetField([{region,pixels:new Blob([await color.arrayBuffer()],{type:'image/tiff'}),coverage},{region,pixels:new Blob([await second.arrayBuffer()],{type:'image/tiff'}),coverage:secondCoverage}]);exact64(await restored.readWindow(region),result);
  await expect(captureHdrWetField([{region,pixels:color,coverage:await encodeFloatWetTile(new Float32Array([0,0,0,.25]),1,1)}])).rejects.toThrow('already be masked');
  const read=captured.readWindow(region,{onProgress:()=>captured.dispose()});await expect(read).rejects.toThrow('disposed');exact64(await restored.readWindow(region),result);restored.dispose();
});
it('streamed HDR fields retain exact output under caller partitions and reject changed backing geometry',async()=>{
  const data=await f64('spatial-source'),bounds={...manifest.bounds},read=async(region:FloatSourceWindow)=>{
    const value=new Float64Array(region.width*region.height*5);for(let row=0;row<region.height;row++){const at=((region.y+row-bounds.y)*bounds.width+region.x-bounds.x)*5;value.set(data.subarray(at,at+region.width*5),row*region.width*5);}return value;
  },processor={floatMappedHdrWet:async(...args:Parameters<FloatPixelProcessor['mappedHdrWet']>)=>owner.mappedHdrWet(...args)},all=await projectMappedHdrWetFieldWindow({bounds,readWindow:read},processor,manifest.mappings[0],manifest.window),parts=new Float64Array(all.length);
  for(let y=0;y<manifest.window.height;y+=11)for(let x=0;x<manifest.window.width;x+=17){const width=Math.min(17,manifest.window.width-x),height=Math.min(11,manifest.window.height-y),part=await projectMappedHdrWetFieldWindow({bounds,readWindow:read},processor,manifest.mappings[0],{x:manifest.window.x+x,y:manifest.window.y+y,width,height});for(let row=0;row<height;row++)parts.set(part.subarray(row*width*5,(row+1)*width*5),((y+row)*manifest.window.width+x)*5);}exact64(parts,all);
  await expect(projectMappedHdrWetFieldWindow({bounds,readWindow:async region=>{const value=await read(region);bounds.x++;return value;}},processor,manifest.mappings[0],manifest.window)).rejects.toThrow('source changed');
});
it('independent fixture, old rounding counterexample and generator identities remain verified',async()=>{
  for(const [name,entry]of Object.entries(manifest.files)as [string,{sha256:string;rawSha256:string;bytes:number}][]){const packed=await readFile(base+name+'.bin.gz');expect(packed.length).toBe(entry.bytes);expect(createHash('sha256').update(packed).digest('hex')).toBe(entry.sha256);expect(createHash('sha256').update(gunzipSync(packed)).digest('hex')).toBe(entry.rawSha256);}
  expect(createHash('sha256').update(await readFile('scripts/generate-hdr-wet-field-fixtures.py')).digest('hex')).toBe(manifest.generatorSha256);
});
