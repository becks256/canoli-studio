import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {refineEdgeOptionsSchema,mattingHalo} from '../src/core/matting';
import {refineMattingTile} from '../src/engine/matting-tile';
import {encodeMattingOutput,type MattingRegion} from '../src/engine/matting-output';
import {instantiateKernel,type PixelKernel} from '../src/engine/wasm';
import {openPngRows} from '../server/png-rows';
let kernel:PixelKernel;beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});
const settings=(input:unknown={})=>refineEdgeOptionsSchema.parse({solver:'color-line',...input as object});
function capture(pixels:Uint8ClampedArray,width:number,height:number,region:MattingRegion,initial?:Uint8Array,labels?:Uint8Array){
  const data=new Uint8ClampedArray(region.width*region.height*4),alpha=initial?new Uint8Array(region.width*region.height):undefined,trimap=labels?new Uint8Array(region.width*region.height):undefined;
  for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++){
    const xx=region.x+x,yy=region.y+y;if(xx<0||yy<0||xx>=width||yy>=height)continue;
    const from=yy*width+xx,to=y*region.width+x;data.set(pixels.subarray(from*4,from*4+4),to*4);if(alpha)alpha[to]=initial![from];if(trimap)trimap[to]=labels![from];
  }return{data,initial:alpha,labels:trimap};
}
async function decode(blob:Blob){const image=openPngRows(new Uint8Array(await blob.arrayBuffer())),pixels=new Uint8Array(image.width*image.height*4);for await(const strip of image.strips)pixels.set(strip.pixels,strip.y*image.width*4);return{width:image.width,height:image.height,pixels};}

it('refinement strictly normalizes aliases, owns trimaps and makes corrected output an explicit new layer',()=>{
  expect(refineEdgeOptionsSchema.parse({}).solver).toBe('closed-form');
  expect(settings()).toMatchObject({radius:10,smoothness:10,edgeFeather:0,decontaminate:false,outputTo:'mask'});
  expect(settings({decontaminate:true})).toMatchObject({outputTo:'new-layer'});expect(settings({smooth:25,feather:2})).toMatchObject({smoothness:25,edgeFeather:2});
  for(const value of [{radius:-1},{feather:Infinity},{smooth:10,smoothness:20},{edgeFeather:1,feather:2},{decontaminate:true,outputTo:'mask'},{unknown:true},{trimapStrokes:[{mode:'fake',size:1,points:[{x:0,y:0}]}]}])expect(()=>settings(value)).toThrow();
  const trimap=new Uint8Array([0,128,255]),owned=settings({trimap});trimap.fill(0);expect(Array.from(owned.trimap!)).toEqual([0,128,255]);
});

it('actual worker mathematics recovers a color-line matte and corrected RGB while retaining intrinsic source alpha',()=>{
  const width=9,height=1,pixels=new Uint8ClampedArray(width*4),labels=new Uint8Array(width),weights=[1,1,.8,.65,.5,.35,.2,0,0];
  for(let x=0;x<width;x++){const a=weights[x];pixels.set([Math.round(10+190*a),Math.round(30-10*a),Math.round(200-190*a),x===4?200:255],x*4);labels[x]=x<2?255:x>6?0:128;}
  const result=refineMattingTile(kernel,pixels,{x:0,y:0,width,height,sourceWidth:width,sourceHeight:height,core:{x:0,y:0,width,height},labels,options:settings({radius:25,smoothness:0,decontaminate:true})});
  expect(Array.from(result.alpha)).toEqual([255,255,204,166,128,89,51,0,0]);expect(Array.from(result.rgba.slice(16,20))).toEqual([199,20,11,200]);expect(result.unresolvedPixels).toBe(0);
});

it('padded tile results exactly match a whole supported region across morphology, feather, correction and seams',()=>{
  const width=83,height=47,pixels=new Uint8ClampedArray(width*height*4),initial=new Uint8Array(width*height),options=settings({radius:4,smoothness:20,edgeFeather:3,contrast:25,shiftEdge:50,decontaminate:true}),halo=mattingHalo(options);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=Math.max(0,Math.min(1,(30-Math.hypot((x-39)*.9,y-23))/5));initial[y*width+x]=Math.round(a*255);pixels.set([Math.round(20+180*a),Math.round(40+30*a),Math.round(180-160*a),255],(y*width+x)*4);}
  const process=(x:number,y:number,w:number,h:number)=>{const region={x:x-halo,y:y-halo,width:w+halo*2,height:h+halo*2,core:{x:halo,y:halo,width:w,height:h}},input=capture(pixels,width,height,region,initial);return refineMattingTile(kernel,input.data,{...region,sourceWidth:width,sourceHeight:height,initial:input.initial,options});};
  const whole=process(0,0,width,height),alpha=new Uint8Array(width*height),rgba=new Uint8ClampedArray(width*height*4);let unresolved=0;
  for(let y=0;y<height;y+=11)for(let x=0;x<width;x+=17){const w=Math.min(17,width-x),h=Math.min(11,height-y),tile=process(x,y,w,h);unresolved+=tile.unresolvedPixels;for(let row=0;row<h;row++){alpha.set(tile.alpha.subarray(row*w,(row+1)*w),(y+row)*width+x);rgba.set(tile.rgba.subarray(row*w*4,(row+1)*w*4),((y+row)*width+x)*4);}}
  expect(alpha).toEqual(whole.alpha);expect(rgba).toEqual(whole.rgba);expect(unresolved).toBe(whole.unresolvedPixels);
});

it('source-alpha priors preserve a thin partial-alpha cutout without multiplying its intrinsic alpha twice',()=>{
  const width=9,height=7,pixels=new Uint8ClampedArray(width*height*4),initial=new Uint8Array(width*height);pixels.set([255,0,0,128],(3*width+4)*4);initial[3*width+4]=128;
  const result=refineMattingTile(kernel,pixels,{x:0,y:0,width,height,sourceWidth:width,sourceHeight:height,core:{x:0,y:0,width,height},initial,normalizeSourceAlpha:true,options:settings()});
  expect(result.alpha[3*width+4]).toBe(255);expect(result.rgba[(3*width+4)*4+3]).toBe(128);expect(result.unresolvedPixels).toBeGreaterThan(0);
  expect(result.alpha.reduce((sum,value)=>sum+value,0)).toBe(255);
});

it('zero edge radius and neutral adjustments retain an existing fractional matte exactly',()=>{
  const width=9,height=5,pixels=new Uint8ClampedArray(width*height*4),initial=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){pixels.set([255,0,0,255],(y*width+x)*4);initial[y*width+x]=[255,255,224,192,128,64,32,0,0][x];}
  const result=refineMattingTile(kernel,pixels,{x:0,y:0,width,height,sourceWidth:width,sourceHeight:height,core:{x:0,y:0,width,height},initial,options:settings({radius:0,smoothness:0})});expect(result.alpha).toEqual(initial);
});

it('native-coordinate trimap dabs override labels without fabricating unknown coverage',()=>{
  const width=8,height=6,pixels=new Uint8ClampedArray(width*height*4).fill(255),initial=new Uint8Array(width*height),options=settings({radius:0,smoothness:0,trimapStrokes:[{mode:'foreground',size:1,points:[{x:12.5,y:23.5}]}]});
  const result=refineMattingTile(kernel,pixels,{x:10,y:20,width,height,sourceWidth:100,sourceHeight:100,core:{x:0,y:0,width,height},initial,options});expect(result.alpha[3*width+2]).toBe(255);expect(result.alpha.reduce((a,b)=>a+b,0)).toBe(255);
  expect(()=>refineMattingTile(kernel,pixels,{x:0,y:0,width,height,sourceWidth:width,sourceHeight:height,core:{x:0,y:0,width,height},labels:new Uint8Array(width*height).fill(128),options:settings()})).toThrow(/evidence/);
});

it('positive contrast sharpens actual transition alpha and the legacy smooth/feather aliases affect pixels',()=>{
  const width=9,height=5,pixels=new Uint8ClampedArray(width*height*4),labels=new Uint8Array(width*height),weights=[1,1,.8,.65,.5,.35,.2,0,0];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=weights[x],i=y*width+x;pixels.set([Math.round(10+190*a),Math.round(30-10*a),Math.round(200-190*a),255],i*4);labels[i]=x<2?255:x>6?0:128;}
  const run=(options:unknown)=>refineMattingTile(kernel,pixels.slice(),{x:0,y:0,width,height,sourceWidth:width,sourceHeight:height,core:{x:0,y:0,width,height},labels,options:settings({radius:25,smoothness:0,...options as object})}).alpha;
  const base=run({}),contrast=run({contrast:50});expect(contrast[2]).toBeGreaterThan(base[2]);expect(contrast[6]).toBeLessThan(base[6]);expect(contrast[0]).toBe(255);expect(contrast[8]).toBe(0);
  expect(run({smooth:100,smoothness:100})).not.toEqual(base);expect(run({feather:3})).not.toEqual(base);
});

it('small Smooth values apply a proportionate change and keep known trimap labels exact',()=>{
  const width=9,height=5,pixels=new Uint8ClampedArray(width*height*4),initial=Uint8Array.from({length:width*height},(_,i)=>[0,16,230,64,200,32,160,240,255][i%width]);for(let i=0;i<width*height;i++)pixels.set([128,128,128,255],i*4);
  const run=(smoothness:number)=>refineMattingTile(kernel,pixels.slice(),{x:0,y:0,width,height,sourceWidth:width,sourceHeight:height,core:{x:0,y:0,width,height},initial,options:settings({radius:0,smoothness})}).alpha;
  const neutral=run(0),low=run(1),normal=run(10),strong=run(100),maxChange=(alpha:Uint8Array)=>Math.max(...alpha.map((value,i)=>Math.abs(value-neutral[i])));
  expect(neutral).toEqual(initial);expect(maxChange(low)).toBeGreaterThan(0);expect(maxChange(low)).toBeLessThanOrEqual(3);expect(maxChange(normal)).toBeLessThanOrEqual(26);expect(maxChange(normal)).toBeGreaterThan(maxChange(low));expect(maxChange(strong)).toBeGreaterThan(maxChange(normal));
  for(const alpha of [low,normal,strong])for(let y=0;y<height;y++){expect(alpha[y*width]).toBe(0);expect(alpha[y*width+8]).toBe(255);}
});

it('streamed dual PNG output retains native geometry, source RGB/alpha and exact matte bytes across strips',async()=>{
  const width=601,height=70,pixels=new Uint8ClampedArray(width*height*4),initial=new Uint8Array(width*height).fill(255),options=settings({radius:0,smoothness:0,decontaminate:true}),progress:any[]=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.set([x%256,y%256,(x+y)%256,255],(y*width+x)*4);
  const output=await encodeMattingOutput(width,height,options,async region=>{const input=capture(pixels,width,height,region,initial);return refineMattingTile(kernel,input.data,{...region,sourceWidth:width,sourceHeight:height,initial:input.initial,options});},{onProgress:value=>progress.push(value)});
  const mask=await decode(output.maskBlob),foreground=await decode(output.foregroundBlob!);expect([mask.width,mask.height]).toEqual([width,height]);expect(mask.pixels.every(value=>value===255)).toBe(true);expect(foreground.pixels).toEqual(new Uint8Array(pixels));expect(progress.at(-1)).toEqual({completed:4,total:4});
});

it('stream cancellation and malformed worker output produce no partial result',async()=>{
  const options=settings(),abort=new AbortController();
  await expect(encodeMattingOutput(8,8,options,async region=>({width:region.core.width,height:region.core.height,alpha:new Uint8Array(64).fill(255),rgba:new Uint8ClampedArray(256).fill(255),unresolvedPixels:0}),{signal:abort.signal,onProgress:value=>{if(value.completed)abort.abort();}})).rejects.toThrow();
  await expect(encodeMattingOutput(8,8,options,async()=>({width:1,height:1,alpha:new Uint8Array(1),rgba:new Uint8ClampedArray(4),unresolvedPixels:0}))).rejects.toThrow(/worker/);
});
