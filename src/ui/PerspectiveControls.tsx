import {PerspectiveTransform,RasterLayer,SmartObjectLayer,type Layer} from '../dom';
import {IDENTITY_PERSPECTIVE,type PerspectiveData} from '../core/perspective';
import type {EditorCommand} from '../core/commands';
import {InspectorSection} from './InspectorSection';
import {NumberField,Button} from './controls';

export function PerspectiveControls({layer,selected,disabled,onPreview,onAttempt,onSelectedAction}:{
  layer:RasterLayer|SmartObjectLayer;selected:{id:string;width:number;height:number;perspective?:PerspectiveData|null};disabled:boolean;
  onPreview(command:EditorCommand|null):void;onAttempt(action:()=>void):void;onSelectedAction(action:(layer:Layer)=>void):void;
}){
  const corners=layer.perspective?.corners??IDENTITY_PERSPECTIVE;
  const width=layer.width,height=layer.height;
  const value=(index:number,axis:'x'|'y',coordinate:number)=>new PerspectiveTransform({corners}).withCorner(index,{...corners[index],[axis]:coordinate/(axis==='x'?width:height)});
  return <InspectorSection title="Perspective">
    <p className="muted">Image corners in layer pixels. Original pixels and existing paint are retained. Reset perspective to paint on this image or edit its linked mask.</p>
    {['Top left','Top right','Bottom right','Bottom left'].map((label,index)=><div className="field-grid" key={label}>
      {(['x','y'] as const).map(axis=><NumberField key={axis} label={`${label} ${axis.toUpperCase()}`} value={corners[index][axis]*(axis==='x'?width:height)} min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} step="any" disabled={disabled}
        onPreview={coordinate=>onAttempt(()=>onPreview(coordinate===corners[index][axis]*(axis==='x'?width:height)?null:{type:'layer.update',id:selected.id,patch:{perspective:value(index,axis,coordinate).toJSON()}}))}
        onCommit={coordinate=>{onPreview(null);onSelectedAction(target=>{if(target instanceof RasterLayer||target instanceof SmartObjectLayer)target.perspective=value(index,axis,coordinate);});}}/>)}
    </div>)}
    <Button disabled={disabled||!layer.perspective} onClick={()=>{onPreview(null);onSelectedAction(target=>{target.perspective=null;});}}>Reset perspective</Button>
  </InspectorSection>;
}
