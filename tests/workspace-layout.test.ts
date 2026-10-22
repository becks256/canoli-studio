import {expect,it} from 'vitest';
import {defaultWorkspaceLayout,defaultWorkspacePreferences,loadWorkspacePreferences,saveWorkspacePreferences,WORKSPACE_LAYOUT_KEY,workspacePreferencesSchema} from '../src/ui/workspace-layout';
import {fitPanelWidths,panelReservedWidth,PANEL_LAYOUT_KEY} from '../src/ui/panel-layout';

function storage(){const values=new Map<string,string>();return{values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};}
it('imports legacy widths without writes and an explicit responsive layout takes precedence on reload',()=>{
 const store=storage(),legacy=JSON.stringify({version:1,layers:301.25,inspector:347.8});store.values.set(PANEL_LAYOUT_KEY,legacy);
 const initial=loadWorkspacePreferences(store);expect(initial.raw).toBeNull();expect(initial.preferences.current.widths).toEqual({layers:301,inspector:348});expect(store.values.size).toBe(1);
 saveWorkspacePreferences(store,defaultWorkspacePreferences(),null);expect(loadWorkspacePreferences(store).preferences.current.widths).toBeNull();expect(store.values.get(PANEL_LAYOUT_KEY)).toBe(legacy);
});
it('persists detached named docking, visibility, order and preferred widths in one validated write',()=>{
 const store=storage(),value=defaultWorkspacePreferences();value.current={widths:{layers:420,inspector:400},panels:{layers:{side:'right',visible:false},inspector:{side:'left',visible:true}},order:['inspector','layers']};value.presets=[{id:'paint',name:' Painting ',layout:structuredClone(value.current)}];
 const saved=saveWorkspacePreferences(store,value,null);value.current.panels.layers.side='left';value.presets[0].layout.widths!.layers=190;
 expect(saved.preferences.presets[0].name).toBe('Painting');expect(saved.preferences.current.panels.layers.side).toBe('right');expect(loadWorkspacePreferences(store).preferences).toEqual(saved.preferences);expect(saved.preferences.presets[0].layout.widths!.layers).toBe(420);
});
it('rejects unknown fields, malformed settings, duplicate names/IDs/order and invalid geometry before storage writes',()=>{
 const valid=defaultWorkspacePreferences(),preset={id:'a',name:'Painting',layout:defaultWorkspaceLayout()};
 const bad=[null,{...valid,version:2},{...valid,extra:true},{...valid,current:{...valid.current,widths:{layers:NaN,inspector:300}}},{...valid,current:{...valid.current,widths:{layers:190.5,inspector:300}}},{...valid,current:{...valid.current,widths:{layers:190,inspector:481}}},{...valid,current:{...valid.current,order:['layers','layers']}},{...valid,current:{...valid.current,order:['layers']}},{...valid,current:{...valid.current,panels:{...valid.current.panels,layers:{side:'floating',visible:true}}}},{...valid,current:{...valid.current,panels:{...valid.current.panels,layers:{side:'left',visible:1}}}},{...valid,presets:[preset,{...preset,id:'b',name:'ＰＡＩＮＴＩＮＧ'}]},{...valid,presets:[preset,{...preset,name:'Other'}]},{...valid,presets:[{...preset,name:' '}]},{...valid,presets:[{...preset,name:'a'.repeat(65)}]},{...valid,presets:Array.from({length:33},(_,i)=>({...preset,id:String(i),name:String(i)}))}];
 for(const value of bad){const store=storage();expect(()=>saveWorkspacePreferences(store,value,null)).toThrow();expect(store.values.size).toBe(0);}
});
it('preserves newer tab settings and propagates storage rejection without publishing a replacement',()=>{
 const store=storage(),first=saveWorkspacePreferences(store,defaultWorkspacePreferences(),null),changed=defaultWorkspacePreferences();changed.current.panels.layers.visible=false;const second=saveWorkspacePreferences(store,changed,first.raw);
 expect(()=>saveWorkspacePreferences(store,defaultWorkspacePreferences(),first.raw)).toThrow(/another tab/);expect(store.getItem(WORKSPACE_LAYOUT_KEY)).toBe(second.raw);
 expect(()=>saveWorkspacePreferences({getItem:()=>second.raw,setItem:()=>{throw new Error('quota');}},defaultWorkspacePreferences(),second.raw)).toThrow(/quota/);
 expect(()=>loadWorkspacePreferences({getItem:()=>{throw new Error('read denied');}})).toThrow(/read denied/);
});
it('retains corrupt stored bytes for explicit recovery and rejects invalid legacy reads',()=>{
 const store=storage();store.values.set(WORKSPACE_LAYOUT_KEY,'broken');expect(()=>loadWorkspacePreferences(store)).toThrow();expect(store.getItem(WORKSPACE_LAYOUT_KEY)).toBe('broken');saveWorkspacePreferences(store,defaultWorkspacePreferences(),'broken');expect(loadWorkspacePreferences(store).preferences).toEqual(defaultWorkspacePreferences());
 store.values.delete(WORKSPACE_LAYOUT_KEY);store.values.set(PANEL_LAYOUT_KEY,'broken');expect(()=>loadWorkspacePreferences(store)).toThrow();
});
it('fits only visible docks while preserving each stored preferred width across viewport changes',()=>{
 const preferred={layers:480,inspector:480};
 for(const layers of [true,false])for(const inspector of [true,false])for(const viewport of [760,900,1100,1440,1920]){
  const visible={layers,inspector},widths=fitPanelWidths(preferred,viewport,visible);expect(widths.layers).toBeGreaterThanOrEqual(190);expect(widths.inspector).toBeGreaterThanOrEqual(230);
  expect((layers?widths.layers:0)+(inspector?widths.inspector:0)+panelReservedWidth(visible)).toBeLessThanOrEqual(viewport);
  if(!layers)expect(widths.layers).toBe(480);if(!inspector)expect(widths.inspector).toBe(480);
 }
 expect(preferred).toEqual({layers:480,inspector:480});expect(fitPanelWidths(preferred,1920)).toEqual(preferred);expect(workspacePreferencesSchema.parse(defaultWorkspacePreferences()).current.order).toEqual(['layers','inspector']);
});
