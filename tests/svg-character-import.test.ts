import {expect,it} from 'vitest';
import {inspectSvgSource} from '../src/core/svg-import';
import {validateSvgInspection} from '../src/engine/svg-import';
import {allLayers} from '../src/core/model';
import {readFileSync} from 'node:fs';

const wrap=(body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">${body}</svg>`;
function text(result:ReturnType<typeof inspectSvgSource>){return allLayers(result.document!.children).find(layer=>layer.kind==='text')!;}

it('keeps nested inline character overrides in inert preparation data without installing document fonts or formatted layers',()=>{
 const result=inspectSvgSource(wrap('<text x="20" y="80" font-family="serif" font-size="20" fill="#123456">A<tspan font-size="40" fill="red">B<tspan font-style="italic">😀</tspan>C</tspan>D</text>'));
 expect(result.report.canImportEditable,result.report.unsupportedFeatures.join('\n')).toBe(true);expect(text(result)).toMatchObject({text:'AB😀CD',fontSize:20,color:'#123456'});expect(text(result)).not.toHaveProperty('characterRanges');expect(result.document?.fontFiles).toBeUndefined();
 expect(result.texts[0]).toMatchObject({x:20,y:80,characterRanges:[{start:1,end:2,format:{fontSize:40,color:'#ff0000'}},{start:2,end:4,format:{fontSize:40,color:'#ff0000',fontStyle:'italic'}},{start:4,end:5,format:{fontSize:40,color:'#ff0000'}}]});expect(()=>validateSvgInspection(result)).not.toThrow();
});
it('preserves paint alpha independently from root group opacity and retains nonpainting character advances',()=>{
 const result=inspectSvgSource(wrap('<text opacity="0.5" fill="#12345680" fill-opacity="0.5">A<tspan fill="none">B</tspan><tspan fill="red" fill-opacity="0.25">C</tspan></text>'));expect(result.report.canImportEditable).toBe(true);expect(text(result)).toMatchObject({text:'ABC',opacity:.5,color:`rgba(18,52,86,${128/255*.5})`});expect(result.texts[0].characterRanges).toEqual([{start:1,end:2,format:{color:'#00000000'}},{start:2,end:3,format:{color:'rgba(255,0,0,0.25)'}}]);
});
it('does not hide painted descendants when their parent has no fill',()=>{
 const result=inspectSvgSource(wrap('<text fill="none">A<tspan fill="red">B</tspan>C</text>'));expect(result.report.canImportEditable).toBe(true);expect(text(result)).toMatchObject({text:'ABC',opacity:1,color:'#00000000'});expect(result.texts[0].characterRanges).toEqual([{start:1,end:2,format:{color:'#ff0000'}}]);
});
it('collapses whitespace across style boundaries without shifting retained character identities',()=>{
 const result=inspectSvgSource(wrap('<text style="white-space:normal">  A <tspan fill="red">  B </tspan> C  </text>'));expect(result.report.canImportEditable).toBe(true);expect(text(result).kind==='text'&&text(result).text).toBe('A B C');expect(result.texts[0].characterRanges).toEqual([{start:2,end:4,format:{color:'#ff0000'}}]);
});
it('retains a collapsed segment break between styled words and normalizes legacy preserved control spaces',()=>{
 for(const attributes of ['', 'xml:space="default"']){const result=inspectSvgSource(wrap(`<text ${attributes}>A\n<tspan fill="red">B</tspan></text>`));expect(result.report.canImportEditable).toBe(true);expect(text(result).text).toBe('A B');expect(result.texts[0].characterRanges).toEqual([{start:2,end:3,format:{color:'#ff0000'}}]);}
 const preserved=inspectSvgSource(wrap('<text xml:space="preserve">A\t\nB</text>'));expect(preserved.report.canImportEditable).toBe(true);expect(text(preserved).text).toBe('A  B');expect(preserved.texts[0]).not.toHaveProperty('characterRanges');
});
it('supports per-run legacy preserve-space normalization and explicit normal whitespace',()=>{
 const result=inspectSvgSource(wrap('<text>A<tspan xml:space="preserve" fill="red"> \n B\t </tspan><tspan style="white-space:normal">  C  </tspan>D</text>'));expect(result.report.canImportEditable).toBe(true);expect(text(result).kind==='text'&&text(result).text).toBe('A   B   C D');
 const pre=inspectSvgSource(wrap('<text style="white-space:pre">  A<tspan fill="red">  B </tspan>  </text>'));expect(pre.report.canImportEditable).toBe(true);expect(text(pre).kind==='text'&&text(pre).text).toBe('  A  B   ');
});
it('retains inline embedded family requests outside the public model until trusted matching',()=>{
 const data=readFileSync('tests/fixtures/fonts/Regular.ttf').toString('base64'),family='CanoliFont_'+'a'.repeat(64),result=inspectSvgSource(wrap(`<style>@font-face{font-family:${family};src:url(data:font/ttf;base64,${data})}</style><text>A<tspan font-family="${family}" font-weight="700">B</tspan></text>`));
 expect(result.report.canImportEditable,result.report.unsupportedFeatures.join('\n')).toBe(true);expect(result.texts[0].characterRanges).toEqual([{start:1,end:2,format:{fontFamily:family,fontWeight:'700'}}]);expect(()=>validateSvgInspection(result)).not.toThrow();
});
it('reconstructs explicitly positioned outer lines with nested character formatting and inherited typography',()=>{
 const result=inspectSvgSource(wrap('<text font-size="20"><tspan x="10" y="40">A<tspan fill="red">B</tspan></tspan><tspan x="20" dy="2em">C<tspan font-size="30">D</tspan></tspan></text>'));expect(result.report.canImportEditable).toBe(true);expect(result.texts.map(value=>[value.x,value.y,value.characterRanges])).toEqual([[10,40,[{start:1,end:2,format:{color:'#ff0000'}}]],[20,80,[{start:1,end:2,format:{fontSize:30}}]]]);
});
it.each(['x="10"','dx="0"','transform="translate(0)"','rotate="0"','textLength="30"','dominant-baseline="middle"','direction="rtl"','text-anchor="middle"','opacity="0.5"','visibility="hidden"','stroke="red"','style="text-decoration:underline"'])('reports unsupported inline semantics rather than dropping them: %s',attributes=>{
 const result=inspectSvgSource(wrap(`<text>A<tspan ${attributes}>B</tspan></text>`));expect(result.report.canImportEditable).toBe(false);expect(result.document).toBeUndefined();expect(result.texts).toEqual([]);expect(()=>validateSvgInspection(result)).not.toThrow();
});
it('validates source-range boundaries, format keys and inert-only publication at the worker boundary',()=>{
 const result=inspectSvgSource(wrap('<text>A<tspan fill="red">😀</tspan>B</text>'));
 for(const ranges of [[{start:1,end:2,format:{color:'red'}}],[{start:0,end:20,format:{color:'red'}}],[{start:1,end:3,format:{wrapWidth:20}}]])expect(()=>validateSvgInspection({...result,texts:[{...result.texts[0],characterRanges:ranges}]})).toThrow();
 const document=structuredClone(result.document)!;const layer=allLayers(document.children).find(layer=>layer.kind==='text')!;if(layer.kind!=='text')throw new Error('Missing text');layer.characterRanges=[];expect(()=>validateSvgInspection({...result,document})).toThrow(/inert/);
});
