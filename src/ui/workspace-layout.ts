import {z} from 'zod';
import {PANEL_MAX,PANEL_MIN,readPanelWidths} from './panel-layout';

export const WORKSPACE_LAYOUT_KEY='luma.workspace-layout.v1';
export const workspacePanelSchema=z.object({side:z.enum(['left','right']),visible:z.boolean()}).strict();
const widthSchema=z.object({layers:z.number().int().min(PANEL_MIN.layers).max(PANEL_MAX),inspector:z.number().int().min(PANEL_MIN.inspector).max(PANEL_MAX)}).strict();
export const workspaceLayoutSchema=z.object({
 widths:widthSchema.nullable(),
 panels:z.object({layers:workspacePanelSchema,inspector:workspacePanelSchema}).strict(),
 order:z.array(z.enum(['layers','inspector'])).length(2).refine(value=>new Set(value).size===2,'Each panel must occur exactly once.'),
}).strict();
export type WorkspaceLayout=z.infer<typeof workspaceLayoutSchema>;
export type WorkspacePanel=keyof WorkspaceLayout['panels'];
const presetSchema=z.object({id:z.string().trim().min(1).max(120),name:z.string().trim().min(1).max(64),layout:workspaceLayoutSchema}).strict();
export const workspacePreferencesSchema=z.object({version:z.literal(1),current:workspaceLayoutSchema,presets:z.array(presetSchema).max(32)}).strict().superRefine((value,context)=>{
 const ids=new Set<string>(),names=new Set<string>();for(const preset of value.presets){const name=preset.name.normalize('NFKC').toLowerCase();if(ids.has(preset.id)||names.has(name))context.addIssue({code:'custom',message:'Saved layouts must have unique names and IDs.'});ids.add(preset.id);names.add(name);}
});
export type WorkspacePreferences=z.infer<typeof workspacePreferencesSchema>;
export const defaultWorkspaceLayout=():WorkspaceLayout=>({widths:null,panels:{layers:{side:'left',visible:true},inspector:{side:'right',visible:true}},order:['layers','inspector']});
export const defaultWorkspacePreferences=():WorkspacePreferences=>({version:1,current:defaultWorkspaceLayout(),presets:[]});

/** Read-only migration. A new envelope, including widths:null, takes precedence. */
export function loadWorkspacePreferences(storage:Pick<Storage,'getItem'>):{preferences:WorkspacePreferences;raw:string|null}{
 const raw=storage.getItem(WORKSPACE_LAYOUT_KEY);
 if(raw!==null)return{preferences:workspacePreferencesSchema.parse(JSON.parse(raw)),raw};
 const preferences=defaultWorkspacePreferences(),legacy=readPanelWidths(storage);if(legacy)preferences.current.widths={layers:Math.round(legacy.layers),inspector:Math.round(legacy.inspector)};
 return{preferences,raw};
}

/** One validated storage write precedes publication; detect known stale tab state. */
export function saveWorkspacePreferences(storage:Pick<Storage,'getItem'|'setItem'>,value:unknown,expectedRaw:string|null):{preferences:WorkspacePreferences;raw:string}{
 const preferences=workspacePreferencesSchema.parse(value),raw=JSON.stringify(preferences);
 if(storage.getItem(WORKSPACE_LAYOUT_KEY)!==expectedRaw)throw new Error('Workspace settings changed in another tab. Reload saved layouts before saving.');
 storage.setItem(WORKSPACE_LAYOUT_KEY,raw);return{preferences,raw};
}
