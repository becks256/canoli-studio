import {beforeAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {shapeFontRun} from '../src/fonts/shaping';
import {normalizeFontRun,validateFontRun,encodeFontRun,decodeFontRun} from '../src/fonts/shaping-types';
let bytes:Uint8Array;
beforeAll(async()=>{bytes=new Uint8Array(await readFile('tests/fixtures/shaping-font/Shaping.ttf'));});
const glyphs=(text:string,extra:Partial<Parameters<typeof shapeFontRun>[1]>={})=>shapeFontRun(bytes,{text,...extra}).glyphs;
it('uses original GSUB/GPOS for ligatures, kerning and combining marks without rewriting the source',()=>{
 const before=bytes.slice();expect(glyphs('fi').map(g=>g.glyphId)).toEqual([6]);expect(glyphs('fi',{text:'fi',features:[{tag:'liga',value:0}]}).map(g=>g.glyphId)).toEqual([4,5]);
 expect(glyphs('AV').map(g=>g.xAdvance)).toEqual([520,600]);expect(glyphs('AV',{text:'AV',features:[{tag:'kern',value:0}]}).map(g=>g.xAdvance)).toEqual([600,600]);
 expect(glyphs('a\u0301').map(g=>[g.glyphId,g.cluster,g.xAdvance,g.xOffset,g.yOffset])).toEqual([[7,0,600,0,0],[8,0,0,-320,700]]);expect(bytes).toEqual(before);
});
it('retains contextual Arabic substitutions and visual RTL cluster order',()=>{
 expect(glyphs('ببلا',{text:'ببلا',direction:'rtl'}).map(g=>[g.glyphId,g.cluster])).toEqual([[11,2],[14,1],[13,0]]);
 expect(glyphs('אב',{text:'אב',direction:'rtl'}).map(g=>[g.glyphId,g.cluster])).toEqual([[17,1],[16,0]]);
 const full=glyphs('ببب',{text:'ببب',direction:'rtl'}),item=glyphs('ببب',{text:'ببب',direction:'rtl',itemOffset:1,itemLength:1});expect(item[0].glyphId).toBe(full[1].glyphId);expect(item[0].cluster).toBe(1);
});
it('uses source vertical metrics in the full runtime rather than em-square synthesized advances',()=>{
 const rows=glyphs('AV',{text:'AV',direction:'ttb'});expect(rows.map(g=>g.yAdvance)).toEqual([-1100,-1100]);expect(rows.map(g=>g.xAdvance)).toEqual([0,0]);expect(rows.map(g=>g.xOffset)).toEqual([-300,-300]);
 expect(glyphs('AV',{text:'AV',direction:'btt'}).map(g=>g.cluster)).toEqual([1,0]);
});
it('nominal metrics retain original glyph identities and UTF-16 ranges without GSUB, GPOS or bidi substitution',()=>{
 const a=glyphs('AV',{nominal:true}),b=glyphs('fi',{nominal:true});expect(a.map(g=>[g.glyphId,g.cluster,g.xAdvance])).toEqual([[2,0,600],[3,1,600]]);expect(b.map(g=>g.glyphId)).toEqual([4,5]);expect(b.every(g=>g.xOffset===0&&g.yOffset===0&&g.yAdvance===0&&g.flags===0)).toBe(true);
 expect(glyphs('😀AV',{nominal:true,itemOffset:2,itemLength:2}).map(g=>[g.glyphId,g.cluster])).toEqual([[2,2],[3,3]]);expect(()=>normalizeFontRun({text:'A',direction:'rtl',nominal:true})).toThrow('left-to-right');
 const request=normalizeFontRun({text:'fi',nominal:true}),result=shapeFontRun(bytes,request);expect(validateFontRun(result,request,'normal',{unitsPerEm:1000,glyphCount:18}).glyphs).toEqual(b);
});
it('reports original UTF-16 clusters, missing glyphs and empty runs explicitly',()=>{
 expect(glyphs('😀A').map(g=>[g.glyphId,g.cluster])).toEqual([[0,0],[2,2]]);expect(glyphs('')).toEqual([]);expect(glyphs('AV',{text:'AV',itemOffset:2,itemLength:0})).toEqual([]);
 for(const request of [{text:'\ud800'},{text:'😀A',itemOffset:1},{text:'😀A',itemLength:1},{text:'A',itemOffset:2},{text:'A',itemLength:2}])expect(()=>normalizeFontRun(request)).toThrow();
});
it('nominal vertical metrics retain original cmap, vmtx and glyph origins without vertical substitutions',async()=>{
 const source=new Uint8Array(await readFile('tests/fixtures/vertical-font/Vertical.ttf')),request=normalizeFontRun({text:'A、',direction:'ttb',nominal:true}),result=shapeFontRun(source,request);expect(result.glyphs.map(g=>[g.glyphId,g.cluster,g.xAdvance,g.yAdvance,g.xOffset,g.yOffset])).toEqual([[2,0,0,-1200,-300,-800],[6,1,0,-1000,-500,-360]]);expect(shapeFontRun(source,{text:'、',direction:'ttb'}).glyphs[0].glyphId).toBe(7);expect((await decodeFontRun(encodeFontRun(result),request,'normal',{unitsPerEm:1000,glyphCount:8},()=>{})).glyphs).toEqual(result.glyphs);expect(()=>normalizeFontRun({text:'A',nominal:true,direction:'btt'})).toThrow('source order');
});
it('native metric callbacks preserve source identity and source units without changing subsequent default shaping',async()=>{
 const source=new Uint8Array(await readFile('tests/fixtures/vertical-font/Vertical.ttf')),nativeMetrics={em:40,glyphs:[{glyphId:2,hAdvance:26,vAdvance:-49,vOriginX:13,vOriginY:33,extents:{xBearing:0,yBearing:24,width:16,height:-24}}]},request=normalizeFontRun({text:'A',direction:'ttb',nominal:true,nativeMetrics}),result=shapeFontRun(source,request);nativeMetrics.glyphs[0].vOriginY=99;expect(result.glyphs.map(g=>[g.glyphId,g.yAdvance,g.xOffset,g.yOffset])).toEqual([[2,-1225,-325,-825]]);expect(Object.isFrozen(request.nativeMetrics!.glyphs[0].extents)).toBe(true);expect(shapeFontRun(source,{text:'A',direction:'ttb'}).glyphs[0].yAdvance).toBe(-1200);expect((await decodeFontRun(encodeFontRun(result),request,'normal',{unitsPerEm:1000,glyphCount:8},()=>{})).glyphs).toEqual(result.glyphs);
 for(const bad of [{...nativeMetrics,em:0},{...nativeMetrics,em:1e30},{...nativeMetrics,glyphs:[nativeMetrics.glyphs[0],nativeMetrics.glyphs[0]]},{...nativeMetrics,glyphs:[{...nativeMetrics.glyphs[0],hAdvance:NaN}]}])expect(()=>normalizeFontRun({text:'A',nativeMetrics:bad})).toThrow();expect(()=>shapeFontRun(source,{text:'A',nativeMetrics:{...nativeMetrics,glyphs:[{...nativeMetrics.glyphs[0],glyphId:8}]}})).toThrow('retained source');
});
it('preserves exact variable coordinates instead of substituting a byte or default-instance shape',async()=>{
 const source=new Uint8Array(await readFile('tests/fixtures/font-variations/Axes.ttf')),plain=shapeFontRun(source,{text:'A'}),axis=shapeFontRun(source,{text:'A'},'"TEST" 50,"wght" 600');expect(axis.glyphs[0].glyphId).toBe(plain.glyphs[0].glyphId);expect(axis.glyphs[0].xAdvance).not.toBe(plain.glyphs[0].xAdvance);
});
it('freezes request/result snapshots and validates transferred glyph IDs, clusters, metrics and identity',async()=>{
 const input={text:'AV',features:[{tag:'kern',value:1}]},request=normalizeFontRun(input),result=shapeFontRun(bytes,request),identity={unitsPerEm:1000,glyphCount:18};input.features[0].value=0;input.text='fi';expect(request.text).toBe('AV');expect(request.features[0].value).toBe(1);
 const run=await decodeFontRun(encodeFontRun(result),request,'normal',identity,()=>{});expect(run.glyphs).toEqual(result.glyphs);expect(Object.isFrozen(run.glyphs[0])).toBe(true);expect(Object.isFrozen(run.request.features)).toBe(true);
 for(const patch of [{glyphId:18},{cluster:2},{xAdvance:NaN},{flags:8}]){const bad={...result,glyphs:[{...result.glyphs[0],...patch}]};expect(()=>validateFontRun(bad,request,'normal',identity)).toThrow();await expect(decodeFontRun(encodeFontRun(bad),request,'normal',identity,()=>{})).rejects.toThrow();}
 await expect(decodeFontRun({...encodeFontRun(result),data:new Float64Array(1)},request,'normal',identity,()=>{})).rejects.toThrow('transfer');
 expect(()=>validateFontRun(result,request,'normal',{...identity,glyphCount:19})).toThrow('identity');
 expect(()=>validateFontRun({...result,glyphs:[result.glyphs[1],result.glyphs[0]]},request,'normal',identity)).toThrow('order');
 await expect(decodeFontRun(encodeFontRun(result),request,'normal',identity,()=>{throw new Error('Owner retired');})).rejects.toThrow('Owner retired');
});
it('checks cancellation at native execution boundaries and rejects invalid source bytes',()=>{
 expect(()=>shapeFontRun(bytes,{text:'AV'},'normal',()=>{throw new Error('Cancelled shape');})).toThrow('Cancelled shape');expect(()=>shapeFontRun(new Uint8Array(),{text:'AV'})).toThrow('SFNT');
});
it('yields while validating expanded native glyph output so cancellation prevents publication',async()=>{
 const request=normalizeFontRun({text:'A'}),result=shapeFontRun(bytes,request),row=result.glyphs[0],many={...result,glyphs:Array.from({length:16000},()=>({...row}))},abort=new AbortController();let interrupted=false;
 setTimeout(()=>{interrupted=true;abort.abort(new Error('Cancelled expanded shape'));},0);
 await expect(decodeFontRun(encodeFontRun(many),request,'normal',{unitsPerEm:1000,glyphCount:18},()=>abort.signal.throwIfAborted())).rejects.toThrow('Cancelled expanded shape');expect(interrupted).toBe(true);
});
