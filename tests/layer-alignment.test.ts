import {expect,it} from 'vitest';
import {Document,LayerGroup,PaintLayer,PaintFill,AffineTransform} from '../src/dom';
import {layerBounds} from '../src/core/spatial';
import {parseCommands} from '../src/core/validation';
const add=(doc:Document,name:string,x:number,y:number,width=30,height=20)=>{const layer=doc.layers.add(new PaintLayer({name,x,y}));layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width,height},color:'#2468ac'}));return layer;};
for(const alignment of ['left','center','right','top','middle','bottom']as const)it('aligns a single layer to canvas '+alignment+' with one shared command and exact undo',()=>{
 const doc=new Document({width:300,height:200}),layer=add(doc,'Shape',17,23);doc.selectedLayer=layer;const before=doc.toJSON(),history=doc.getSnapshot().past.length,commands:string[]=[];doc.onCommand(command=>commands.push(command.type));
 doc.layerSelection.align(alignment,'canvas');const bounds=layerBounds(doc.toJSON(),layer.id)!;
 expect(bounds.x).toBe(alignment==='left'?0:alignment==='center'?135:alignment==='right'?270:17);expect(bounds.y).toBe(alignment==='top'?0:alignment==='middle'?90:alignment==='bottom'?180:23);expect(commands).toEqual(['layer.align']);expect(doc.getSnapshot().past.length).toBe(history+1);const after=doc.toJSON();doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(after);const revision=doc.getSnapshot().revision;doc.layerSelection.align(alignment,'canvas');expect(doc.getSnapshot().revision).toBe(revision);
});
it('preserves exact key geometry and source records under scaled/sheared/reflected parents',()=>{
 const doc=new Document({width:400,height:300}),key=add(doc,'Key',200,160,60,50),parent=doc.layers.add(new LayerGroup({name:'Parent'}));parent.transform=new AffineTransform(-1.5,.5,.25,2,120,80);const shape=new PaintLayer({name:'Nested',x:8,y:11});shape.strokes.add(new PaintFill({bounds:{x:-5,y:3,width:30,height:20},color:'#804020'}));parent.layers.add(shape);key.locked=true;doc.selectLayers([key,shape]);const keyBefore=key.toJSON(),linear=shape.transform.toJSON(),pixels=(shape.toJSON() as import('../src/core/model').PaintLayerData).strokes;
 doc.layerSelection.align('center',key);doc.layerSelection.align('middle',key);const a=layerBounds(doc.toJSON(),key.id)!,b=layerBounds(doc.toJSON(),shape.id)!;expect(b.x+b.width/2).toBeCloseTo(a.x+a.width/2,10);expect(b.y+b.height/2).toBeCloseTo(a.y+a.height/2,10);expect(key.toJSON()).toEqual(keyBefore);const now=shape.transform.toJSON();expect([now.a,now.b,now.c,now.d]).toEqual([linear.a,linear.b,linear.c,linear.d]);expect((shape.toJSON() as import('../src/core/model').PaintLayerData).strokes).toEqual(pixels);
});
it('moves selected ancestors once, rejects moving-key hierarchies and leaves failed alignment atomic',()=>{
 const doc=new Document({width:300,height:200}),group=doc.layers.add(new LayerGroup({x:20,y:30})),child=new PaintLayer({x:5,y:7});child.strokes.add(new PaintFill({bounds:{x:0,y:0,width:20,height:10},color:'#2468ac'}));group.layers.add(child);const other=add(doc,'Other',140,100);doc.selectLayers([group,child,other]);const childBefore=child.toJSON();doc.layerSelection.align('left','canvas');expect(child.toJSON()).toEqual(childBefore);expect(layerBounds(doc.toJSON(),group.id)!.x).toBe(0);expect(other.x).toBe(0);
 for(const [selection,key]of [[[group],child],[[child],group]]as const){doc.selectLayers([...selection]);const before=doc.toJSON(),revision=doc.getSnapshot().revision;expect(()=>doc.layerSelection.align('center',key)).toThrow(/independent/);expect(doc.toJSON()).toEqual(before);expect(doc.getSnapshot().revision).toBe(revision);}
 other.locked=true;doc.selectLayers([group,other]);const before=doc.toJSON();expect(()=>doc.layerSelection.align('right','canvas')).toThrow(/locked/);expect(doc.toJSON()).toEqual(before);
});
it('validates every alignment/reference and rejects missing geometry without partial publication',()=>{
 const doc=new Document(),shape=add(doc,'Shape',20,30);doc.selectedLayer=shape;const before=doc.toJSON();for(const target of [null,{type:'other'},{type:'canvas',id:shape.id},{type:'layer',id:'missing'}])expect(()=>doc.layerSelection.align('center',target as never)).toThrow();expect(()=>doc.layerSelection.align('diagonal' as never)).toThrow();expect(doc.toJSON()).toEqual(before);
 expect(parseCommands([{type:'layer.align',ids:[shape.id],alignment:'middle',target:{type:'canvas'}}])).toHaveLength(1);expect(()=>parseCommands([{type:'layer.align',ids:[shape.id],alignment:'middle',target:{type:'canvas',unknown:true}}])).toThrow();expect(()=>parseCommands([{type:'layer.align',ids:[],alignment:'middle'}])).toThrow();
 const empty=doc.layers.add(new LayerGroup());doc.selectLayers([shape,empty]);const snapshot=doc.toJSON();expect(()=>doc.layerSelection.align('top')).toThrow(/bounds/);expect(doc.toJSON()).toEqual(snapshot);
});
it('rejects foreign or detached public key handles even when serialized layer identities match',()=>{
 const doc=new Document(),shape=add(doc,'Shape',20,30),key=add(doc,'Key',80,50);doc.selectedLayer=shape;const copy=Document.fromJSON(doc.toJSON()),before=doc.toJSON();for(const reference of [copy.getLayer(key.id)!,new PaintLayer({name:'Detached'})])expect(()=>doc.layerSelection.align('center',reference)).toThrow(/attached.*this document/);expect(doc.toJSON()).toEqual(before);
});
