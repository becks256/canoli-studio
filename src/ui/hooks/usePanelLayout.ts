import {useEffect,useRef,useState} from 'react';
import {defaultPanelWidths,fitPanelWidths,panelReservedWidth,type PanelWidths} from '../panel-layout';
import {defaultWorkspaceLayout,defaultWorkspacePreferences,loadWorkspacePreferences,saveWorkspacePreferences,WORKSPACE_LAYOUT_KEY,type WorkspaceLayout,type WorkspacePreferences} from '../workspace-layout';

export function usePanelLayout(onError:(message:string)=>void){
 const [viewport,setViewport]=useState(()=>window.innerWidth);
 const [initial]=useState(()=>{try{return{...loadWorkspacePreferences(localStorage),error:''};}catch(error){let raw:string|null=null;try{raw=localStorage.getItem(WORKSPACE_LAYOUT_KEY);}catch{/* Recovery still requires a readable/writable store. */}return{preferences:defaultWorkspacePreferences(),raw,error:`Saved workspace layout could not be loaded. Default layout is in use.`};}});
 const [preferences,setPreferences]=useState(initial.preferences),current=useRef(preferences),raw=useRef(initial.raw);
 const [error,setError]=useState(initial.error),[preview,setPreview]=useState<PanelWidths|null>(null);
 useEffect(()=>{if(initial.error)onError(initial.error);},[initial.error,onError]);
 useEffect(()=>{const resize=()=>{setViewport(window.innerWidth);setPreview(null);};window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 const layout=preferences.current,visible={layers:layout.panels.layers.visible,inspector:layout.panels.inspector.visible};
 const widths=fitPanelWidths(preview??layout.widths??defaultPanelWidths(viewport),viewport,visible);
 const commit=(next:WorkspacePreferences)=>{const saved=saveWorkspacePreferences(localStorage,next,raw.current);raw.current=saved.raw;current.current=saved.preferences;setPreferences(saved.preferences);setPreview(null);setError('');};
 const apply=(value:WorkspaceLayout)=>commit({...current.current,current:value});
 const save=(value:WorkspaceLayout,name:string,id?:string)=>{
  if(id&&!current.current.presets.some(preset=>preset.id===id))throw new Error('The saved layout no longer exists.');
  const preset={id:id??crypto.randomUUID(),name,layout:value},presets=id?current.current.presets.map(item=>item.id===id?preset:item):[...current.current.presets,preset];
  commit({...current.current,current:value,presets});
 };
 const rename=(id:string,name:string)=>{if(!current.current.presets.some(preset=>preset.id===id))throw new Error('The saved layout no longer exists.');commit({...current.current,presets:current.current.presets.map(preset=>preset.id===id?{...preset,name}:preset)});};
 const remove=(id:string)=>commit({...current.current,presets:current.current.presets.filter(preset=>preset.id!==id)});
 const reload=()=>{const loaded=loadWorkspacePreferences(localStorage);raw.current=loaded.raw;current.current=loaded.preferences;setPreferences(loaded.preferences);setPreview(null);setError('');return loaded.preferences;};
 const change=(side:keyof PanelWidths,value:number,save:boolean)=>{
  const next=fitPanelWidths({...widths,[side]:value},viewport,visible);if(!save){setPreview(next);return;}
  try{apply({...current.current.current,widths:next});}catch(cause){onError(`Panel layout could not be saved: ${String(cause)}`);setPreview(null);}
 };
 return{widths,layout,preferences,error,apply,save,rename,remove,reload,restore:()=>apply(defaultWorkspaceLayout()),change,cancel:()=>setPreview(null),reset:(side:keyof PanelWidths)=>change(side,defaultPanelWidths(viewport)[side],true),max:(side:keyof PanelWidths)=>Math.min(480,Math.max(760,viewport)-panelReservedWidth(visible)-(visible[side==='layers'?'inspector':'layers']?widths[side==='layers'?'inspector':'layers']:0))};
}
