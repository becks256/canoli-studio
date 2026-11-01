import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolveFontRunSettings,selectNativeFontInstance} from '../src/fonts/css-instance';
import {normalizeFontRun} from '../src/fonts/shaping-types';
import {shapeFontRun} from '../src/fonts/shaping';
import {parseFontVariations} from '../src/core/font-variations';
import {captureNativeFontInstance} from '../src/engine/native-font-instance';
const values=(s:string)=>Object.fromEntries(parseFontVariations(s).map(a=>[a.tag,a.value]));
const axes=[{tag:'wght',min:400,max:800},{tag:'wdth',min:75,max:125},{tag:'ital',min:0,max:1},{tag:'slnt',min:-14,max:0},{tag:'TEST',min:0,max:100},{tag:'opsz',min:8,max:72}],css={weight:700,width:125,style:'italic'as const};
it('maps selected native weight/width/style before exact authored overrides and original ranges',()=>{
 expect(values(resolveFontRunSettings(axes,'normal',css))).toEqual({ital:1,wdth:125,wght:700});
 expect(values(resolveFontRunSettings(axes,'"wght" 550.25,"wdth" 87.5,"ital" .5,"slnt" -7,"TEST" 42,"opsz" 18',css))).toEqual({TEST:42,ital:.5,opsz:18,slnt:-7,wdth:87.5,wght:550.25});
 expect(values(resolveFontRunSettings(axes,'normal',{weight:1000,width:50,style:'normal'}))).toEqual({ital:0,wdth:75,wght:800});
 expect(values(resolveFontRunSettings(axes,'normal',{...css,style:'oblique'}))).toEqual({slnt:-14,wdth:125,wght:700});
 expect(values(resolveFontRunSettings(axes,'normal',{...css,styleAxis:'none'}))).toEqual({wdth:125,wght:700});
 expect(values(resolveFontRunSettings(axes.filter(a=>a.tag!=='ital'),'normal',css))).toEqual({slnt:-14,wdth:125,wght:700});
 expect(resolveFontRunSettings(axes,'"TEST" 42')).toBe('"TEST" 42');
});
it('selects the closest source-face style and clamps native descriptor ranges before source axes',()=>{
 const descriptors=[{style:'normal'as const,weight:'450 750',stretch:'87.5% 112.5%'}];expect(selectNativeFontInstance(css,descriptors)).toEqual({weight:700,width:112.5,style:'normal'});
 expect(selectNativeFontInstance({...css,weight:100,width:50},descriptors)).toEqual({weight:450,width:87.5,style:'normal'});
 expect(selectNativeFontInstance(css,[...descriptors,{...descriptors[0],style:'oblique'}])).toEqual({weight:700,width:112.5,style:'oblique'});
 expect(()=>selectNativeFontInstance(css,[])).toThrow('descriptor');
});
it('uses native relative weights while preserving fractional numeric input lost by shorthand serialization',()=>{
 const descriptors=[{style:'normal'as const,weight:'1 1000',stretch:'50% 200%'}],ctx={font:'bold 40px Source',fontStretch:'condensed'}as CanvasRenderingContext2D;
 expect(captureNativeFontInstance(ctx,'bolder',descriptors)).toEqual({weight:700,width:75,style:'normal'});
 expect(captureNativeFontInstance({...ctx,font:'639 40px Source'}as CanvasRenderingContext2D,'639.75',descriptors).weight).toBe(639.75);
 expect(()=>captureNativeFontInstance({...ctx,font:'invalid'}as CanvasRenderingContext2D,'700',descriptors)).toThrow('native font request');
});
it('snapshots and freezes the resolved instance before asynchronous source shaping',()=>{
 const input={text:'A',css:{...css}},request=normalizeFontRun(input);input.css.weight=400;expect(request.css!.weight).toBe(700);expect(Object.isFrozen(request.css)).toBe(true);
 for(const value of [{...css,weight:1001},{...css,width:0},{...css,style:'fake'},{...css,unrecognized:true}])expect(()=>normalizeFontRun({text:'A',css:value as typeof css})).toThrow();
});
it('actual full HarfBuzz applies source HVAR coordinates and retains the unmodified source',async()=>{
 const bytes=new Uint8Array(await readFile('tests/fixtures/css-font/Css.ttf')),original=bytes.slice(),shape=(weight:number,width:number,style:'normal'|'italic'='normal',settings='normal')=>shapeFontRun(bytes,{text:'A',css:{weight,width,style}},settings).glyphs[0].xAdvance;
 expect(shape(600,100)).toBe(1400);expect(shape(639.75,100)).toBe(1559);expect(shape(700,125,'italic')).toBe(1980);expect(shape(700,125,'italic','"wght" 550.25,"wdth" 87.5,"ital" .5,"slnt" -7')).toBe(1163);expect(bytes).toEqual(original);
});
