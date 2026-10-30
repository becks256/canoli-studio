import{execute,type EditorCommand}from'../core/commands';
import type{DocumentData}from'../core/model';

export interface GesturePreviewContext{
 owner:object;source:DocumentData;selection:readonly string[];gesture:object|null;
}
export interface GesturePreview extends GesturePreviewContext{
 command:EditorCommand;document:DocumentData;valid:boolean;
}

export const samePreviewSelection=(a:readonly string[],b:readonly string[])=>a===b||a.length===b.length&&a.every((id,index)=>id===b[index]);

/** Private UI channel for one detached, shared-command preview. It owns no
 * attached edits/history/assets, and a preview never retargets a new owner or
 * source revision. React and the canvas consume the same validated snapshot. */
export class GesturePreviews{
 private current:GesturePreview|null=null;
 private listeners=new Set<()=>void>();
 getSnapshot=()=>this.current;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 publish(command:EditorCommand|null,context:GesturePreviewContext){
  if(command){
   let document=context.source,valid=true;
   try{document=execute(context.source,command);}catch{valid=false;}
   this.current={...context,command,document,valid};
  }else{if(!this.current)return;this.current=null;}
  for(const listener of this.listeners)listener();
 }
}
