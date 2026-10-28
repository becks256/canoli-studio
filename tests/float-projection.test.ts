import{it,expect}from'vitest';
import{projectFloatWindow,type FloatWindowSource}from'../src/engine/float-projection';
import{AffineTransform}from'../src/core/affine';
import type{FloatSourceWindow,FloatSourceControl}from'../src/core/float-source/types';
function source(width:number,height:number,pixel:(x:number,y:number)=>number[]):FloatWindowSource&{reads:FloatSourceWindow[]}{
 return{width,height,reads:[],async readWindow(bounds,control){control?.signal?.throwIfAborted();control?.onProgress?.({phase:'reading',fraction:0});this.reads.push(bounds);const output=new Float32Array(bounds.width*bounds.height*4);for(let y=0;y<bounds.height;y++)for(let x=0;x<bounds.width;x++)output.set(pixel(bounds.x+x,bounds.y+y),(y*bounds.width+x)*4);return output;}};
}
it('float projection preserves an analytic signed linear plane under affine interior sampling',async()=>{
 const original=source(71,53,(x,y)=>[x*.125+y*.25-8,y*.0625-x*.125+2,x*.03125+y*.0625,1]),matrix=new AffineTransform(1.5,.125,-.25,1.25,4,7),inverse=matrix.inverse(),bounds={x:25,y:25,width:18,height:16},actual=await projectFloatWindow(original,matrix,bounds);
 for(let y=0;y<bounds.height;y++)for(let x=0;x<bounds.width;x++){const p=inverse.point({x:bounds.x+x+.5,y:bounds.y+y+.5}),sx=p.x-.5,sy=p.y-.5,expected=new Float32Array([sx*.125+sy*.25-8,sy*.0625-sx*.125+2,sx*.03125+sy*.0625,1]);expect(actual.subarray((y*bounds.width+x)*4,(y*bounds.width+x+1)*4)).toEqual(expected);}
 expect(original.reads).toHaveLength(1);
});
it('premultiplied float filtering prevents hidden color leakage without clipping extended color',async()=>{
 const original=source(2,1,x=>x?[3,7,-2,1]:[-10,4,0,0]),actual=await projectFloatWindow(original,AffineTransform.scale(2),{x:0,y:0,width:4,height:2});
 expect([...actual]).toEqual([0,0,0,0,3,7,-2,.25,3,7,-2,.75,3,7,-2,1,0,0,0,0,3,7,-2,.25,3,7,-2,.75,3,7,-2,1]);
});
it('fractional rectangle and diamond edges retain analytic area in float alpha',async()=>{
 const original=source(1,1,()=>[-.5,3.25,1.03125,1]),fractional=await projectFloatWindow(original,AffineTransform.translation(.25,.75),{x:0,y:0,width:2,height:2}),diamond=await projectFloatWindow(original,new AffineTransform(1,1,-1,1,1,0),{x:0,y:0,width:2,height:2});
 expect([...fractional.filter((_,i)=>i%4===3)]).toEqual([.1875,.0625,.5625,.1875]);expect([...diamond.filter((_,i)=>i%4===3)]).toEqual([.5,.5,.5,.5]);for(const values of[fractional,diamond])for(let i=0;i<values.length;i+=4)expect([...values.subarray(i,i+3)]).toEqual([-.5,3.25,1.03125]);
});
it('sparse extreme projections bound every native read without reducing original geometry',async()=>{
 const original=source(1000000,5000,(x,y)=>[x/1048576,y/8192,-.125,1]),actual=await projectFloatWindow(original,AffineTransform.scale(1/100000,1/1000),{x:0,y:0,width:10,height:5});expect(actual.length).toBe(200);expect(original.reads.length).toBeGreaterThan(1);expect(original.reads.every(b=>b.width*b.height<=262144&&b.x>=0&&b.y>=0&&b.x+b.width<=1000000&&b.y+b.height<=5000)).toBe(true);expect(actual[0]).toBe(Math.fround(49999.5/1048576));expect(actual[1]).toBe(Math.fround(499.5/8192));
});
it('float projection is partition invariant under reflection, shear and large placement',async()=>{
 const original=source(31,23,(x,y)=>[x*.0625-1,y*.125,2.03125,(x+y)%7/8]),shift=2**30,matrix=new AffineTransform(-1.375,.25,.3125,1.125,shift+41.25,shift+3.125),bounds={x:shift,y:shift,width:52,height:39},whole=await projectFloatWindow(original,matrix,bounds),partitioned=new Float32Array(whole.length);
 for(let y=0;y<bounds.height;y+=7)for(let x=0;x<bounds.width;x+=11){const width=Math.min(11,bounds.width-x),height=Math.min(7,bounds.height-y),tile=await projectFloatWindow(original,matrix,{x:bounds.x+x,y:bounds.y+y,width,height});for(let row=0;row<height;row++)partitioned.set(tile.subarray(row*width*4,(row+1)*width*4),((y+row)*bounds.width+x)*4);}expect(partitioned).toEqual(whole);
});
it('cancelled, stale and malformed source reads cannot publish a partial float projection',async()=>{
 const original=source(8,8,()=>[1,2,3,1]),abort=new AbortController();abort.abort();await expect(projectFloatWindow(original,AffineTransform.scale(1),{x:0,y:0,width:8,height:8},{signal:abort.signal})).rejects.toThrow();expect(original.reads).toHaveLength(0);
 const bad={...original,async readWindow(){return new Float32Array(4);}};await expect(projectFloatWindow(bad,AffineTransform.scale(1),{x:0,y:0,width:8,height:8})).rejects.toThrow('geometry');const invalid={...original,async readWindow(b:FloatSourceWindow){return new Float32Array(b.width*b.height*4).fill(NaN);}};await expect(projectFloatWindow(invalid,AffineTransform.scale(1),{x:0,y:0,width:8,height:8})).rejects.toThrow('invalid');
 let stale=false;const changed={...original,async readWindow(b:FloatSourceWindow,c?:FloatSourceControl){const result=await original.readWindow(b,c);stale=true;return result;}};await expect(projectFloatWindow(changed,AffineTransform.scale(1),{x:0,y:0,width:8,height:8},{isCancelled:()=>stale})).rejects.toThrow();await expect(projectFloatWindow(original,new AffineTransform(0,0,0,0),{x:0,y:0,width:1,height:1})).rejects.toThrow('singular');
});

it('aligned native windows copy owned samples with exact padding, canonical zeros and partition independence',async()=>{
 const pixels=new Float32Array([-.125,1.03125,3,.5,-0,2,3,1,9,8,7,0,1.2,-.3,.75,.375]),original={width:4,height:1,readWindow:async(b:FloatSourceWindow)=>pixels.slice(b.x*4,(b.x+b.width)*4)},frame=AffineTransform.translation(10,-3),bounds={x:8,y:-4,width:8,height:3},actual=await projectFloatWindow(original,frame,bounds),wanted=new Float32Array(8*3*4);wanted.set([-.125,1.03125,3,.5,0,2,3,1,0,0,0,0,...pixels.subarray(12)],(8+2)*4);expect(new Uint32Array(actual.buffer)).toEqual(new Uint32Array(wanted.buffer));const parts=new Float32Array(actual.length);for(let y=0;y<3;y++)parts.set(await projectFloatWindow(original,frame,{x:8,y:y-4,width:8,height:1}),y*8*4);expect(new Uint32Array(parts.buffer)).toEqual(new Uint32Array(actual.buffer));expect(actual.buffer).not.toBe(pixels.buffer);expect(Object.is(pixels[4],-0)).toBe(true);expect(pixels[8]).toBe(9);
});
it('aligned integer origins retain native samples at the edge of representable world coordinates',async()=>{
 const shift=2**52,original=source(4,1,x=>[x+.125,x+.25,x+.5,1]),actual=await projectFloatWindow(original,AffineTransform.translation(shift,0),{x:shift,y:0,width:4,height:1});expect([...actual]).toEqual([.125,.25,.5,1,1.125,1.25,1.5,1,2.125,2.25,2.5,1,3.125,3.25,3.5,1]);
});
