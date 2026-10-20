import {test,expect} from '@playwright/test';

for(const format of ['psd','psb'] as const)for(const action of ['success','cancel-pending','asset-pending','invalid-length','invalid-blob','wrong-id','worker-error','message-error'] as const)
test(`${format} private encoding ${action} releases workers and preserves source ownership`,async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async({format,action})=>{
  const {editor,RasterLayer}=window.luma;editor.newDocument({width:2081,height:140});
  const canvas=document.createElement('canvas');canvas.width=canvas.height=16;canvas.getContext('2d')!.fillRect(0,0,16,16);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!)));
  const source=await editor.assetStore.add(blob,'Original',undefined,false);editor.document.layers.add(new RasterLayer({assetId:source.id,width:2081,height:140}));
  const before=JSON.stringify(editor.document.toJSON()),original=[...new Uint8Array(await source.blob.arrayBuffer())],Native=window.Worker,abort=new AbortController();
  let workers=0,terminated=0,transfers=0,changed=false,error='',returned=false;const detached:boolean[]=[],surfaces:HTMLCanvasElement[]=[],render=editor.renderer.render.bind(editor.renderer);
  editor.renderer.render=async(...args)=>{const tile=await render(...args);surfaces.push(tile);return tile;};
  window.Worker=new Proxy(Native,{construct(Target,args){
   const worker=Reflect.construct(Target,args) as Worker;
   if(String(args[0]).includes('photoshop-export.worker')){
    workers++;const post=worker.postMessage.bind(worker),terminate=worker.terminate.bind(worker);
    worker.terminate=()=>{terminated++;terminate();};
    worker.addEventListener('message',event=>{
     if(changed)return;
     if(action==='invalid-length'){changed=true;event.data.channels[0].lengths[0]=0;}
     else if(action==='invalid-blob'){changed=true;event.data.channels[0].data=new Blob([]);}
     else if(action==='wrong-id'){changed=true;event.data.id=-1;}
    });
    worker.postMessage=((value:{pixels:Uint8ClampedArray},transfer:Transferable[])=>{
     if(transfer.length!==1||transfer[0]!==value.pixels.buffer)throw new Error('Unexpected export transfer ownership');
     transfers++;post(value,transfer);detached.push(value.pixels.byteLength===0);
     if(!changed&&['cancel-pending','asset-pending','worker-error','message-error'].includes(action)){
      changed=true;
      if(action==='asset-pending')editor.assetStore.remove(source.id);
      else if(action==='cancel-pending')setTimeout(()=>abort.abort(new Error('Stop pending encoding')),0);
      else if(action==='worker-error')setTimeout(()=>worker.dispatchEvent(new ErrorEvent('error')),0);
      else setTimeout(()=>worker.dispatchEvent(new MessageEvent('messageerror')),0);
     }
    }) as Worker['postMessage'];
   }
   return worker;
  }});
  try{await editor.export({format},{signal:abort.signal});returned=true;}catch(e){error=String(e);}
  finally{window.Worker=Native;editor.renderer.render=render;}
  const retained=[...new Uint8Array(await source.blob.arrayBuffer())];
  const output={workers,terminated,transfers,detached,changed,error,returned,readonly:before===JSON.stringify(editor.document.toJSON()),sourceUnchanged:retained.length===original.length&&retained.every((v,i)=>v===original[i]),bitmapRetained:action==='asset-pending'||source.bitmap.width===16,released:surfaces.every(s=>!s.width&&!s.height)};
  if(action==='asset-pending')await editor.assetStore.add(blob,'Restored',source.id,false);
  const retry=await editor.export({format});return{...output,retry:retry.blob.size>0};
 },{format,action});
 expect(result.workers).toBe(1);expect(result.terminated).toBe(1);expect(result.transfers).toBeGreaterThan(0);expect(result.detached.every(Boolean)).toBe(true);expect(result.sourceUnchanged).toBe(true);expect(result.bitmapRetained).toBe(true);expect(result.readonly).toBe(true);expect(result.released).toBe(true);expect(result.retry).toBe(true);
 if(action==='success')expect(result.returned).toBe(true);
 else{expect(result.returned).toBe(false);expect(result.changed).toBe(true);expect(result.error).toMatch(/Stop pending encoding|source changed|Invalid Photoshop|Unexpected Photoshop|worker failed/);}
 await info.attach('photoshop-worker-lifetime',{body:JSON.stringify(result),contentType:'application/json'});
});
