import {describe,it,expect} from 'vitest';
import {inspectSvgSource} from '../src/core/svg-import';
import {parseSvgContours,svgNumbers,svgTransform,svgViewBox} from '../src/core/svg-path-import';
import {Document,VectorPath,parseSvgPath} from '../src/dom';
import {allLayers} from '../src/core/model';
import {validateSvgInspection,svgImportOptionsSchema} from '../src/engine/svg-import';

const svg=(body:string,attributes='width="120" height="80"')=>`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;
describe('SVG geometry admission',()=>{
 it('preserves disjoint contours, exact closure and relative command origins',()=>{
  const p=parseSvgContours('m10 10 10 0 h10 v10 l-20 0 z M50 20L50.001 20Z');
  expect(p.contours.map(c=>c.closed)).toEqual([true,true]);expect(p.contours[0].points.map(p=>[p.x,p.y])).toEqual([[10,10],[20,10],[30,10],[30,20],[10,20]]);expect(p.contours[1].points).toHaveLength(2);
 });
 it('converts quadratics and reflects only compatible predecessor controls',()=>{
  const p=parseSvgContours('M0 0 Q30 60 60 0 T120 0 L130 0 S140 10 150 0').contours[0].points;
  expect(p[0].out).toEqual({x:20,y:40});expect(p[1].in).toEqual({x:40,y:40});expect(p[1].out).toEqual({x:80,y:-40});expect(p[2].in).toEqual({x:100,y:-40});expect(p[3].out).toEqual({x:130,y:0});
 });
 it('converts rotated/corrected/compact-flag elliptical arcs with exact endpoints',()=>{
  const p=parseSvgContours('M0 0 A2 3 45 01100 40 a0 3 0 0 0 10 0');expect(p.approximatedArcs).toBe(1);expect(p.contours[0].points.at(-2)).toMatchObject({x:100,y:40});expect(p.contours[0].points.at(-1)).toMatchObject({x:110,y:40});expect(p.contours[0].points.every(p=>[p.x,p.y,p.in.x,p.out.y].every(Number.isFinite))).toBe(true);
 });
 it.each(['L0 0','M0','M0 0L1','M0 0?','M0 0R1 2','M0 0A1 1 0 2 0 3 4','M0 0 L1e999 0','M0,,0','M0 0,','M0 0Z1'])('rejects malformed path %s',d=>expect(()=>parseSvgContours(d)).toThrow());
 it('enforces native anchor budgets and rejects compound single-path construction',()=>{
  expect(()=>parseSvgContours('M0 0L1 1L2 2',2)).toThrow(/budget/);expect(()=>parseSvgPath('M0 0L1 1M3 3L4 4')).toThrow(/one SVG contour/);expect(()=>VectorPath.fromSvgPath('M0 0L')).toThrow();expect(VectorPath.fromSvgPath('M0 0q10 10 20 0t20 0').points).toHaveLength(3);
 });
 it('keeps affine multiplication/pivots and viewBox alignment explicit',()=>{
  expect(svgTransform('translate(10 20) scale(2)').point({x:3,y:4})).toEqual({x:16,y:28});expect(svgTransform('rotate(90 10 20)').point({x:10,y:21})).toEqual({x:9,y:20});expect(svgViewBox(120,80,[10,20,20,20]).point({x:10,y:20})).toEqual({x:20,y:0});expect(svgViewBox(120,80,[0,0,20,20],'none').point({x:20,y:20})).toEqual({x:120,y:80});expect(()=>svgTransform('scale(0)')).toThrow();expect(()=>svgNumbers('1,,2')).toThrow();expect(()=>svgNumbers('1,')).toThrow();
 });
});
describe('SVG inert inspection and native conversion',()=>{
 it('admits native OO groups, compound holes and separate fill/stroke alpha',()=>{
  const result=inspectSvgSource(svg('<g fill="red" opacity=".5" transform="translate(4 8)"><path id="Hole" fill-rule="evenodd" d="M0 0H60V60H0Z M10 10H50V50H10Z"/><path fill="blue" fill-opacity=".4" stroke="lime" stroke-opacity=".7" stroke-linecap="round" stroke-linejoin="round" d="M0 0L40 40"/></g>'));
  expect(result.report.canImportEditable,result.report.unsupportedFeatures.join('\n')).toBe(true);const doc=Document.fromJSON(result.document),layers=allLayers(doc.toJSON().children),hole=layers.find(l=>l.name==='Hole');expect(hole?.mask).toBeUndefined();expect(hole?.kind==='vector'?hole.paths[0].fillRule:null).toBe('evenodd');expect(hole?.kind==='vector'?hole.paths[0].subpaths:[]).toHaveLength(1);expect(layers.find(l=>l.name==='Fill')?.opacity).toBe(.4);expect(layers.find(l=>l.name==='Stroke')?.opacity).toBe(.7);expect(validateSvgInspection(result).report.layers).toBe(layers.length);
 });
 it('expands local use references without preserving shared identity',()=>{
  const r=inspectSvgSource(svg('<defs><rect id="source" width="20" height="10"/></defs><use href="#source" x="4"/><use href="#source" x="40"/>'));expect(r.report.canImportEditable).toBe(true);expect(allLayers(r.document!.children).filter(l=>l.kind==='vector')).toHaveLength(2);expect(r.report.featuresDegraded.join(' ')).toMatch(/independently/);
 });
 it.each(['<path fill="url(#gradient)" d="M0 0H10V10Z"/>','<text x="0" y="20">Text</text>','<rect width="10" height="10" filter="url(#f)"/>','<style>rect{fill:blue}</style><rect width="10" height="10"/>','<use href="#missing"/>','<defs><g id="a"><use href="#a"/></g></defs><use href="#a"/>','<line x2="10" stroke="red" stroke-linejoin="arcs"/>'])('reports unsupported artwork without partial native publication: %s',body=>{
  const r=inspectSvgSource(svg(body));expect(r.report.canImportEditable).toBe(false);expect(r.report.unsupportedFeatures.length).toBeGreaterThan(0);expect(r.document).toBeUndefined();expect(r.assets).toEqual([]);expect(r.flat.type).toMatch(/svg/);expect(()=>validateSvgInspection(r)).not.toThrow();
 });
 it.each(['<script>alert(1)</script>','<g onclick="alert(1)"/>','<foreignObject/>','<animate attributeName="x"/>','<image href="https://example.invalid/image.png"/>','<style>@import "https://example.invalid/style.css";</style>','<style>rect{fill:u\\72l(https://example.invalid/image)}</style>','<g style="animation: turn 1s"/>','<g xml:base="https://example.invalid"/>'])('rejects executable/dynamic/external content: %s',body=>expect(()=>inspectSvgSource(svg(body))).toThrow());
 it('rejects malformed XML, entity declarations and processing instructions',()=>{
  for(const source of ['<svg><g></svg>','<!DOCTYPE svg [<!ENTITY x "x">]>'+svg('<text>&x;</text>'),'<?xml-stylesheet href="x"?>'+svg('')])expect(()=>inspectSvgSource(source)).toThrow();
 });
 it('normalizes viewport dimensions without a source-resolution cap',()=>{
  const r=inspectSvgSource(svg('<rect width="10000" height="5000"/>','viewBox="0 0 10000 5000" width="100%" height="100%"'));expect([r.report.width,r.report.height]).toEqual([10000,5000]);expect(r.report.canImportEditable).toBe(true);expect(r.report.featuresDegraded.join(' ')).toMatch(/Relative SVG/);
 });
 it('reports native complexity limits and validates private worker results/options',()=>{
  const r=inspectSvgSource(svg('<rect width="1" height="1"/>'.repeat(65)));expect(r.report.canImportEditable).toBe(false);expect(r.report.unsupportedFeatures.join(' ')).toMatch(/64-layer/);const valid=inspectSvgSource(svg('<rect width="1" height="1"/>'));expect(()=>validateSvgInspection({...valid,report:{...valid.report,width:10}})).toThrow();expect(()=>validateSvgInspection({...valid,assets:[{id:'x',name:'x',blob:new Blob()}]})).toThrow();expect(()=>svgImportOptionsSchema.parse({mode:'automatic'})).toThrow();
 });
 it('does not silently ignore CSS geometry, invalid inherited opacity or negative strokes',()=>{
  for(const body of ['<rect width="10" height="10" style="width:30px"/>','<rect width="10" height="10" style="transform:translate(20px)"/>','<path d="M0 0L20 20" stroke="red" stroke-width="-1"/>','<rect width="10" height="10" opacity=""/>'])expect(inspectSvgSource(svg(body)).report.canImportEditable).toBe(false);
  expect(inspectSvgSource(svg('<g color="red"><rect width="10" height="10" fill="currentcolor"/></g>')).document!.children[0]).toBeDefined();
  for(const transform of [',translate(1)','translate(1),','translate(1),,scale(2)'])expect(()=>svgTransform(transform)).toThrow();
 });
 it('rejects animated embedded PNG/WebP and keeps zero-sized images inert',()=>{
  const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,97,99,84,76,0,0,0,0]);
  const webp=new Uint8Array([82,73,70,70,12,0,0,0,87,69,66,80,65,78,73,77,0,0,0,0]);
  for(const [kind,bytes] of [['png',png],['webp',webp]] as const){const href=`data:image/${kind};base64,${btoa(String.fromCharCode(...bytes))}`;expect(()=>inspectSvgSource(svg(`<image width="10" height="10" href="${href}"/>`))).toThrow(/Animated/);}
  const result=inspectSvgSource(svg('<image width="0" height="0" href="data:image/png;base64,iVBORw=="/>'));expect(result.assets).toEqual([]);expect(()=>validateSvgInspection(result)).not.toThrow();
 });
 it('retains unpainted and zero-alpha path geometry and honors inline important priority',()=>{
  const r=inspectSvgSource(svg('<path id="Unpainted" fill="none" d="M0 0L10 10"/><path id="Transparent" fill="red" fill-opacity="0" d="M0 0H20V20H0Z"/><rect id="Priority" width="10" height="10" style="fill:red!important;fill:blue"/>'));
  expect(r.report.canImportEditable).toBe(true);const layers=allLayers(r.document!.children),unpainted=layers.find(l=>l.name==='Unpainted'),transparent=layers.find(l=>l.name==='Transparent'),priority=layers.find(l=>l.name==='Priority');expect(unpainted?.kind==='vector'&&unpainted.paths[0].points.length).toBe(2);expect(transparent?.opacity).toBe(0);expect(transparent?.kind==='vector'&&transparent.paths[0].fill).toBe('#ff0000');expect(priority?.kind==='vector'&&priority.paths[0].fill).toBe('#ff0000');
 });
});
