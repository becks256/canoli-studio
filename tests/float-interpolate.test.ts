import{it,expect}from'vitest';
import{interpolateFloatBackdrops}from'../src/engine/float-interpolate';
it('completed-backdrop interpolation blends premultiplied coverage once and preserves extended RGB',async()=>{
 const before=new Float32Array([-2,4,.25,.25]),after=new Float32Array([6,-4,2,.75]),actual=await interpolateFloatBackdrops(before,after,.5,undefined,()=>{});
 expect([...actual]).toEqual([4,-2,1.5625,.5]);expect([...before]).toEqual([-2,4,.25,.25]);expect([...after]).toEqual([6,-4,2,.75]);
 const masked=await interpolateFloatBackdrops(before,after,1,new Float32Array([.5]),()=>{});expect(masked).toEqual(actual);
});
it('inert and complete float interpolation return owned exact samples, including hidden transparent color',async()=>{
 const before=new Float32Array([-2.25,4,.25,0]),after=new Float32Array([6.125,-4,2,.75]);for(const amount of[0,1]){const actual=await interpolateFloatBackdrops(before,after,amount,undefined,()=>{});expect(actual).toEqual(amount?after:before);actual.fill(99);}expect(before[0]).toBe(-2.25);expect(after[0]).toBe(6.125);
});
it('interpolation rejects malformed, nonfinite, invalid coverage and cancelled output',async()=>{
 const valid=new Float32Array([1,2,3,1]);await expect(interpolateFloatBackdrops(valid,new Float32Array(0),1,undefined,()=>{})).rejects.toThrow('geometry');await expect(interpolateFloatBackdrops(valid,valid,1,new Float32Array([NaN]),()=>{})).rejects.toThrow('coverage');await expect(interpolateFloatBackdrops(valid,valid,1,undefined,()=>{throw new Error('Closed capture');})).rejects.toThrow('Closed capture');
});
