import {expect,it} from 'vitest';
import {Document,LayerGroup,SmartObjectLayer,RasterLayer,FrequencyBandFilter,NativeCompositionFilter} from '../src/dom';
import {ComponentRegistry} from '../src/core/smart/manager';
import {resolveSmartDocument} from '../src/core/smart/resolve';
import {allLayers,validateDocument} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
function fixture(){
 const document=new Document(),master=new Document({width:32,height:16});master.layers.add(new RasterLayer({assetId:'photo',width:32,height:16}));const componentId=document.defineComponent(master),group=document.layers.add(new LayerGroup({frequencyRadius:2}));
 const bands=(['low','high','correction'] as const).map(band=>{const layer=group.layers.add(new SmartObjectLayer({componentId,width:32,height:16}));layer.setFilters([new FrequencyBandFilter({band,sigma:1})]);return layer;});bands[2].locked=true;
 return{document,group,bands};
}
it('one group edit derives all band radii without mutating protected children or their fallback settings',()=>{
 const {document,group,bands}=fixture(),children=(group.toJSON() as import('../src/core/model').GroupLayerData).children,before=document.toJSON(),history=document.getSnapshot().past.length;
 group.frequencyRadius=3;expect((group.toJSON() as import('../src/core/model').GroupLayerData).children).toEqual(children);expect(document.getSnapshot().past.length).toBe(history+1);expect(bands[2].locked).toBe(true);expect(bands[2].frequencyGroup!.id).toBe(group.id);
 const current=document.toJSON(),resolved=resolveSmartDocument(current,new ComponentRegistry(current.components),{preserveFiltered:true});
 expect(allLayers(resolved.children).filter(layer=>layer.kind==='smart-object').map(layer=>layer.kind==='smart-object'&&layer.smartFilters?.[0])).toEqual(bands.map(layer=>({...layer.smartFilters[0],sigma:3})));
 expect(bands.map(layer=>layer.smartFilters[0])).toEqual(children.map(layer=>layer.kind==='smart-object'&&layer.smartFilters![0]));document.undo();expect(document.toJSON()).toEqual(before);
});
it('nearest group scope wins, null inherits, and entering a component master starts a separate radius scope',()=>{
 const {document,group,bands}=fixture(),inner=group.layers.add(new LayerGroup({frequencyRadius:5}));bands[0].moveTo(inner);expect(bands[0].frequencyGroup!.id).toBe(inner.id);inner.frequencyRadius=null;expect(bands[0].frequencyGroup!.id).toBe(group.id);
 const master=new Document({width:32,height:16}),source=master.defineComponent(new Document({width:32,height:16})),independent=master.placeSmartObject(source);independent.setFilters([new FrequencyBandFilter({sigma:7})]);document.defineComponent(master.getComponent(source),{id:source});document.defineComponent(master,{id:'independent'});
 const outer=group.layers.add(new SmartObjectLayer({componentId:'independent',width:32,height:16}));outer.setFilters([new NativeCompositionFilter()]);const contents=outer.editContents();expect((contents.layers.at(0) as SmartObjectLayer).frequencyGroup).toBeNull();expect((contents.layers.at(0) as SmartObjectLayer).smartFilters[0]).toMatchObject({sigma:7});outer.setFilters([]);const scene=document.toJSON(),expanded=resolveSmartDocument(scene,new ComponentRegistry(scene.components),{preserveFiltered:true});expect(allLayers(expanded.children).some(layer=>layer.kind==='smart-object'&&layer.componentId===source&&layer.smartFilters?.[0].kind==='frequency-band'&&layer.smartFilters[0].sigma===7)).toBe(true);
});
it('group locks, strict REST patches, schema age and embedded restoration retain the shared parameter boundary',()=>{
 const {document,group,bands}=fixture();group.locked=true;const before=document.getSnapshot();expect(()=>{group.frequencyRadius=3;}).toThrow(/unlock/i);expect(document.getSnapshot()).toBe(before);group.locked=false;
 for(const value of [-1,NaN,Infinity,1400,'3',false])expect(()=>{group.frequencyRadius=value as any;}).toThrow();expect(()=>bands[0].update({frequencyRadius:2})).toThrow(/group/i);
 expect(()=>validateDocument({...document.toJSON(),schemaVersion:36})).toThrow(/schema version 37/);
 const owner=new Document();for(const definition of document.toJSON().components??[])owner.defineComponent(document.getComponent(definition.id),{id:definition.id});const id=owner.defineComponent(document);owner.placeSmartObject(id);const saved=owner.toJSON();expect(Document.fromJSON(saved).toJSON()).toEqual(saved);(saved.components!.find(c=>c.id===id)!.source as any).document.schemaVersion=36;expect(()=>validateDocument(saved)).toThrow(/schema version 37/);
 expect(parseCommands([{type:'layer.update',id:group.id,patch:{frequencyRadius:0}}])).toHaveLength(1);expect(()=>parseCommands([{type:'layer.update',id:group.id,patch:{frequencyRadius:null,extra:1}}])).toThrow();
});

it('conversion captures the effective parent radius before entering a new native master plane',()=>{
 const {document,group,bands}=fixture();group.frequencyRadius=6;const before=document.toJSON(),instance=document.createSmartObject([bands[0]]);
 const contents=instance.editContents(),layers=allLayers(contents.toJSON().children),band=layers.find(layer=>layer.kind==='smart-object');expect(band?.kind==='smart-object'&&band.smartFilters?.[0]).toMatchObject({kind:'frequency-band',sigma:6});
 document.undo();expect(document.toJSON()).toEqual(before);
});
