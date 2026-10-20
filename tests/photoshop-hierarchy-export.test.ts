import {describe,it,expect} from 'vitest';
import {Document,LayerGroup,RasterLayer,AdjustmentLayer,LayerMask,LayerStyle,AffineTransform} from '../src/dom';
import {planPsdExport} from '../src/core/interchange/psd/export-plan';
import {referencedAssets} from '../src/core/model';
import {isPhotoshopGroupOnlyDocument} from '../src/core/photoshop-import';
import {encodePhotoshopStrip} from '../src/engine/photoshop-strip';
import {decodePackBits} from '../src/core/interchange/psd/packbits';

describe('Photoshop hierarchy export contracts',()=>{
 it('retains nested folders, locks and current transparency while folding group fill into supported opacity',()=>{
  const doc=new Document({width:80,height:60});doc.layers.add(new RasterLayer({name:'Backdrop',assetId:'base',width:80,height:60}));
  const outer=doc.layers.add(new LayerGroup({name:'Outer Ω',x:10,y:20,opacity:.75,fillOpacity:.5}));
  outer.layers.add(new RasterLayer({name:'First',assetId:'first',x:2,y:3,width:16,height:8}));
  const inner=outer.layers.add(new LayerGroup({name:'Pass',x:3,y:4,blendMode:'pass-through'}));inner.layers.add(new RasterLayer({name:'Second',assetId:'second',x:1,y:2,width:4,height:4}));outer.locked=true;
  const before=doc.toJSON(),plan=planPsdExport(before);
  expect(plan.records.map(record=>record.kind)).toEqual(['pixels','group-end','pixels','group-end','pixels','group','group']);
  expect(plan.layers.map(layer=>[layer.name,layer.left,layer.top])).toEqual([['Backdrop',0,0],['First',12,23],['Second',14,26]]);
  const headers=plan.records.filter(record=>record.kind==='group');expect(headers.map(record=>record.group.blendMode)).toEqual(['pass-through','normal']);
  expect(headers[1].group).toMatchObject({locked:true,fillOpacity:1,opacity:.375,left:10,top:20});expect(plan.foldedGroupFill).toEqual(['Outer Ω']);
  expect(plan.mergedThrough).toBe(-1);expect(plan.reuseComposite).toBe(false);expect(doc.toJSON()).toEqual(before);
 });
 it('merges unsupported adjustments inside ordinary isolation but carries pass-through dependencies to the sibling backdrop',()=>{
  for(const mode of ['normal','pass-through'] as const){
   const doc=new Document(),base=doc.layers.add(new RasterLayer({assetId:'outside',width:32,height:24})),group=doc.layers.add(new LayerGroup({blendMode:mode,x:9,y:7}));
   group.layers.add(new RasterLayer({assetId:'inside',width:16,height:12}));group.layers.add(new AdjustmentLayer({adjustment:{kind:'tone',exposure:1,contrast:0,saturation:0}}));
   const plan=planPsdExport(doc.toJSON());
   if(mode==='normal'){
    expect(plan.mergedThrough).toBe(-1);expect(plan.records.some(record=>record.kind==='group')).toBe(true);
    const prefix=plan.layers.find(layer=>layer.merged)!;expect([...referencedAssets(prefix.document)]).toEqual(['inside']);expect(prefix.document.children[0].id).toBe(group.id);
   }else{
    expect(plan.mergedThrough).toBe(1);expect(plan.records).toHaveLength(1);expect(plan.layers[0].document.children[0].id).toBe(base.id);expect([...referencedAssets(plan.layers[0].document)]).toEqual(['outside','inside']);
   }
  }
 });
 it('pins disabled zero-density bitmap masks and retains linked/unlinked coverage planes independently of artwork',()=>{
  const doc=new Document({width:80,height:60}),group=doc.layers.add(new LayerGroup({x:10,y:20}));group.transform=new AffineTransform(2,0,0,2,10,20);
  group.mask=new LayerMask({assetId:'group-mask',x:2,y:3,enabled:false,density:0,inverted:true});
  const child=group.layers.add(new RasterLayer({assetId:'image',width:12,height:8}));child.mask=new LayerMask({assetId:'child-mask',linked:false,x:6,y:7});
  const plan=planPsdExport(doc.toJSON());expect(plan.masks).toHaveLength(2);
  const outer=plan.masks.find(mask=>mask.id===group.id)!;expect(outer.world.point({x:0,y:0})).toEqual({x:14,y:26});expect(outer.enabled).toBe(false);expect([...referencedAssets(outer.document)]).toEqual(['group-mask']);
  const leaf=plan.masks.find(mask=>mask.id===child.id)!;expect(leaf.world.point({x:0,y:0})).toEqual({x:6,y:7});expect(plan.layers[0].document.children[0].mask).toBeUndefined();
 });
 it('retains a styled outer folder while reporting its rendered child rather than falsely preserving internal controls',()=>{
  const doc=new Document(),group=doc.layers.add(new LayerGroup({name:'Styled',fillOpacity:.4}));group.layers.add(new RasterLayer({assetId:'child',width:4,height:4}));group.styles=new LayerStyle({dropShadow:{enabled:true}});
  const before=doc.toJSON(),plan=planPsdExport(before);expect(plan.bakedGroups).toEqual(['Styled']);expect(plan.layers.map(layer=>layer.name)).toEqual(['Rendered Styled']);expect(plan.records.filter(record=>record.kind==='group')).toHaveLength(1);expect(doc.toJSON()).toEqual(before);
 });
 it('retains Normal pixel fill separately and bakes non-Normal fill with its mask without changing authored controls',()=>{
  for(const blendMode of ['normal','color-dodge'] as const){
   const doc=new Document(),layer=doc.layers.add(new RasterLayer({name:'Filled',assetId:'image',width:12,height:8,blendMode,opacity:.7,fillOpacity:.4}));layer.mask=new LayerMask({assetId:'coverage'});
   const before=doc.toJSON(),plan=planPsdExport(before),pixel=plan.layers[0];
   expect(pixel.opacity).toBe(.7);expect(pixel.blendMode).toBe(blendMode);
   expect(pixel.fillOpacity).toBe(blendMode==='normal'?.4:1);
   expect(pixel.document.children[0].fillOpacity).toBe(blendMode==='normal'?1:.4);
   expect(plan.masks).toHaveLength(blendMode==='normal'?1:0);
   expect(plan.bakedLayerFill).toEqual(blendMode==='normal'?[]:['Filled']);
   expect(doc.toJSON()).toEqual(before);
  }
 });
 it('distinguishes meaningful empty folders from an empty or non-folder source-free scene',()=>{
  const doc=new Document();expect(isPhotoshopGroupOnlyDocument(doc.toJSON())).toBe(false);const group=doc.layers.add(new LayerGroup({blendMode:'pass-through'}));group.layers.add(new LayerGroup());expect(isPhotoshopGroupOnlyDocument(doc.toJSON())).toBe(true);
  const plan=planPsdExport(doc.toJSON());expect(plan.layers).toHaveLength(0);expect(plan.records).toHaveLength(4);expect(plan.reuseComposite).toBe(false);
  group.layers.add(new RasterLayer({assetId:'image',width:1,height:1}));expect(isPhotoshopGroupOnlyDocument(doc.toJSON())).toBe(false);
 });
 it('encodes only actual coverage alpha for a user-mask channel without changing the source buffer',async()=>{
  const width=133,rows=3,pixels=new Uint8ClampedArray(width*rows*4);
  for(let i=0;i<width*rows;i++)pixels.set([i%256,(i*7)%256,255-i%256,[0,64,128,255][i%4]],i*4);
  const before=pixels.slice(),channels=encodePhotoshopStrip(pixels,width,rows,'mask');expect(channels).toHaveLength(1);
  const encoded=new Uint8Array(await channels[0].data.arrayBuffer());let offset=0;
  for(let row=0;row<rows;row++){
   const size=channels[0].lengths[row],decoded=decodePackBits(encoded.subarray(offset,offset+size),width);offset+=size;
   expect([...decoded]).toEqual(Array.from({length:width},(_,x)=>pixels[(row*width+x)*4+3]));
  }
  expect(offset).toBe(encoded.length);expect(pixels).toEqual(before);
 });
});
