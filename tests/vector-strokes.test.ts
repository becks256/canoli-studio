import {describe,it,expect} from 'vitest';
import {Document,VectorLayer,VectorPath,LayerGroup,AffineTransform,createRectanglePath} from '../src/dom';
import {pathBounds} from '../src/core/drawing';
import {validateDocument,SCHEMA_VERSION} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {inspectSvgSource} from '../src/core/svg-import';
import {exportPathSvg} from '../src/core/svg-path';
import {zeroLengthStrokePoint,strokeDashAtOrigin} from '../src/core/vector-stroke';

const line=()=>new VectorPath({points:[{x:10,y:10},{x:50,y:30}],stroke:'#ff0000',strokeWidth:8});
describe('editable native vector strokes',()=>{
 it('retains legacy round appearance without adding style fields to old paths',()=>{
  const doc=new Document(),layer=doc.layers.add(new VectorLayer()),path=layer.paths.add(line()),old={...doc.toJSON(),schemaVersion:21 as const},before=structuredClone(old),restored=Document.fromJSON(old),native=(restored.getLayer(layer.id) as VectorLayer).paths.get(path.id)!;
  expect(restored.toJSON().schemaVersion).toBe(SCHEMA_VERSION);expect(old).toEqual(before);expect(native.strokeCap).toBe('round');expect(native.strokeJoin).toBe('round');expect(native.strokeMiterLimit).toBe(4);expect(native.strokeDashArray).toEqual([]);expect(native.strokeDashOffset).toBe(0);expect(native.toJSON()).not.toHaveProperty('strokeCap');
 });
 it('shares strict validation, immutable array ownership and one transaction undo',()=>{
  const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new VectorLayer()),path=layer.paths.add(line()),before=doc.toJSON(),array=[8,4,2];
  doc.transaction('Style stroke',()=>path.update({strokeCap:'square',strokeJoin:'miter',strokeMiterLimit:12,strokeDashArray:array,strokeDashOffset:-3}));array[0]=999;const read=path.strokeDashArray;read[0]=998;expect(path.strokeDashArray).toEqual([8,4,2]);const after=doc.toJSON();expect(Document.fromJSON(after).toJSON()).toEqual(after);doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(after);
  for(const patch of [{strokeCap:'triangle'},{strokeJoin:'arcs'},{strokeMiterLimit:.5},{strokeMiterLimit:Infinity},{strokeDashArray:[-1,2]},{strokeDashArray:[NaN]},{strokeDashArray:Array(257).fill(1)},{strokeDashOffset:Infinity},{strokeDashOffset:'4'},{extra:true}]){expect(()=>path.update(patch as never)).toThrow();expect(doc.toJSON()).toEqual(after);expect(()=>parseCommands([{type:'path.update',id:layer.id,pathId:path.id,patch}])).toThrow();}
  group.locked=true;expect(()=>{path.strokeCap='butt';}).toThrow(/lock/i);
 });
 it('gates new stored styles to schema 22 and validates retained workspace history',()=>{
  const doc=new Document(),layer=doc.layers.add(new VectorLayer()),path=layer.paths.add(line());path.strokeCap='butt';const saved=doc.toJSON();expect(()=>validateDocument({...saved,schemaVersion:21})).toThrow(/version 22/);expect(()=>validateDocument({...doc.getSnapshot().document,schemaVersion:21})).toThrow(/version 22/);expect(()=>Document.fromJSON({...saved,schemaVersion:21})).toThrow(/version 22/);
  const state=doc.getSnapshot(),restored=Document._fromWorkspace(saved,{version:1,past:state.past,future:state.future});restored.undo();expect((restored.getLayer(layer.id) as VectorLayer).paths.get(path.id)!.strokeCap).toBe('round');restored.redo();expect(restored.toJSON()).toEqual(saved);
 });
 it('threads styles through all shape and SVG path factories without losing geometry',()=>{
  const options={strokeCap:'square' as const,strokeJoin:'bevel' as const,strokeMiterLimit:8,strokeDashArray:[10,4,2],strokeDashOffset:5};
  const paths=[VectorPath.rectangle({x:0,y:0,width:80,height:40},0,options),VectorPath.rectangle({x:0,y:0,width:80,height:40},8,options),VectorPath.ellipse({x:0,y:0,width:80,height:40},options),VectorPath.polygon({x:40,y:40},20,5,options),VectorPath.fromSvgPath('M0 0Q20 40 40 0',options)];
  for(const p of paths)expect(p.toJSON()).toMatchObject(options);const data=createRectanglePath({x:0,y:0,width:80,height:40},0,options);options.strokeDashArray[0]=100;expect(data.strokeDashArray).toEqual([10,4,2]);
 });
 it('includes square cap and high miter reach in native bounds under affine placement',()=>{
  const p=line();p.strokeCap='square';const square=pathBounds(p.toJSON());expect(square.x).toBeLessThanOrEqual(10-4*Math.SQRT2);p.strokeJoin='miter';p.strokeMiterLimit=10;const miter=pathBounds(p.toJSON());expect(miter.x).toBe(-30);expect(miter.height).toBe(100);expect(new AffineTransform(0,1,-1,0,100,0).bounds(miter)).toEqual({x:30,y:-30,width:100,height:120});
 });
 it('serializes safe SVG stroke attributes and rejects raw style injection',()=>{
  const path=line();path.update({strokeCap:'butt',strokeJoin:'miter',strokeMiterLimit:6,strokeDashArray:[5,2,1],strokeDashOffset:-4});const svg=exportPathSvg(path.toJSON());expect(svg).toContain('stroke-linecap="butt"');expect(svg).toContain('stroke-linejoin="miter"');expect(svg).toContain('stroke-miterlimit="6"');expect(svg).toContain('stroke-dasharray="5 2 1"');expect(svg).toContain('stroke-dashoffset="-4"');expect(()=>exportPathSvg({...path.toJSON(),strokeCap:'"><script' as never})).toThrow();
 });
 it('imports inherited SVG butt/miter/dashes in native units and reports unsupported relative/calibrated strokes',()=>{
  const r=inspectSvgSource('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><g fill="none" stroke="red" stroke-dasharray="5px, 2pt, 1" stroke-dashoffset="-3" stroke-miterlimit="8"><path d="M10 10L80 10L40 60"/><path stroke-linecap="square" stroke-linejoin="bevel" d="M10 60H80"/></g></svg>');expect(r.report.canImportEditable,r.report.unsupportedFeatures.join('\n')).toBe(true);const doc=Document.fromJSON(r.document),root=doc.layers.at(0) as LayerGroup,group=root.layers.at(0) as LayerGroup,path=(group.layers.at(0) as VectorLayer).paths.at(0)!;expect(path.strokeCap).toBe('butt');expect(path.strokeJoin).toBe('miter');expect(path.strokeMiterLimit).toBe(8);expect(path.strokeDashArray).toEqual([5,8/3,1]);expect(path.strokeDashOffset).toBe(-3);
  for(const attributes of ['stroke-dasharray="10% 5%"','pathLength="100"','stroke-linejoin="miter-clip"','stroke-dasharray="1,,2"'])expect(inspectSvgSource(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><path fill="none" stroke="red" d="M10 10H80" ${attributes}/></svg>`).report.canImportEditable).toBe(false);
 });
 it('distinguishes explicit zero-length caps, ignored handles, move-only contours and real closed cubic loops',()=>{
  expect(zeroLengthStrokePoint(VectorPath.fromSvgPath('M20 20').toJSON())).toBeNull();expect(zeroLengthStrokePoint(VectorPath.fromSvgPath('M20 20L20 20').toJSON())).toEqual({x:20,y:20});expect(zeroLengthStrokePoint(VectorPath.fromSvgPath('M20 20Z').toJSON())).toEqual({x:20,y:20});expect(zeroLengthStrokePoint(new VectorPath({points:[{x:20,y:20,out:{x:40,y:40},in:{x:0,y:0}}],closed:true}).toJSON())).toBeNull();
  expect(strokeDashAtOrigin([],0)).toBe(true);expect(strokeDashAtOrigin([0,0],99)).toBe(true);for(const offset of [0,8,40,-40])expect(strokeDashAtOrigin([16,24],offset)).toBe(true);for(const offset of [16,20,32,-8])expect(strokeDashAtOrigin([16,24],offset)).toBe(false);expect(strokeDashAtOrigin([0,16],0)).toBe(true);expect(strokeDashAtOrigin([0,16],8)).toBe(false);
  expect(strokeDashAtOrigin([8,4,2],12)).toBe(true);
 });
});
