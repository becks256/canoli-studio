import {useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import type {EditorApplication} from '../../src/editor';
import {Document,LayerGroup,TextLayer} from '../../src/dom';
import {findLayer,isLocked,type DocumentData} from '../../src/core/model';
import {LayersPanel} from '../../src/ui/LayersPanel';

export async function createLayerRowsHarness(editor:EditorApplication){
  editor.newDocument({width:400,height:300});
  const source=new OffscreenCanvas(8,8);source.getContext('2d')!.fillRect(0,0,8,8);
  const image=await editor.importImage(new File([await source.convertToBlob()],'row-image.png',{type:'image/png'}));
  image.name='Harness image';
  const text=editor.document.layers.add(new TextLayer({name:'Harness text',text:'Keep current'}));
  const group=editor.document.layers.add(new LayerGroup({name:'Harness group'}));
  editor.document.selectedLayer=text;
  const host=document.createElement('div');host.dataset.testid='layer-rows-harness';
  Object.assign(host.style,{position:'fixed',left:'0',top:'70px',width:'300px',height:'750px',zIndex:'99999',background:'var(--color-panel)'});document.body.append(host);
  const root=createRoot(host),events:{version:number;action:string;id?:string}[]=[];
  let pending:Promise<unknown>|undefined;
  let options:{version:number;transparency:boolean;busy:boolean;preview?:DocumentData;owner?:Document}={version:1,transparency:true,busy:false};
  function View({version,transparency,busy,preview,owner}:typeof options){
    const current=useSyncExternalStore(editor.subscribe,editor.getSnapshot),dom=owner??current.document,assets=current.assets;
    const state=useSyncExternalStore(dom.subscribe,dom.getSnapshot);
    // Capture this committed render's values, so an old callback cannot pass.
    const record=(action:string,id?:string)=>events.push({version,action,id});
    return <LayersPanel document={dom} viewDocument={preview??state.document} selectedId={state.selectedId}
      selectedLayer={dom.selectedLayer} locked={!!state.selectedId&&isLocked(state.document,state.selectedId)} busy={busy}
      historyPast={state.past} historyFuture={state.future} getThumbnail={id=>assets.get(id).thumbnail} pixels={editor.pixels}
      onInspectHistory={()=>record('history')} onCancelTools={()=>{record('cancel');editor.tools.cancel();}} onClearPreview={()=>record('clear')}
      onAttempt={action=>{record('attempt');action();}}
      onSelectLayer={(layer,additive)=>{record('select',layer.id);if(additive)dom.selectLayers([layer],dom.selectedLayers.some(item=>item.id===layer.id)?'remove':'add');else dom.selectedLayer=layer;}}
      onLoadTransparency={transparency?id=>{record('transparency',id);pending=editor.pixels.loadTransparency(id);}:undefined}
      onAddLayer={()=>{}} onAddGroup={()=>{}} onDuplicateLayer={()=>{}} onMoveLayerForward={()=>{}} onMoveLayerBackward={()=>{}} onDeleteLayer={()=>{}}/>;
  }
  const render=()=>flushSync(()=>root.render(<View {...options}/>));render();
  return {
    imageId:image.id,textId:text.id,groupId:group.id,events,
    show(next:Partial<typeof options>){options={...options,...next};render();},
    draftName(name:string){
      if(!options.preview){options.preview=structuredClone(editor.document.getSnapshot().document);Object.freeze(options.preview);}
      findLayer(options.preview,text.id)!.name=name;render();
    },
    async wait(){await pending;},
    switchOwner(){
      const original=editor.document,clone=Document.fromJSON(original.getSnapshot().document);
      clone.selectLayers(original.selectedLayers.map(layer=>clone.getLayer(layer.id)!));
      const shared=findLayer(clone.getSnapshot().document,text.id)===findLayer(original.getSnapshot().document,text.id);
      options={...options,owner:clone,version:10};render();
      return shared;
    },
    ownerVisible(){return options.owner!.getLayer(text.id)!.visible;},
    dispose(){flushSync(()=>root.unmount());host.remove();},
  };
}
