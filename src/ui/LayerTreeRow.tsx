import {memo} from 'react';
import {CornerDownRight,ChevronDown,ChevronRight,Component,Eye,EyeOff,Folder,Layers,LockKeyhole,Paintbrush,PenTool,SlidersHorizontal,Type,UnlockKeyhole} from 'lucide-react';
import type {DocumentData,LayerData} from '../core/model';
import {isImmutable} from '../core/immutable';
import type {RasterEditing} from '../raster-editing';
import {LayerThumbnail} from './LayerThumbnail';

const icons={
  collapsed:<ChevronRight size={12}/>,expanded:<ChevronDown size={12}/>,
  group:<Folder size={17}/>,paint:<Paintbrush size={15}/>,vector:<PenTool size={15}/>,
  text:<Type size={15}/>,smartObject:<Component size={15}/>,adjustment:<SlidersHorizontal size={15}/>,layer:<Layers size={15}/>,
  locked:<LockKeyhole size={12}/>,unlocked:<UnlockKeyhole size={12}/>,visible:<Eye size={13}/>,hidden:<EyeOff size={13}/>,
};

interface LayerTreeRowProps {
  node:LayerData;
  depth:number;
  selected:boolean;
  locked:boolean;
  busy:boolean;
  filterContext:boolean;
  filtered:boolean;
  collapsed:boolean;
  dropPlacement?:'before'|'after'|'inside';
  thumbnailDocument?:DocumentData;
  pixels?:RasterEditing;
  paused:boolean;
  fallback?:string;
}

/** Presentation only. The panel routes events with its current document/callbacks. */
export const LayerTreeRow=memo(function LayerTreeRow({node,depth,selected,locked,busy,filterContext,filtered,collapsed,dropPlacement,thumbnailDocument,pixels,paused,fallback}:LayerTreeRowProps){
  return <div
    className={`layer-row ${filterContext?'filter-context':''} ${selected?'selected':''} ${!node.visible?'muted':''} ${dropPlacement?`drop-${dropPlacement}`:''}`}
    data-layer-id={node.id}
    style={{paddingLeft:8+depth*16+(node.clipped?8:0)}}
    draggable={!busy&&!locked}
  >
    {node.kind==='group'?<button className="tree-toggle" aria-label={`Toggle ${node.name}`} disabled={filtered} data-layer-action="toggle">
      {collapsed?icons.collapsed:icons.expanded}
    </button>:<span className="tree-spacer"/>}
    <button className="layer-select" aria-pressed={selected} aria-label={`Select ${node.name}`} data-layer-action="select">
      {node.clipped&&<span role="img" aria-label="Clipped to base layer"><CornerDownRight size={12}/></span>}
      {node.kind==='group'?<span className="layer-thumb group-thumb">{icons.group}</span>
        :(node.kind==='raster'||node.kind==='paint')&&pixels&&thumbnailDocument?<LayerThumbnail document={thumbnailDocument} layerId={node.id} name={node.name} pixels={pixels} paused={paused} fallback={fallback}/>
        :node.kind==='raster'?<img className="layer-thumb" src={fallback} alt=""/>
        :node.kind==='smart-object'?<span className="layer-thumb group-thumb" title="Smart object">{icons.smartObject}</span>
        :<span className="layer-thumb group-thumb">{node.kind==='paint'?icons.paint:node.kind==='vector'?icons.vector:node.kind==='text'?icons.text:node.kind==='adjustment'?icons.adjustment:icons.layer}</span>}
      <span className="layer-name">{node.name}</span>
    </button>
    <button className={`layer-control ${node.locked?'always':''}`} aria-label={`${node.locked?'Unlock':'Lock'} ${node.name}`} data-layer-action="lock">
      {node.locked?icons.locked:icons.unlocked}
    </button>
    <button className="layer-control always" aria-label={`${node.visible?'Hide':'Show'} ${node.name}`} disabled={locked} data-layer-action="visibility">
      {node.visible?icons.visible:icons.hidden}
    </button>
  </div>;
},(previous,next)=>{
  // Unproven previews may change in place. Keep their ordinary fresh render.
  if(!isImmutable(previous.node)||!isImmutable(next.node))return false;
  if(previous.thumbnailDocument&&!isImmutable(previous.thumbnailDocument))return false;
  if(next.thumbnailDocument&&!isImmutable(next.thumbnailDocument))return false;
  // Compare every prop, including any future callbacks or rendering inputs.
  const keys=Object.keys(next) as (keyof LayerTreeRowProps)[];
  return keys.length===Object.keys(previous).length&&keys.every(key=>Object.is(previous[key],next[key]));
});
