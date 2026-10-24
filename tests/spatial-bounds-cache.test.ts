import {expect,it} from 'vitest';
import {Document,LayerGroup,RasterLayer,VectorLayer,VectorPath,AffineTransform} from '../src/dom';
import {layerBounds} from '../src/core/spatial';
import {freeze} from '../src/core/immutable';

function scene(){
 const document=new Document(),parent=document.layers.add(new LayerGroup({x:10,y:20}));parent.transform=AffineTransform.translation(10,20).multiply(AffineTransform.scale(2));
 const child=parent.layers.add(new RasterLayer({assetId:'source',width:30,height:20,x:5,y:7}));return{document,parent,child};
}
it('returns independently owned bounds without exposing or poisoning retained geometry',()=>{
 const{document,child}=scene(),root=document._read(),first=layerBounds(root,child.id)!,expected={x:20,y:34,width:60,height:40};expect(first).toEqual(expected);first.x=999;first.width=1;
 const second=layerBounds(root,child.id)!;expect(second).toEqual(expected);expect(second).not.toBe(first);expect(Object.isFrozen(second)).toBe(false);second.y=999;expect(layerBounds(root,child.id)).toEqual(expected);
});
it('does not trust mutable DTOs or shallow caller freezing',()=>{
 const{document,child}=scene(),root=document.toJSON(),parent=root.children[0];if(parent.kind!=='group')throw Error('Expected group');
 expect(layerBounds(root,child.id)!.x).toBe(20);parent.x=100;expect(layerBounds(root,child.id)!.x).toBe(110);Object.freeze(root);parent.x=200;expect(layerBounds(root,child.id)!.x).toBe(210);
});
it('keeps shared children and repeated document/layer IDs scoped to their complete ancestry',()=>{
 const{document,child}=scene(),first=document._read(),parent=first.children[0];if(parent.kind!=='group')throw Error('Expected group');
 const second=freeze({...first,children:[{...parent,x:100}]});expect((second.children[0]as typeof parent).children[0]).toBe(parent.children[0]);expect(second.id).toBe(first.id);
 expect(layerBounds(first,child.id)!.x).toBe(20);expect(layerBounds(second,child.id)!.x).toBe(110);expect(layerBounds(first,child.id)!.x).toBe(20);
});
it('follows parent edits, undo and redo without mixing retained result states',()=>{
 const{document,parent,child}=scene();expect(layerBounds(document._read(),child.id)!.x).toBe(20);parent.x=100;expect(layerBounds(document._read(),child.id)!.x).toBe(110);document.undo();expect(layerBounds(document._read(),child.id)!.x).toBe(20);document.redo();expect(layerBounds(document._read(),child.id)!.x).toBe(110);
});
it('follows actual path edits and newly populated groups while preserving missing-result behavior',()=>{
 const document=new Document(),group=document.layers.add(new LayerGroup()),vector=document.layers.add(new VectorLayer()),path=vector.paths.add(new VectorPath({points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}],fill:'#2468ac',stroke:null,strokeWidth:0}));
 expect(layerBounds(document._read(),group.id)).toBeUndefined();expect(layerBounds(document._read(),'missing')).toBeUndefined();expect(layerBounds(document._read(),vector.id)!.width).toBe(10);path.setPoint(1,{x:30,y:0});expect(layerBounds(document._read(),vector.id)!.width).toBe(30);
 group.layers.add(new RasterLayer({assetId:'other',width:5,height:7,x:4,y:9}));expect(layerBounds(document._read(),group.id)).toEqual({x:4,y:9,width:5,height:7});
});
