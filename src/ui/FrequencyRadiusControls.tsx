import {useEffect,useRef} from 'react';
import type {Document,LayerGroup} from '../dom';
import {isLocked} from '../core/model';
import type {EditorCommand} from '../core/commands';
import {InspectorSection} from './InspectorSection';
import {Slider} from './controls';

export function FrequencyRadiusControls({document,group,value,busy,onPreview,onAttempt}:{
  document:Document;group:LayerGroup;value:number;busy:boolean;
  onPreview(command:EditorCommand|null):void;onAttempt(action:()=>void):void;
}) {
  const revision=document.getSnapshot().revision,selected=document.selectedLayer?.id;
  const cancel=useRef(onPreview);cancel.current=onPreview;
  useEffect(()=>()=>cancel.current(null),[document,group.id,revision,selected]);
  const disabled=busy||isLocked(document.getSnapshot().document,group.id);
  const current=()=>!disabled&&group.isAttached&&document.getSnapshot().revision===revision&&document.selectedLayer?.id===selected;
  return <InspectorSection title="Frequency separation">
    <p className="section-description">Shared by the color, detail and precision bands in {group.name}. Retouch strokes stay editable.</p>
    <Slider label="Shared separation radius" min={0} max={4096/3} step={.1} suffix="px" scale="quadratic" value={value} disabled={disabled}
      onPreview={radius=>{if(!current()){onPreview(null);return;}onPreview(radius===group.frequencyRadius?null:{type:'layer.update',id:group.id,patch:{frequencyRadius:radius}});}}
      onCommit={radius=>{onPreview(null);onAttempt(()=>{if(!current())throw new Error('The frequency group changed. Review the selection and retry.');if(radius!==group.frequencyRadius)group.frequencyRadius=radius;});}}/>
  </InspectorSection>;
}
