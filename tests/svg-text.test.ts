import {describe,it,expect} from 'vitest';
import {Document,TextLayer,LayerGroup,LayerMask,LayerStyle} from '../src/dom';
import {planSvgTexts,svgTextElements,svgWhitespaceRuns,type SvgTextLayout} from '../src/core/svg-text';
import {svgDocumentChunks} from '../src/core/svg-export';
import {planSvgMasks} from '../src/core/svg-masks';
import {planSvgStyles} from '../src/core/svg-styles';
import {getExportCapabilityReport} from '../src/engine/export';

function data(layer:TextLayer){const value=layer.toJSON();if(value.kind!=='text')throw new Error('Expected text');return value;}
const layout:SvgTextLayout={baselines:[22],color:'#123456',letterSpacing:2};
describe('editable SVG text',()=>{
 it('keeps complete literal text and root typography with whitespace-only inline spacing',()=>{
  const text=data(new TextLayer({text:'  A\u00a0<&\tB  ',wordSpacing:8})),before=structuredClone(text);
  const runs=svgWhitespaceRuns(text.text,1),svg=[...svgTextElements(text,{...layout,spacingRuns:[runs]})].join('');
  expect(runs).toEqual([{start:0,end:2,wordSpacing:0},{start:6,end:7,wordSpacing:0},{start:8,end:10,wordSpacing:0}]);
  expect(svg).toContain('word-spacing="8"');expect(svg).toContain('<tspan word-spacing="0">  </tspan>A\u00a0&lt;&amp;<tspan word-spacing="0"> </tspan>B<tspan word-spacing="0">  </tspan>');
  expect(svg.match(/<text /g)).toHaveLength(1);expect(svg.match(/<tspan /g)).toHaveLength(3);expect(svg).not.toMatch(/<tspan[^>]*(?: x=| y=| dx=| dy=)/);expect(text).toEqual(before);
  expect(svgWhitespaceRuns(text.text,2)).toEqual([{start:3,end:4,wordSpacing:0}]);expect(svgWhitespaceRuns(text.text,4)).toEqual([{start:0,end:2,wordSpacing:0},{start:8,end:10,wordSpacing:0}]);
 });
 it('rejects malformed or non-whitespace prepared spans before encoding text',()=>{
  const text=data(new TextLayer({text:' A B '}));
  for(const runs of [[{start:-1,end:1,wordSpacing:0}],[{start:0,end:NaN,wordSpacing:0}],[{start:0,end:1.5,wordSpacing:0}],[{start:0,end:0,wordSpacing:0}],[{start:0,end:9,wordSpacing:0}],[{start:1,end:2,wordSpacing:0}],[{start:0,end:1,wordSpacing:1}],[{start:2,end:3,wordSpacing:0},{start:0,end:1,wordSpacing:0}],[{start:0,end:1,wordSpacing:0},{start:0,end:1,wordSpacing:0}]]){
   expect(()=>[...svgTextElements(text,{...layout,spacingRuns:[runs as never]})]).toThrow(/whitespace run/);
  }
  expect(()=>[...svgTextElements(text,{...layout,spacingRuns:[]})]).toThrow(/line count/);expect(()=>[...svgTextElements(text,{...layout,spacingRuns:[undefined as never]})]).toThrow(/whitespace runs/);
 });
 it('never splits a whitespace grapheme, including after native ASCII normalization',()=>{
  for(const space of [' ','\u00a0','\t','\r','\f'])for(const mark of ['\u0301','\u200d','\ufe0f']){
   const source=space+mark+'A',text=data(new TextLayer({text:source}));
   expect(svgWhitespaceRuns(source,3)).toEqual([]);
   expect(()=>[...svgTextElements(text,{...layout,spacingRuns:[[{start:0,end:1,wordSpacing:0}]]})]).toThrow(/complete native graphemes/);
  }
  expect(svgWhitespaceRuns('  ffi j\u0301 👩‍👩‍👧‍👦',1)).toHaveLength(3);
 });
 it('declines optional inline styling when native segmentation is unavailable',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(Intl,'Segmenter')!;
  try{
   Object.defineProperty(Intl,'Segmenter',{value:undefined,configurable:true});
   expect(svgWhitespaceRuns(' A B ',1)).toEqual([]);
   const text=data(new TextLayer({text:' A B '}));expect(()=>[...svgTextElements(text,{...layout,spacingRuns:[[]]})]).not.toThrow();
   expect(()=>[...svgTextElements(text,{...layout,spacingRuns:[[{start:0,end:1,wordSpacing:0}]]})]).toThrow(/complete native graphemes/);
  }finally{Object.defineProperty(Intl,'Segmenter',descriptor);}
 });
 it('exports literal word spacing and validated kerning without CSS injection',()=>{
  const text=data(new TextLayer({text:'AV wide words',wordSpacing:12,fontKerning:'none'})),svg=[...svgTextElements(text,layout)].join('');expect(svg).toContain('word-spacing="12"');expect(svg).toContain('font-kerning:none');
  expect(()=>[...svgTextElements({...text,fontKerning:'none;fill:url(https://invalid)' as never},layout)]).toThrow(/kerning/);expect(()=>[...svgTextElements({...text,wordSpacing:Infinity},layout)]).toThrow();
  expect(()=>[...svgTextElements(text,{...layout,xOffsets:[]})]).toThrow(/spacing positions/);expect(()=>[...svgTextElements(text,{...layout,xOffsets:[NaN]})]).toThrow(/spacing positions/);
 });
 it('plans visible nonempty text, excluding hidden and zero-opacity ancestors',()=>{
  const doc=new Document(),group=doc.layers.add(new LayerGroup()),text=group.layers.add(new TextLayer({text:'Hello'}));doc.layers.add(new TextLayer({text:''}));
  expect(planSvgTexts(doc.toJSON()).map(l=>l.id)).toEqual([text.id]);group.visible=false;expect(planSvgTexts(doc.toJSON())).toEqual([]);group.visible=true;group.opacity=0;expect(planSvgTexts(doc.toJSON())).toEqual([]);
 });
 it('retains explicit line baselines, Unicode and literal markup with native whitespace normalization',()=>{
  const text=data(new TextLayer({text:'A <script> & "B"\t\r\f🙂\nC',fontFamily:'"A & B", serif'}));
  const svg=[...svgTextElements(text,{...layout,baselines:[21.125,51.525]})].join('');
  expect(svg).toContain('y="21.125"');expect(svg).toContain('y="51.525"');expect(svg).toContain('A &lt;script&gt; &amp; &quot;B&quot;   🙂');expect(svg).toContain('font-family="&quot;A &amp; B&quot;, serif"');expect(svg).toContain('white-space:pre');expect(svg).not.toContain('<script>');
 });
 it('maps physical left/center/right alignment independently of inline direction',()=>{
  const doc=new Document(),text=doc.layers.add(new TextLayer({text:'ab'}));
  for(const direction of ['ltr','rtl'] as const)for(const align of ['left','center','right'] as const){
   text.update({direction,align});const svg=[...svgTextElements({...data(text),width:120},layout)].join(''),anchor=align==='center'?'middle':align==='left'?(direction==='ltr'?'start':'end'):(direction==='ltr'?'end':'start');
   expect(svg).toContain(`text-anchor="${anchor}"`);expect(svg).toContain(`x="${align==='center'?60:align==='right'?120:0}"`);
  }
 });
 it('requires real host measurements and rejects mismatched or unsafe prepared text',()=>{
  const text=data(new TextLayer({text:'Hello'}));expect(()=>[...svgTextElements(text)]).toThrow('host font measurement');expect(()=>[...svgTextElements(text,{...layout,baselines:[]})]).toThrow('line count');expect(()=>[...svgTextElements(text,{...layout,color:'url(https://example.com/paint.svg)'})]).toThrow('literal color');expect(()=>[...svgTextElements(text,{...layout,baselines:[NaN]})]).toThrow('finite');
 });
 it('rejects XML-invalid literal text without modifying the layer',()=>{
  const text=new TextLayer({text:'a\u0000b'}),before=data(text);expect(()=>[...svgTextElements(before,layout)]).toThrow('XML 1.0');expect(text.toJSON()).toEqual(before);
 });
 it('shares full affine hierarchy, masks, styles and opacity without rasterizing glyphs',()=>{
  const doc=new Document(),group=doc.layers.add(new LayerGroup({x:12,y:8,opacity:0.5})),text=group.layers.add(new TextLayer({text:'Hello',fillOpacity:0}));text.mask=new LayerMask({base:0.5});text.styles=new LayerStyle({dropShadow:{enabled:true,opacity:1,color:'#0000ff',blur:2,x:4,y:6}});
  const before=doc.toJSON();expect(planSvgMasks(before)).toHaveLength(1);expect(planSvgStyles(before)).toHaveLength(1);
  // This mask needs native coverage, so test text + hierarchy with a separate
  // pure copy after removing the mask through the ordinary DOM setter.
  text.mask=null;const snapshot=doc.toJSON(),svg=[...svgDocumentChunks(snapshot,undefined,undefined,new Map([[text.id,layout]]))].join('');
  expect(svg).toContain('<text ');expect(svg).toContain('matrix(1 0 0 1 12 8)');expect(svg).toContain('<filter ');expect(svg).not.toContain('<image ');expect(doc.toJSON()).toEqual(snapshot);
 });
 it('reports editable text and font portability rather than omission or an empty canvas',()=>{
  const doc=new Document();doc.layers.add(new TextLayer({text:'Hello'}));const report=getExportCapabilityReport(doc.toJSON(),{format:'svg'});
  expect(report.featuresPreserved.join(' ')).toContain('Editable SVG text');expect(report.warnings.join(' ')).toContain('without embedding font files');expect(report.warnings.join(' ')).not.toContain('empty canvas');expect(report.featuresDegradedOrOmitted).not.toContain('Text layers');
 });
});
