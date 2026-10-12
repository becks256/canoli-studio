import {expect,it} from 'vitest';
import {Document,LayerGroup,VectorLayer,VectorPath,LayerStyle} from '../src/dom';
import {execute} from '../src/core/commands';
import {findLayer,type VectorLayerData} from '../src/core/model';

const path=()=>new VectorPath({points:[{x:10,y:20},{x:30,y:40}],stroke:'#abcdef'});

it('keeps detached group ownership, editable styles and independent path snapshots while building vectors',()=>{
 const group=new LayerGroup(),layer=group.layers.add(new VectorLayer());
 const first=layer.paths.add(path()),before=first.toJSON();
 const retained=(layer._read() as VectorLayerData).paths[0];
 const second=layer.paths.add(path());
 expect((layer._read() as VectorLayerData).paths[0]).toBe(retained);
 expect(Object.isFrozen(retained)).toBe(true);
 const points=first.points;points[0].x=90;
 first.update({points});points[0].x=200;
 expect(first.points[0].x).toBe(90);expect(retained).toEqual(before);
 layer.name='Updated';layer.opacity=.7;
 layer.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#223344',opacity:.5}});
 layer.paths.add(path());second.remove();
 expect(layer.paths.length).toBe(2);
 const doc=new Document();doc.layers.add(group);
 expect((findLayer(doc.getSnapshot().document,layer.id) as VectorLayerData).paths[0].points[0].x).toBe(90);
 expect(layer.name).toBe('Updated');expect(layer.opacity).toBe(.7);
 expect(layer.styles.colorOverlay.color).toBe('#223344');
 const attached=doc.toJSON();doc.undo();expect(doc.layers.length).toBe(0);doc.redo();expect(doc.toJSON()).toEqual(attached);
});

it('rejects invalid or duplicate detached additions atomically without owning or freezing caller data',()=>{
 const layer=new VectorLayer(),first=layer.paths.add(path()),before=layer.toJSON();
 const input=first.toJSON();input.points[0].x=Infinity;
 expect(()=>layer._drawingCommand({type:'path.add',id:layer.id,path:input})).toThrow();
 expect(Object.isFrozen(input)).toBe(false);expect(Object.isFrozen(input.points)).toBe(false);
 expect(layer.toJSON()).toEqual(before);
 expect(()=>layer._drawingCommand({type:'path.add',id:layer.id,path:first.toJSON()})).toThrow(/Duplicate/);
 expect(layer.toJSON()).toEqual(before);
 const second=path(),data=second.toJSON();
 layer._drawingCommand({type:'path.add',id:layer.id,path:data});data.points[0].x=999;
 expect(layer.paths.at(1)!.points[0].x).toBe(10);
 expect(()=>layer.paths.add(first)).toThrow(/belongs/);
});

it('path add and remove retain immutable siblings with exact undo and rejected-command atomicity',()=>{
 const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new VectorLayer()),sibling=group.layers.add(new VectorLayer());
 const first=layer.paths.add(path()),before=doc.getSnapshot().document;
 const firstData=(findLayer(before,layer.id) as VectorLayerData).paths[0];
 const second=layer.paths.add(path()),after=doc.getSnapshot().document;
 expect(findLayer(after,sibling.id)).toBe(findLayer(before,sibling.id));
 expect((findLayer(after,layer.id) as VectorLayerData).paths[0]).toBe(firstData);
 expect((findLayer(before,layer.id) as VectorLayerData).paths).toHaveLength(1);
 const revision=doc.getSnapshot().revision;
 expect(()=>doc._dispatch({type:'path.add',id:layer.id,path:first.toJSON()})).toThrow(/Duplicate/);
 expect(doc.getSnapshot().document).toBe(after);expect(doc.getSnapshot().revision).toBe(revision);
 first.remove();expect(layer.paths.at(0)!.id).toBe(second.id);
 doc.undo();expect(doc.getSnapshot().document).toBe(after);
 doc.undo();expect(doc.getSnapshot().document).toBe(before);
 doc.redo();expect(doc.getSnapshot().document).toBe(after);
 group.locked=true;const locked=doc.getSnapshot().document;
 expect(()=>layer.paths.add(path())).toThrow(/Unlock/);
 expect(()=>second.remove()).toThrow(/Unlock/);
 expect(doc.getSnapshot().document).toBe(locked);
});

it('mutable command inputs remain isolated and the path count limit still rejects without attaching a handle',()=>{
 const doc=new Document(),layer=doc.layers.add(new VectorLayer()),mutable=doc.toJSON(),addition=path().toJSON();
 const next=execute(mutable,{type:'path.add',id:layer.id,path:addition});
 addition.points[0].x=999;(findLayer(mutable,layer.id) as VectorLayerData).name='Caller mutation';
 expect((findLayer(next,layer.id) as VectorLayerData).paths[0].points[0].x).toBe(10);
 expect(findLayer(next,layer.id)!.name).not.toBe('Caller mutation');
 const detached=new VectorLayer();for(let i=0;i<2048;i++)detached.paths.add(path());
 const excess=path();expect(()=>detached.paths.add(excess)).toThrow(/2048/);
 expect(excess._owner).toBeNull();expect(detached.paths.length).toBe(2048);
});
