import {useId,useState} from 'react';
import {X} from 'lucide-react';
import {ZodError} from 'zod';
import {Dialog} from './Dialog';
import {Button,IconButton,NumberField,Select,TextInput} from './controls';
import {defaultPanelWidths,fitPanelWidths} from './panel-layout';
import {defaultWorkspaceLayout,type WorkspaceLayout,type WorkspacePanel,type WorkspacePreferences} from './workspace-layout';

export function WorkspaceLayoutDialog({preferences,loadError,onApply,onSave,onRename,onDelete,onReload,onClose}:{
 preferences:WorkspacePreferences;loadError:string;
 onApply(layout:WorkspaceLayout):void;onSave(layout:WorkspaceLayout,name:string,id?:string):void;
 onRename(id:string,name:string):void;onDelete(id:string):void;onReload():WorkspacePreferences;onClose():void;
}){
 const id=useId(),[draft,setDraft]=useState(()=>structuredClone(preferences.current)),[selected,setSelected]=useState(''),[name,setName]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState('');
 const attempt=(action:()=>void)=>{try{action();setError('');}catch(cause){setStatus('');setError(cause instanceof ZodError?cause.issues[0].message:cause instanceof Error?cause.message:String(cause));}};
 const panel=(key:WorkspacePanel,value:Partial<WorkspaceLayout['panels'][WorkspacePanel]>)=>setDraft(current=>({...current,panels:{...current.panels,[key]:{...current.panels[key],...value}}}));
 const shown=fitPanelWidths(draft.widths??defaultPanelWidths(window.innerWidth),window.innerWidth,{layers:draft.panels.layers.visible,inspector:draft.panels.inspector.visible});
 return <Dialog titleId={id} className="workspace-layout-dialog" onClose={onClose}>
  <div className="dialog-heading"><div><span className="section-caption">MAKE ROOM TO CREATE</span><h2 id={id}>Workspace layout</h2></div><IconButton label="Close workspace layout" autoFocus onClick={onClose}><X size={19}/></IconButton></div>
  <p>Dock Layers and Properties beside the canvas, hide a panel, or save a layout for later. Your artwork and history stay as they are.</p>
  {loadError&&<p role="alert">{loadError} Applying a layout replaces invalid saved settings.</p>}
  {error&&<p role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
  <Select label="Saved layout" layout="stacked" value={selected} options={[{value:'',label:'Current layout'},...preferences.presets.map(preset=>({value:preset.id,label:preset.name}))]} onChange={value=>{setSelected(value);const preset=preferences.presets.find(item=>item.id===value);setDraft(structuredClone(preset?.layout??preferences.current));setName(preset?.name??'');setStatus('');setError('');}}/>
  <div className="workspace-layout-panels">
   {(['layers','inspector'] as const).map(key=><fieldset key={key}><legend>{key==='layers'?'Layers and history':'Properties'}</legend>
    <label className="checkbox-field"><input type="checkbox" checked={draft.panels[key].visible} onChange={event=>panel(key,{visible:event.target.checked})}/>Show {key==='layers'?'Layers':'Properties'}</label>
    <Select label={`${key==='layers'?'Layers':'Properties'} dock`} value={draft.panels[key].side} options={[{value:'left',label:'Left of canvas'},{value:'right',label:'Right of canvas'}]} onChange={value=>panel(key,{side:value as 'left'|'right'})}/>
    <NumberField label={`${key==='layers'?'Layers':'Properties'} width`} value={draft.widths?.[key]??shown[key]} min={key==='layers'?190:230} max={480} integer disabled={draft.widths===null} onCommit={value=>setDraft(current=>({...current,widths:{...(current.widths??shown),[key]:value}}))}/>
   </fieldset>)}
  </div>
  <Select label="Panel order on each side" layout="stacked" value={draft.order[0]} options={[{value:'layers',label:'Layers, then Properties'},{value:'inspector',label:'Properties, then Layers'}]} onChange={value=>setDraft(current=>({...current,order:value==='layers'?['layers','inspector']:['inspector','layers']}))}/>
  <label className="checkbox-field"><input type="checkbox" checked={draft.widths===null} onChange={event=>setDraft(current=>({...current,widths:event.target.checked?null:{...shown}}))}/>Use responsive panel widths</label>
  <p className="field-hint">Panels on the same side appear next to each other in the chosen order. Widths fit the window while preserving canvas space. The tool rail always stays available.</p>
  <TextInput label="Layout name" layout="stacked" maxLength={64} value={name} onChange={setName}/>
  <p className="field-hint">Names can contain up to 64 characters. Save up to 32 layouts on this browser. Saving or updating a layout also applies it.</p>
  <div className="workspace-layout-actions">
   <Button variant="secondary" disabled={!name.trim()||preferences.presets.length>=32} onClick={()=>attempt(()=>{onSave(draft,name);onClose();})}>Save as new layout</Button>
   <Button variant="secondary" disabled={!selected||!name.trim()} onClick={()=>attempt(()=>{onSave(draft,name,selected);onClose();})}>Update saved layout</Button>
   <Button variant="subtle" disabled={!selected||!name.trim()} onClick={()=>attempt(()=>{onRename(selected,name);setStatus('Layout renamed.');})}>Rename layout</Button>
   <Button variant="subtle" disabled={!selected} onClick={()=>attempt(()=>{onDelete(selected);setSelected('');setName('');setStatus('Saved layout deleted. Your current arrangement is unchanged.');})}>Delete saved layout</Button>
  </div>
  <div className="workspace-layout-actions">
   <Button variant="subtle" onClick={()=>{setDraft(defaultWorkspaceLayout());setSelected('');setName('');setStatus('Default arrangement selected. Apply layout to use it.');setError('');}}>Restore default arrangement</Button>
   <Button variant="subtle" onClick={()=>attempt(()=>{const next=onReload();setDraft(structuredClone(next.current));setSelected('');setName('');setStatus('Saved layouts reloaded.');})}>Reload saved layouts</Button>
  </div>
  <div className="dialog-actions"><Button variant="subtle" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={()=>attempt(()=>{onApply(draft);onClose();})}>Apply layout</Button></div>
 </Dialog>;
}
