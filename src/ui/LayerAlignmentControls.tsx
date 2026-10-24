import {useEffect,useState} from 'react';
import type {Document} from '../dom';
import type {DocumentData} from '../core/model';
import {alignmentCommands,layerAlignmentSchema,type AlignmentTarget,type LayerAlignment} from '../core/layer-layout';

/** Reference choice is local UI state; the actual edit remains one shared command. */
export function LayerAlignmentControls({document:owner,viewDocument,busy,keyLayerId,onKeyChange,onAlign}:{document:Document;viewDocument:DocumentData;busy:boolean;keyLayerId?:string;onKeyChange?(id:string):void;onAlign(alignment:LayerAlignment,target:AlignmentTarget):void}){
 const roots=owner.layerSelection.rootLayers,selection=owner.getSnapshot().selectedIds.join(':'),active=owner.selectedLayer?.id;
 const[reference,setReference]=useState<'selection'|'canvas'|'layer'|null>(null),[chosenKey,setChosenKey]=useState<string|null>(null);
 useEffect(()=>{setReference(null);setChosenKey(null);},[owner,selection]);
 const selectedKey=keyLayerId??chosenKey,type=reference??(roots.length===1?'canvas':'selection'),key=selectedKey&&roots.some(layer=>layer.id===selectedKey)?selectedKey:roots.some(layer=>layer.id===active)?active:roots[0]?.id,target:AlignmentTarget=type==='layer'?{type,id:key??''}:{type};
 let reason='';try{alignmentCommands(viewDocument,owner.selectedLayers.map(layer=>layer.id),'left',target);if(type==='layer'&&roots.length<2)reason='Select another independent layer to align to the key.';}catch(error){reason=error instanceof Error?error.message:String(error);}
 if(!owner.selectedLayers.length)return null;
 return <div className="layer-filter-bar layer-alignment-controls">
  <label>Align relative to <select aria-label="Alignment reference" value={type} disabled={busy} onChange={event=>setReference(event.target.value as typeof type)}><option value="selection">Selection</option><option value="canvas">Canvas</option><option value="layer">Key object</option></select></label>
  {type==='layer'&&<label>Key object <select aria-label="Alignment key layer" disabled={busy} value={key??''} onChange={event=>{setChosenKey(event.target.value);onKeyChange?.(event.target.value);}}>{roots.map((layer,index)=><option key={layer.id} value={layer.id}>{index+1}. {layer.name}</option>)}</select></label>}
  <label>Align layers <select aria-label="Align selected layers" disabled={busy||!!reason} value="" onChange={event=>{const value=event.target.value;if(value)onAlign(value as LayerAlignment,target);}}><option value="" disabled>Choose alignment</option>{layerAlignmentSchema.options.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
  {type==='layer'&&!reason&&<span>The key object stays in place.</span>}{reason&&<span role="status">{reason}</span>}
 </div>;
}
