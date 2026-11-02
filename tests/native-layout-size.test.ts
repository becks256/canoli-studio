import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {nativeLayoutSizeFontBytes} from '../src/engine/native-layout-size-font';
import {captureNativeLayoutSize} from '../src/engine/native-layout-size';
import {shapeFontRun} from '../src/fonts/shaping';

it('independent GPOS calibration adds exactly one em per adjacent pair in actual shaping WASM',()=>{
 const bytes=nativeLayoutSizeFontBytes(),before=bytes.slice();
 expect(createHash('sha256').update(bytes).digest('hex')).toBe('98c1d44caa15fa4a75d89e66f99a0304cfff3553462fda7a5fb6fca71ca3c72f');
 for(const text of ['A','AA','AAA']){
  const run=(kern:number)=>shapeFontRun(bytes,{text,features:[{tag:'kern',value:kern}]});
  const off=run(0),on=run(1);
  expect(off.unitsPerEm).toBe(2048);
  expect(off.glyphs.map(g=>g.glyphId)).toEqual([...text].map(()=>1));
  expect(off.glyphs.reduce((n,g)=>n+g.xAdvance,0)).toBe(text.length*2048);
  expect(on.glyphs.reduce((n,g)=>n+g.xAdvance,0)-off.glyphs.reduce((n,g)=>n+g.xAdvance,0)).toBe((text.length-1)*2048);
 }
 expect(bytes).toEqual(before);bytes.fill(0);expect(nativeLayoutSizeFontBytes()).toEqual(before);
});

it('invalid native layout sizes and budgets reject before creating browser resources',async()=>{
 for(const size of [0,-1,NaN,Infinity])await expect(captureNativeLayoutSize(size)).rejects.toThrow('Invalid native text size');
 for(const timeoutMs of [0,-1,1.5,Infinity,0x80000000])await expect(captureNativeLayoutSize(13.5,{timeoutMs})).rejects.toThrow('Invalid native text size');
});
