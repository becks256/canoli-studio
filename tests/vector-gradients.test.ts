import {svgDocumentChunks} from '../src/core/svg-export';
import {describe,it,expect} from 'vitest';
import {Document,VectorLayer,VectorPath,LayerGroup,createRectanglePath} from '../src/dom';
import type {VectorGradientData} from '../src/dom';
import {SCHEMA_VERSION,validateDocument} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {inspectSvgSource} from '../src/core/svg-import';
import {bezierGeometryBounds} from '../src/core/bezier-bounds';
import {exportPathSvg} from '../src/core/svg-path';

const linear=():VectorGradientData=>({kind:'linear',start:{x:0,y:0},end:{x:100,y:0},stops:[{position:0,color:'#ff0000'},{position:1,color:'#0000ff',opacity:.5}]});
const path=()=>VectorPath.rectangle({x:0,y:0,width:100,height:80},0,{fill:'#ffffff',fillGradient:linear(),stroke:null});
const vectors=(document:ReturnType<typeof inspectSvgSource>['document'])=>{const result:VectorLayer[]=[];const d=Document.fromJSON(document!);const visit=(group:Document|LayerGroup)=>{for(const layer of group.layers){if(layer instanceof VectorLayer)result.push(layer);if(layer instanceof LayerGroup)visit(layer);}};visit(d);return result;};
describe('editable vector gradient fills',()=>{
 it('owns nested inputs and outputs through constructor/setter, transactions, locks and undo',()=>{
  const gradient=linear(),p=new VectorPath({points:[{x:0,y:0}],fillGradient:gradient});gradient.stops[0].color='#ffffff';expect(p.fillGradient!.stops[0].color).toBe('#ff0000');const read=p.fillGradient!;read.start.x=800;expect(p.fillGradient!.start.x).toBe(0);
  const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new VectorLayer()),owned=layer.paths.add(path()),before=doc.toJSON();doc.transaction('Recolor',()=>{owned.fillGradient={...linear(),transform:{a:1,b:.5,c:0,d:1,e:10,f:0}};owned.fill='#00ff00';});const after=doc.toJSON();doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(after);owned.fillGradient=null;expect(owned.fill).toBe('#00ff00');group.locked=true;expect(()=>{owned.fillGradient=linear();}).toThrow(/lock/i);
 });
 it('rejects malformed paint atomically across OO and shared command validation',()=>{
  const doc=new Document(),layer=doc.layers.add(new VectorLayer()),p=layer.paths.add(path()),before=doc.toJSON();
  for(const fillGradient of [{...linear(),kind:'mesh'},{...linear(),start:{x:0,y:0},end:{x:0,y:0}},{...linear(),stops:[]},{...linear(),stops:[{position:1,color:'#ff0000'},{position:0,color:'#0000ff'}]},{...linear(),stops:Array(33).fill({position:0,color:'#ff0000'})},{...linear(),stops:[{position:0,color:'url(#bad)'},{position:1,color:'#ff0000'}]},{...linear(),stops:[{position:0,color:'#ff0000',opacity:2},{position:1,color:'#ff0000'}]},{...linear(),transform:{a:0,b:0,c:0,d:0,e:0,f:0}},{kind:'radial',start:{x:0,y:0,radius:1},end:{x:0,y:0,radius:1},stops:linear().stops}]){
   expect(()=>{p.fillGradient=fillGradient as never;}).toThrow();expect(doc.toJSON()).toEqual(before);expect(()=>parseCommands([{type:'path.update',id:layer.id,pathId:p.id,patch:{fillGradient}}])).toThrow();
  }
 });
 it('migrates old roots and history without injecting paint, and rejects future paint under old schema labels',()=>{
  const doc=new Document(),layer=doc.layers.add(new VectorLayer()),p=layer.paths.add(VectorPath.rectangle({x:0,y:0,width:10,height:10})),old={...doc.toJSON(),schemaVersion:22 as const};expect(Document.fromJSON(old).toJSON().schemaVersion).toBe(SCHEMA_VERSION);expect(p.toJSON()).not.toHaveProperty('fillGradient');p.fillGradient=linear();const saved=doc.toJSON();expect(()=>validateDocument({...saved,schemaVersion:22})).toThrow(/version 23/);expect(()=>validateDocument({...doc.getSnapshot().document,schemaVersion:22})).toThrow(/version 23/);
  const state=doc.getSnapshot(),restored=Document._fromWorkspace(saved,{version:1,past:state.past,future:state.future});restored.undo();expect((restored.getLayer(layer.id) as VectorLayer).paths.at(0)!.fillGradient).toBeNull();restored.redo();expect(restored.toJSON()).toEqual(saved);
 });
 it('threads paint through every factory with hard stops and independent nested ownership',()=>{
  const g=linear();g.stops.splice(1,0,{position:.5,color:'#ff0000'},{position:.5,color:'#0000ff'});const opts={fillGradient:g};
  for(const p of [VectorPath.rectangle({x:0,y:0,width:100,height:80},0,opts),VectorPath.rectangle({x:0,y:0,width:100,height:80},4,opts),VectorPath.ellipse({x:0,y:0,width:100,height:80},opts),VectorPath.polygon({x:20,y:20},20,5,opts),VectorPath.fromSvgPath('M0 0H10V10Z',opts)])expect(p.fillGradient).toEqual(g);
  const data=createRectanglePath({x:0,y:0,width:100,height:80},0,opts);g.start.x=90;expect(data.fillGradient!.start.x).toBe(0);
 });
 it('uses actual cubic extrema rather than the control hull for SVG object bounding boxes',()=>{
  const cubic=VectorPath.fromSvgPath('M0 0C100 0 -100 100 0 100Z'),cubicBounds=bezierGeometryBounds([cubic.toJSON()]);expect(cubicBounds.x).toBeCloseTo(-50/Math.sqrt(3),12);expect(cubicBounds.width).toBeCloseTo(100/Math.sqrt(3),12);expect(cubicBounds.y).toBe(0);expect(cubicBounds.height).toBe(100);
  const p=VectorPath.fromSvgPath('M0 0Q50 100 100 0Z');const bounds=bezierGeometryBounds([p.toJSON()]);expect(bounds).toMatchObject({x:0,y:0,width:100});expect(bounds.height).toBeCloseTo(50,12);
  const result=inspectSvgSource('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path d="M0 0Q50 100 100 0Z" fill="url(#g)"/></svg>');expect(result.report.canImportEditable,result.report.unsupportedFeatures.join('\n')).toBe(true);const transform=vectors(result.document)[0].paths.at(0)!.fillGradient!.transform!;expect(transform).toMatchObject({a:100,b:0,c:0,e:0,f:0});expect(transform.d).toBeCloseTo(50,12);
 });
 it('exports literal validated paints with document-scoped gradient IDs even when authored path IDs repeat',()=>{
  const doc=new Document(),a=doc.layers.add(new VectorLayer()),b=doc.layers.add(new VectorLayer()),p=path();a.paths.add(p);b.paths.add(new VectorPath({...p.toJSON(),subpaths:undefined,fillGradient:{kind:'radial',start:{x:20,y:20,radius:0},end:{x:20,y:20,radius:20},stops:linear().stops}}));
  const raw=doc.toJSON();if(raw.children[1].kind!=='vector')throw new Error('Expected vector');raw.children[1].paths[0].id=p.id;validateDocument(raw);const all=[...svgDocumentChunks(raw)].join('');expect(all.match(/id="canoli-vector-gradient-/g)).toHaveLength(2);expect(all).toContain('fill="url(#canoli-vector-gradient-2)"');
  const svg=a.toSvg(100,80);expect(svg).toContain('gradientUnits="userSpaceOnUse"');expect(svg).toContain('stop-opacity="0.5"');expect(svg).toContain('fill="url(#canoli-vector-gradient-1)"');expect(exportPathSvg(p.toJSON())).toContain('<linearGradient');expect(()=>exportPathSvg({...p.toJSON(),fillGradient:{...linear(),stops:[{position:0,color:'"><script>'},{position:1,color:'#ff0000'}]}})).toThrow();
 });
 it('imports referenced radial geometry, transform order, stop alpha and definition-tree currentColor',()=>{
  const result=inspectSvgSource('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><defs color="blue"><radialGradient id="base" gradientUnits="userSpaceOnUse" cx="50" cy="40" r="30"><stop stop-color="currentColor" stop-opacity="50%"/><stop offset="100%" stop-color="#ff000080"/></radialGradient><radialGradient id="g" href="#base" gradientTransform="translate(5 2)"/></defs><rect width="100" height="80" fill="url(#g)" color="red"/></svg>');expect(result.report.canImportEditable,result.report.unsupportedFeatures.join('\n')).toBe(true);expect(vectors(result.document)[0].paths.at(0)!.fillGradient).toMatchObject({kind:'radial',start:{x:50,y:40,radius:0},end:{x:50,y:40,radius:30},transform:{a:1,b:0,c:0,d:1,e:5,f:2},stops:[{position:0,color:'#0000ff',opacity:.5},{position:1,color:'#ff0000',opacity:128/255}]});
 });
 it('discloses unsupported paint graphs and preserves empty or single-stop SVG paint semantics',()=>{
  const svg=(gradient:string,fill='url(#g)')=>`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><defs>${gradient}</defs><rect width="100" height="80" fill="${fill}"/></svg>`;
  for(const attributes of ['spreadMethod="repeat"','color-interpolation="linearRGB"','href="#g"','gradientTransform="scale(0)"','x1="0" x2="0" y1="0" y2="0"'])expect(inspectSvgSource(svg(`<linearGradient id="g" ${attributes}><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>`)).report.canImportEditable).toBe(false);
  expect(inspectSvgSource(svg('<linearGradient id="g"/>')).report.canImportEditable).toBe(true);const single=inspectSvgSource(svg('<linearGradient id="g"><stop stop-color="red"/></linearGradient>'));expect(single.report.canImportEditable).toBe(true);expect(vectors(single.document)[0].paths.at(0)!.fillGradient!.stops).toHaveLength(2);
 });
 it('separates non-inherited stop properties and referencing interpolation from template geometry',()=>{
  const source=(stops:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><defs><linearGradient id="g" stop-color="red" stop-opacity=".2">${stops}<stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="100" height="80" fill="url(#g)"/></svg>`;
  const first=inspectSvgSource(source('<stop/>'));expect(first.report.canImportEditable).toBe(true);expect(vectors(first.document)[0].paths.at(0)!.fillGradient!.stops[0]).toEqual({position:0,color:'#000000',opacity:1});
  const keywords=inspectSvgSource(source('<stop stop-color=" InHeRiT " stop-opacity=" INITIAL "/>'));expect(keywords.report.canImportEditable).toBe(true);expect(vectors(keywords.document)[0].paths.at(0)!.fillGradient!.stops[0]).toEqual({position:0,color:'#ff0000',opacity:1});
  const explicit=inspectSvgSource(source('<stop stop-color="inherit" stop-opacity="inherit"/>'));expect(explicit.report.canImportEditable).toBe(true);expect(vectors(explicit.document)[0].paths.at(0)!.fillGradient!.stops[0]).toEqual({position:0,color:'#ff0000',opacity:.2});
  const template=inspectSvgSource('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><defs><linearGradient id="base" color-interpolation="linearRGB"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><linearGradient id="g" href="#base"/></defs><rect width="100" height="80" fill="url(#g)"/></svg>');expect(template.report.canImportEditable).toBe(true);
 });
});
