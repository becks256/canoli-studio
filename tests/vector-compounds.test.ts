import { describe, it, expect } from 'vitest';
import { Document, VectorPath, VectorContour, VectorLayer, LayerGroup, PaintLayer, LayerMask, AffineTransform } from '../src/dom';
import { pathSchema, pathBounds } from '../src/core/drawing';
import { validateDocument, SCHEMA_VERSION } from '../src/core/model';
import { parseCommands } from '../src/core/validation';
import { inspectSvgSource } from '../src/core/svg-import';
import { allLayers } from '../src/core/model';

const rect = (x=20,y=20,width=60,height=60) => VectorPath.rectangle({x,y,width,height},0,{stroke:null,fill:'#00ff00'});
const contour = () => new VectorContour({points:rect().points});
const compound = () => new VectorPath({points:rect(0,0,100,100).points,closed:true,fill:'#ff0000',stroke:null,fillRule:'evenodd',subpaths:[contour()]});

describe('editable compound paths', () => {
 it('owns constructor inputs and exposes independent geometry handles sharing the parent style', () => {
  const source=rect().points,hole=new VectorContour({points:source});source[0].in.x=999;
  const p=new VectorPath({points:rect(0,0,100,100).points,closed:true,subpaths:[hole]});
  expect(p.subpaths.at(0)).toBe(hole);expect(hole.points[0].in.x).toBe(20);
  const read=hole.points;read[0].x=999;expect(hole.points[0].x).toBe(20);
  expect(()=>p.subpaths.add(hole)).toThrow(/belongs/);expect(()=>new VectorPath({points:rect().points,closed:true,subpaths:[hole]})).toThrow(/belongs/);
  expect(()=>new VectorPath({points:rect().points,closed:true,subpaths:[contour(),hole]})).toThrow(/belongs/);
  const duplicate=contour();expect(()=>new VectorPath({points:rect().points,closed:true,subpaths:[duplicate,duplicate]})).toThrow(/Duplicate/);expect(duplicate._owner).toBeNull();
 });
 it('edits all boundaries in one transaction, retains identity across undo and rejects locks/removal', () => {
  const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new VectorLayer()),p=layer.paths.add(compound()),hole=p.subpaths.at(0)!,before=doc.toJSON();
  doc.transaction('Edit boundaries',()=>{p.setPoint(0,{x:5});hole.setPoint(0,{x:25});hole.splitSegment(0,.3);p.fillRule='nonzero';});
  const after=doc.toJSON();expect(hole.points).toHaveLength(5);doc.undo();expect(doc.toJSON()).toEqual(before);expect(p.subpaths.at(0)).toBe(hole);doc.redo();expect(doc.toJSON()).toEqual(after);
  const copied=hole.toJSON();hole.remove();expect(()=>hole.points).toThrow(/revision/);doc.undo();expect(hole.toJSON()).toEqual(copied);
  group.locked=true;const locked=doc.toJSON();expect(()=>hole.setPoint(0,{x:50})).toThrow(/lock/i);expect(()=>hole.remove()).toThrow(/lock/i);expect(doc.toJSON()).toEqual(locked);
 });
 it('rejects invalid full geometry and oversized or duplicate contours atomically', () => {
  const doc=new Document(),layer=doc.layers.add(new VectorLayer()),p=layer.paths.add(compound()),before=doc.toJSON(),c=p.subpaths.at(0)!.toJSON();
  const patches=[{closed:false},{fillRule:'positive'},{subpaths:[{...c,closed:false}]},{subpaths:[c,c]},{subpaths:[{...c,id:p.id}]},{subpaths:Array.from({length:128},(_,i)=>({...c,id:`c${i}`}))},{subpaths:[{...c,points:Array(20000).fill(c.points[0])}]},{subpaths:[{...c,points:[{...c.points[0],x:Infinity}]}]}];
  for(const patch of patches){expect(()=>p.update(patch as never)).toThrow();expect(doc.toJSON()).toEqual(before);}
  expect(()=>parseCommands([{type:'path.update',id:layer.id,pathId:p.id,patch:{fillRule:'positive'}}])).toThrow();
  const empty=new VectorContour({points:[{x:0,y:0}]});expect(()=>empty.removePoint(0)).toThrow();expect(empty.points).toHaveLength(1);
  const limit={...p.toJSON(),points:Array(19996).fill(c.points[0])};expect(()=>pathSchema.parse(limit)).not.toThrow();
 });
 it('migrates legacy roots/history without adding fields and rejects future fields under old cached labels', () => {
  const doc=new Document(),layer=doc.layers.add(new VectorLayer()),p=layer.paths.add(rect());
  for(let schemaVersion=1;schemaVersion<24;schemaVersion++)expect(Document.fromJSON({...doc.toJSON(),schemaVersion} as never).toJSON().schemaVersion).toBe(SCHEMA_VERSION);
  expect(p.toJSON()).not.toHaveProperty('subpaths');expect(p.toJSON()).not.toHaveProperty('fillRule');
  p.subpaths.add(contour());const snapshot=doc.getSnapshot();validateDocument(snapshot.document);
  for(const source of [doc.toJSON(),snapshot.document])expect(()=>validateDocument({...source,schemaVersion:23})).toThrow(/version 24/);
  const restored=Document._fromWorkspace(doc.toJSON(),{version:1,past:snapshot.past,future:snapshot.future});restored.undo();expect((restored.getLayer(layer.id) as VectorLayer).paths.at(0)!.subpaths.length).toBe(0);restored.redo();expect(restored.toJSON()).toEqual(doc.toJSON());
 });
 it('includes disconnected islands and control handles in culling bounds, and duplicates independent IDs', () => {
  const doc=new Document(),layer=doc.layers.add(new VectorLayer()),p=layer.paths.add(compound());
  const island=new VectorContour({points:rect(1000,900,20,20).points});p.subpaths.add(island);island.setPoint(0,{out:{x:1200,y:900}});
  const bounds=pathBounds(p.toJSON());expect(bounds.x+bounds.width).toBeGreaterThanOrEqual(1200);expect(bounds.y+bounds.height).toBeGreaterThanOrEqual(920);
  const copy=layer.duplicate() as VectorLayer,other=copy.paths.at(0)!;expect(other.id).not.toBe(p.id);expect(other.subpaths.at(0)!.id).not.toBe(p.subpaths.at(0)!.id);expect(other.subpaths.at(1)!.points).toEqual(island.points);
  other.subpaths.at(0)!.setPoint(0,{x:99});expect(p.subpaths.at(0)!.points[0].x).toBe(20);
 });
 it('exports curves and multiple native contours, and imports editable geometry without a cover mask', () => {
  const layer=new VectorLayer(),p=layer.paths.add(compound());p.subpaths.at(0)!.setPoint(0,{out:{x:35,y:5}});
  const svg=layer.toSvg(100,100);expect(svg).toContain('fill-rule="evenodd"');expect(svg).toContain('C 35 5');expect(svg).not.toContain('<mask');expect((p.toSvgPath().match(/M /g)??[]).length).toBe(2);
  const imported=inspectSvgSource(svg);expect(imported.report.canImportEditable,JSON.stringify(imported.report)).toBe(true);const vector=allLayers(imported.document!.children).find(l=>l.kind==='vector');
  expect(vector?.mask).toBeUndefined();if(vector?.kind!=='vector')throw new Error('Missing native vector');const path=vector.paths[0];expect(path.points).toEqual(p.points);expect(path.subpaths![0].points).toEqual(p.subpaths.at(0)!.points);expect(path.fillRule).toBe('evenodd');
  expect(()=>VectorPath.fromSvgPath(p.toSvgPath())).toThrow();
 });
 it('captures every contour in transformed masks and preserves explicit fill rules', () => {
  const doc=new Document(),group=doc.layers.add(new LayerGroup()),source=group.layers.add(new VectorLayer()),target=doc.layers.add(new PaintLayer());group.transform=new AffineTransform(1,.2,.3,1,40,20);source.paths.add(compound());
  target.maskFromPaths(source);expect(target.mask!.paths).toHaveLength(2);expect(target.mask!.fillRule).toBe('evenodd');expect(target.mask!.paths[1].points[0]).toMatchObject({x:66,y:44});
  source.paths.at(0)!.fillRule='nonzero';target.maskFromPaths(source);expect(target.mask!.fillRule).toBe('nonzero');
  const direct=new LayerMask({paths:[source.paths.at(0)!],fillRule:'nonzero'});expect(direct.paths).toHaveLength(2);
  source.paths.add(new VectorPath({points:rect().points,closed:true,fillRule:'evenodd'}));const before=target.mask!.toJSON();expect(()=>target.maskFromPaths(source)).toThrow(/same fill rule/);expect(target.mask!.toJSON()).toEqual(before);
 });
 it('keeps opaque compound SVG paints on one editable boundary graph while preserving translucent paint isolation', () => {
  const content=(alpha:number)=>`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M0 0H100V100H0Z M20 20H80V80H20Z" fill-rule="evenodd" fill="red" stroke="blue" stroke-width="4" fill-opacity="${alpha}" stroke-opacity="${alpha}"/></svg>`;
  const opaque=inspectSvgSource(content(1)),vectors=allLayers(opaque.document!.children).filter(l=>l.kind==='vector');expect(vectors).toHaveLength(1);expect(vectors[0].paths).toHaveLength(1);expect(vectors[0].paths[0]).toMatchObject({fill:'#ff0000',stroke:'#0000ff',fillRule:'evenodd'});expect(vectors[0].paths[0].subpaths).toHaveLength(1);
  const translucent=inspectSvgSource(content(.5)),paintLayers=allLayers(translucent.document!.children).filter(l=>l.kind==='vector');expect(paintLayers).toHaveLength(2);expect(paintLayers.map(l=>l.opacity)).toEqual([.5,.5]);
 });
});
