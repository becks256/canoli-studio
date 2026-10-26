import {expect,it} from 'vitest';
import {inspectSvgSource} from '../src/core/svg-import';
import {validateSvgInspection} from '../src/engine/svg-import';
import {allLayers} from '../src/core/model';
const wrap=(text:string,path='<path id="baseline" d="M24 150C100 30 340 30 420 150"/>')=>`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><defs>${path}</defs>${text}</svg>`;
it('keeps cubic geometry and styled path text in inert private preparation records',()=>{
 const result=inspectSvgSource(wrap('<text dy="12" font-size="36" fill="#2468ac"><textPath href="#baseline" startOffset="24">A<tspan font-size="60" fill="red">A</tspan>A</textPath></text>'));
 expect(result.report.canImportEditable,result.report.unsupportedFeatures.join('\n')).toBe(true);const layer=allLayers(result.document!.children).find(l=>l.kind==='text')!;expect(layer).toMatchObject({text:'AAA',fontSize:36});expect(layer).not.toHaveProperty('textPath');expect(layer).not.toHaveProperty('textPathOrigin');expect(result.texts[0]).toMatchObject({x:0,y:0,path:{closed:false,startOffset:24,baselineOffset:12,reverse:false,points:[{x:24,y:150,out:{x:100,y:30}},{x:420,y:150,in:{x:340,y:30}}]},characterRanges:[{start:1,end:2,format:{fontSize:60,color:'#ff0000'}}]});expect(()=>validateSvgInspection(result)).not.toThrow();
});
it('copies a referenced path transform and preserves ordinary SVG tree ownership',()=>{
 const result=inspectSvgSource(wrap('<g transform="translate(10 20)"><text><textPath href="#baseline">AAAA</textPath></text></g>','<path id="baseline" transform="scale(2)" d="M0 40L100 40"/>'));expect(result.report.canImportEditable,result.report.unsupportedFeatures.join('\n')).toBe(true);expect(result.texts[0].path?.points.map(p=>[p.x,p.y])).toEqual([[0,80],[200,80]]);
});
it.each(['startOffset="50%"','method="stretch"','spacing="auto"','side="right"','dx="10"','transform="translate(1)"'])('reports unrepresented path layout rather than dropping it: %s',attributes=>{
 const result=inspectSvgSource(wrap(`<text><textPath href="#baseline" ${attributes}>AAAA</textPath></text>`));expect(result.report.canImportEditable).toBe(false);expect(result.document).toBeUndefined();
});
it('rejects compound/calibrated/missing baselines and already-published worker path data',()=>{
 for(const source of [wrap('<text><textPath href="#missing">A</textPath></text>'),wrap('<text><textPath href="#baseline">A</textPath></text>','<path id="baseline" d="M0 40L100 40M200 40L300 40"/>'),wrap('<text><textPath href="#baseline">A</textPath></text>','<path id="baseline" pathLength="100" d="M0 40L100 40"/>')])expect(inspectSvgSource(source).report.canImportEditable).toBe(false);
 const result=inspectSvgSource(wrap('<text><textPath href="#baseline">A</textPath></text>')),document=structuredClone(result.document)!;const layer=allLayers(document.children).find(l=>l.kind==='text')!;if(layer.kind!=='text')throw new Error('Missing text');layer.textPath=result.texts[0].path!;layer.textPathOrigin={x:0,y:0};expect(()=>validateSvgInspection({...result,document})).toThrow('inert');
});
