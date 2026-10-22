import {useSyncExternalStore} from 'react';
import type {EditorApplication} from '../editor';
import type {RecentSummary} from '../workspace/recent-files';
import type {ShortcutAction} from './shortcuts';
import {CommandPalette} from './CommandPalette';

export function WorkspaceCommandPalette({editor,actions,busy,onClose,onExecute,onRecent}:{editor:EditorApplication;actions:ShortcutAction[];busy:boolean;onClose():void;onExecute(action:ShortcutAction):void;onRecent(entry:RecentSummary):void}){
 const recent=useSyncExternalStore(editor.recentFiles.subscribe,editor.recentFiles.getSnapshot);
 const documents:ShortcutAction[]=editor.documentSessions.map(session=>({id:'open-document:'+session.id,label:session.document.name,category:'Open documents',description:`${session.document.width} × ${session.document.height} px${session.document===editor.document?' · Current document':''}`,keys:[],enabled:()=>editor.documentSessions.some(item=>item.id===session.id),run:()=>{if(editor.documentSessions.some(item=>item.id===session.id))editor.activateDocument(session.document);}}));
 const files:ShortcutAction[]=recent.entries.filter(entry=>entry.id&&!entry.error).map(entry=>({id:'recent-file:'+entry.id,label:entry.name,category:'Recent files',description:`${entry.kind==='project'?'Project':entry.kind==='photoshop'?'Photoshop':entry.kind?.toUpperCase()} · Local copy`,keys:[],enabled:()=>editor.recentFiles.getSnapshot().entries.some(item=>item.id===entry.id&&!item.error),run:()=>onRecent(entry)}));
 return <CommandPalette actions={[...actions,...documents,...files]} busy={busy} onClose={onClose} onExecute={onExecute}/>;
}
