import {expect,it} from 'vitest';
import {Document,LayerGroup,RasterLayer,SmartObjectLayer,PaintLayer,PaintFill,LayerMask,AffineTransform,FrequencyBandFilter} from '../src/dom';
import {ComponentRegistry} from '../src/core/smart/manager';
import {allLayers,type DocumentData} from '../src/core/model';
import {frequencyIdentitySource} from '../src/engine/frequency-identity';
import type {AssetStore} from '../src/core/assets';
function scene(){
 const document=new Document(),source=document.layers.add(new RasterLayer({assetId:'original',width:64,height:32})),snapshot=document.layers.add(new RasterLayer({assetId:'captured',width:64,height:32}));document.createFrequencySeparation(source,snapshot,{sigma:2});
 const instance=document.getLayer(allLayers(document.toJSON().children).find(node=>node.kind==='smart-object')!.id) as SmartObjectLayer;
 return instance.editContents();
}
const assets={get:()=>({width:64,height:32,bitmap:{width:64,height:32}})} as unknown as AssetStore;
const inspect=(document:Document)=>{const data=document.toJSON();return frequencyIdentitySource(data,new ComponentRegistry(data.components),assets);};
it('recognizes the exact source reconstruction and ignores only regions outside conservatively bounded retouch ink',()=>{
 const document=scene(),plain=inspect(document);expect(plain?.raster.assetId).toBe('captured');expect(plain?.unchanged({x:0,y:0,width:64,height:32})).toBe(true);
 const paint=document.getLayer(allLayers(document.toJSON().children).find(node=>node.name==='Color retouch')!.id) as PaintLayer;paint.strokes.add(new PaintFill({bounds:{x:12,y:8,width:8,height:8},color:'#ff0000'}));
 const edited=inspect(document);expect(edited?.unchanged({x:0,y:0,width:8,height:4})).toBe(true);expect(edited?.unchanged({x:10,y:6,width:14,height:14})).toBe(false);expect(edited?.unchanged({x:20,y:8,width:1,height:1})).toBe(false);
});
it('refuses altered frequency structure, masks, sampling geometry, disabled filters and mismatched dimensions',()=>{
 const source=scene().toJSON();
 const mutations:((value:DocumentData)=>void)[]=[
  value=>{value.children.push(new PaintLayer().toJSON());},
  value=>{value.children[0].opacity=.5;},
  value=>{value.children[0].mask=value.children[0].mask!;value.children[0].mask!.density=.5;},
  value=>{const layer=allLayers(value.children).find(node=>node.name==='Color and tone source')!;layer.transform=new AffineTransform(2,0,0,1).toJSON();},
  value=>{const layer=allLayers(value.children).find(node=>node.name==='Detail source')! as import('../src/core/smart/types').SmartObjectInstanceData;layer.smartFilters![0].enabled=false;},
  value=>{const layer=allLayers(value.children).find(node=>node.name==='Detail source')! as import('../src/core/smart/types').SmartObjectInstanceData;layer.filterMask=new LayerMask({base:1}).toJSON();},
  value=>{const layer=allLayers(value.children).find(node=>node.name==='Color retouch')!;layer.mask=new LayerMask({base:1}).toJSON();},
 ];
 for(const mutate of mutations){const data=structuredClone(source);mutate(data);expect(frequencyIdentitySource(data,new ComponentRegistry(data.components),assets)).toBeNull();}
 const data=scene().toJSON();expect(frequencyIdentitySource(data,new ComponentRegistry(data.components),{get:()=>({width:65,height:32,bitmap:{width:65,height:32}})} as unknown as AssetStore)).toBeNull();
});
it('retains real sampling-budget errors and rejects unequal legacy radii unless an explicit group controls them',()=>{
 const document=scene(),group=document.layers.at(0) as LayerGroup;group.frequencyRadius=1200;expect(inspect(document)).toBeNull();group.frequencyRadius=null;
 const detail=document.getLayer(allLayers(document.toJSON().children).find(node=>node.name==='Detail source')!.id) as SmartObjectLayer;
 const original=detail.smartFilters[0];if(original.kind!=='frequency-band')throw new Error();const {kind:_,...options}=original;detail.setFilters([new FrequencyBandFilter({...options,sigma:3})]);
 expect(inspect(document)).toBeNull();group.frequencyRadius=2;expect(inspect(document)).not.toBeNull();
});
