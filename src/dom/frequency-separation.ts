import {isActiveWetPaint} from "../core/wet-operation";
import {PaintOperation,EraserStroke,PaintFill} from "./values";
import { Document, RasterLayer, LayerGroup, SmartObjectLayer, PaintLayer, LayerMask } from './index';
import { FrequencyBandFilter, NativeCompositionFilter, DocumentToneFilter } from './smart-filters';
import { frequencySeparationOptionsSchema, type FrequencySeparationOptions } from '../core/frequency-separation';
import { isLocked } from '../core/model';

/** Assemble editable bands from a canonical, unstyled native snapshot; source remains attached. */
export function createFrequencySeparation(document:Document,source:RasterLayer,snapshot:RasterLayer,options:FrequencySeparationOptions={}):LayerGroup {
  const settings=frequencySeparationOptionsSchema.parse(options);
  if(!(source instanceof RasterLayer)||!(snapshot instanceof RasterLayer)||source===snapshot||source.document!==document||snapshot.document!==document||!source.isAttached||!snapshot.isAttached)
    throw new Error('Frequency separation requires distinct attached source and native snapshot raster layers.');
  if(isLocked(document.toJSON(),source.id)||isLocked(document.toJSON(),snapshot.id))throw new Error('Frequency separation cannot edit locked ancestry.');
  const original=source.toJSON();if(original.kind!=="raster")throw new Error("Missing raster source.");
  const data=snapshot.toJSON();if(data.kind!=='raster'||data.effects.length||data.erasures?.length||data.mask||data.styles?.colorOverlay.enabled||data.styles?.dropShadow.enabled||data.styles?.blendIf.enabled||data.opacity!==1||(data.fillOpacity??1)!==1||data.blendMode!=='normal'||![data.width,data.height].every(v=>Number.isSafeInteger(v)&&v>0))
    throw new Error('Use an unstyled native snapshot with integer source dimensions.');
  const master=new Document({name:`${source.name.slice(0,210)} frequency source`,width:data.width,height:data.height});
  master.layers.add(new RasterLayer({name:'Captured native source',assetId:snapshot.assetId,width:data.width,height:data.height}));
  const outer=new LayerGroup({name:settings.name,opacity:source.opacity,fillOpacity:source.fillOpacity,visible:source.visible,blendMode:source.blendMode});
  document.transaction('Create frequency separation',()=>{
    const componentId=document.defineComponent(master);
    document.layers.add(outer);outer.moveAfter(source);outer.transform=source.transform;
    outer.mask=source.mask;outer.styles=source.styles;outer.metadata=source.metadata;
    const composition=new Document({name:`${source.name.slice(0,210)} frequency layers`,width:data.width,height:data.height});
    composition.defineComponent(master,{id:componentId});
    const bands=composition.layers.add(new LayerGroup({name:'Frequencies',frequencyRadius:settings.sigma}));
    bands.mask=new LayerMask({assetId:snapshot.assetId});
    for(const band of ['low','high'] as const){
      const stack=bands.layers.add(new LayerGroup({name:band==='low'?'Low frequency — color and tone':'High frequency — detail',blendMode:band==='high'?'linear-light':'normal'}));
      const layer=stack.layers.add(new SmartObjectLayer({name:band==='low'?'Color and tone source':'Detail source',componentId,width:data.width,height:data.height}));
      layer.setFilters([new FrequencyBandFilter({band,sigma:settings.sigma})]);
      stack.layers.add(new PaintLayer({name:band==='low'?'Color retouch':'Detail retouch'}));
    }
    const correction=bands.layers.add(new SmartObjectLayer({name:'Precision correction — keep above bands',componentId,width:data.width,height:data.height,blendMode:'linear-burn'}));
    correction.setFilters([new FrequencyBandFilter({band:'correction',sigma:settings.sigma})]);correction.locked=true;
    const compositionId=document.defineComponent(composition);
    const coverage=outer.layers.add(new LayerGroup({name:'Source coverage'}));
    const entries=original.erasures??[],nativeWet=entries.some(entry=>isActiveWetPaint(entry.stroke));
    const tail=nativeWet?[]:entries.filter(entry=>entry.stroke.kind!=='wet');
    if(tail.length)coverage.mask=new LayerMask({rasterErasures:{width:source.width,height:source.height,operations:tail.map(entry=>({width:entry.width,height:entry.height,stroke:PaintOperation.fromJSON(entry.stroke) as EraserStroke|PaintFill}))}});
    const instance=coverage.layers.add(new SmartObjectLayer({name:'Frequency layers — edit contents',componentId:compositionId,width:data.width,height:data.height}));
    instance.transform=snapshot.transform;
    instance.setFilters([new NativeCompositionFilter(),...original.effects.map(effect=>new DocumentToneFilter({enabled:effect.enabled,exposure:effect.exposure,contrast:effect.contrast,saturation:effect.saturation}))]);
    source.visible=false;snapshot.remove();
  });
  document.selectedLayer=outer;return outer;
}
