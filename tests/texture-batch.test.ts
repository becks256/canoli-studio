import {describe,it,expect} from 'vitest';
import {BrushTextureSampler} from '../src/engine/brush-texture';
import type {AssetStore} from '../src/core/assets';

function fixture(){
 const original={width:1,height:1,bitmap:{width:1,height:1}},state={asset:original,calls:0};
 const assets={get:()=>state.asset,has:()=>true,captureLifetime:()=>()=>{}} as unknown as AssetStore;
 const sampler=new BrushTextureSampler({brushTexture:async pixels=>{state.calls++;return pixels;}});
 const sample={width:16,height:16,sourceToOutput:{a:1,b:0,c:0,d:1,e:0,f:0}};
 return{original,state,assets,sampler,sample};
}

describe('texture batch validation before Canvas allocation or worker execution',()=>{
 it('rejects sparse input instead of publishing an undefined tile',async()=>{
  const f=fixture();try{await expect(f.sampler.prepareAffineBatch(f.assets,{assetId:'texture'},Array(1))).rejects.toThrow(/expected object/);expect(f.state.calls).toBe(0);}finally{f.sampler.dispose();}
 });
 it('bounds total working pixels without restricting original source dimensions',async()=>{
  const f=fixture();f.original.width=f.original.bitmap.width=10000;f.original.height=f.original.bitmap.height=5000;
  try{await expect(f.sampler.prepareAffineBatch(f.assets,{assetId:'texture'},Array.from({length:2},()=>({...f.sample,width:1000,height:1000})))).rejects.toThrow('at most 1,000,000 working pixels');expect(f.state.calls).toBe(0);expect([f.original.width,f.original.height]).toEqual([10000,5000]);}finally{f.sampler.dispose();}
 });
 it('bounds preparation bookkeeping as well as converted pixels',async()=>{
  const f=fixture();try{await expect(f.sampler.prepareAffineBatch(f.assets,{assetId:'texture'},Array.from({length:65},()=>f.sample))).rejects.toThrow('at most 64 samples');expect(f.state.calls).toBe(0);}finally{f.sampler.dispose();}
 });
 for(const action of ['replace-asset','replace-bitmap'] as const)it(`rejects ${action} while capturing caller-owned sampling data`,async()=>{
  const f=fixture(),matrix={...f.sample.sourceToOutput,get e(){if(action==='replace-asset')f.state.asset={width:1,height:1,bitmap:{width:1,height:1}};else f.original.bitmap={width:1,height:1};return 0;}};
  try{await expect(f.sampler.prepareAffineBatch(f.assets,{assetId:'texture'},[{...f.sample,sourceToOutput:matrix}])).rejects.toThrow('texture source changed during batch preparation');expect(f.state.calls).toBe(0);}finally{f.sampler.dispose();}
 });
 for(const regions of [[],Array(1),[{x:-1,y:0,width:1,height:1}],[{x:15,y:0,width:2,height:1}],[{x:0,y:0,width:1.5,height:1}]])it('rejects missing or invalid readback rectangles before allocation',async()=>{
  const f=fixture();try{await expect(f.sampler.prepareAffineBatch(f.assets,{assetId:'texture'},[f.sample],{},regions)).rejects.toThrow(/readback region/);expect(f.state.calls).toBe(0);}finally{f.sampler.dispose();}
 });
 it('checks source lifetime after readback descriptor getters execute',async()=>{
  const f=fixture(),region={get x(){f.original.bitmap={width:1,height:1};return 0;},y:0,width:1,height:1};
  try{await expect(f.sampler.prepareAffineBatch(f.assets,{assetId:'texture'},[f.sample],{},[region])).rejects.toThrow('texture source changed during batch preparation');expect(f.state.calls).toBe(0);}finally{f.sampler.dispose();}
 });

});
