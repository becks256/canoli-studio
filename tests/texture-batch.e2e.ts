import {expect,test} from '@playwright/test';

test('batched real texture conversion preserves every independently projected pixel and reduces worker requests',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,AffineTransform}=window.luma,{BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));
  const source=new OffscreenCanvas(16,12),context=source.getContext('2d')!,image=context.createImageData(16,12);for(let y=0;y<12;y++)for(let x=0;x<16;x++)image.data.set([(31*x+7*y)%256,(43*x+9*y)%256,(17*x+13*y)%256,[0,1,85,170,255][(x+y)%5]],(y*16+x)*4);context.putImageData(image,0,0);
  const asset=await editor.assetStore.add(await source.convertToBlob(),'Batch original','texture-batch-original',false),rows=[];
  for(const channel of ['alpha','luminance'] as const)for(const invert of [false,true])for(const smoothing of [false,true]){
   const samples=[...Array.from({length:6},(_,i)=>({width:19+i,height:17+i,smoothing,sourceToOutput:new AffineTransform(1.25,.1,-.17,.9,i*2-5,3-i).toJSON()})),{width:17,height:13,smoothing,sourceToOutput:new AffineTransform(1,0,0,1,500,500).toJSON()}];
   const counts=[0,0],samplers=[0,1].map(index=>new BrushTextureSampler({brushTexture:async(...args:Parameters<typeof editor.renderer.processor.brushTexture>)=>{counts[index]++;return editor.renderer.processor.brushTexture(...args);}})),outputs:HTMLCanvasElement[]=[];
   try{
    const texture={assetId:asset.id,channel,invert},individual=[];for(const sample of samples){const output=await samplers[0].prepareAffine(editor.assetStore,texture,sample);outputs.push(output);individual.push(output);}
    const batched=await samplers[1].prepareAffineBatch(editor.assetStore,texture,samples);outputs.push(...batched);let difference=0,maximaCorrect=true;
    for(const [index,a]of individual.entries()){const x=a.getContext('2d')!.getImageData(0,0,a.width,a.height).data,b=batched[index],y=b.getContext('2d')!.getImageData(0,0,b.width,b.height).data;for(let i=0;i<x.length;i++)difference=Math.max(difference,Math.abs(x[i]-y[i]));let maximum=0;for(let i=3;i<y.length;i+=4)maximum=Math.max(maximum,y[i]);maximaCorrect&&=samplers[1].preparedMaximum(b)===maximum;}
    const cached=await samplers[1].prepareAffineBatch(editor.assetStore,texture,samples);outputs.push(...cached);for(const output of cached){const p=output.getContext('2d')!.getImageData(0,0,output.width,output.height).data;let maximum=0;for(let i=3;i<p.length;i+=4)maximum=Math.max(maximum,p[i]);maximaCorrect&&=samplers[1].preparedMaximum(output)===maximum;}
    rows.push({channel,invert,smoothing,difference,maximaCorrect,counts,individualCache: samplers[0].byteLength,batchedCache:samplers[1].byteLength});
   }finally{outputs.forEach(c=>c.width=c.height=0);samplers.forEach(s=>s.dispose());}
  }return rows;
 });await info.attach('exact-batched-native-texture',{body:JSON.stringify(rows),contentType:'application/json'});for(const row of rows){expect(row.difference,JSON.stringify(row)).toBe(0);expect(row.counts).toEqual([7,1]);expect(row.maximaCorrect).toBe(true);expect(row.batchedCache).toBe(row.individualCache);}
});

for(const action of ['abort','clear','dispose','replace-source','malformed-result'] as const)test(`pending texture batch rejects ${action} and releases every unpublished sample`,async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async action=>{
  const {editor}=window.luma,{BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));
  const source=new OffscreenCanvas(8,8);source.getContext('2d')!.fillRect(0,0,8,8);const blob=await source.convertToBlob(),asset=await editor.assetStore.add(blob,'Batch lifetime','texture-batch-lifetime',false);
  let enter!:()=>void,unblock!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>unblock=resolve),sampler=new BrushTextureSampler({brushTexture:async(...args:Parameters<typeof editor.renderer.processor.brushTexture>)=>{const pixels=await editor.renderer.processor.brushTexture(...args);enter();await gate;return action==='malformed-result'?pixels.subarray(4):pixels;}}),abort=new AbortController();
  const allocated:HTMLCanvasElement[]=[],original=document.createElement;document.createElement=function(...args:Parameters<Document['createElement']>){const element=original.apply(document,args);if(element instanceof HTMLCanvasElement)allocated.push(element);return element;} as Document['createElement'];
  try{
   const pending=sampler.prepareAffineBatch(editor.assetStore,{assetId:asset.id,channel:'alpha'},[0,1].map(i=>({width:16,height:16,sourceToOutput:{a:2,b:0,c:0,d:2,e:i,f:0}})),{signal:abort.signal});await entered;
   if(action==='abort')abort.abort();else if(action==='clear')sampler.clear();else if(action==='dispose')sampler.dispose();else if(action==='replace-source'){editor.assetStore.remove(asset.id);await editor.assetStore.add(blob,'Replacement',asset.id,false);}
   unblock();let error='';try{await pending;}catch(cause){error=String(cause);}sampler.dispose();return{error,cacheBytes:sampler.byteLength,released:allocated.every(c=>c.width===0&&c.height===0),allocated:allocated.length};
  }finally{document.createElement=original;unblock();sampler.dispose();}
 },action);await info.attach('texture-batch-rejection',{body:JSON.stringify(result),contentType:'application/json'});expect(result.error).not.toBe('');expect(result).toMatchObject({cacheBytes:0,released:true});expect(result.allocated).toBeGreaterThanOrEqual(2);
});

test('partial readbacks preserve full native affine projection across channels, edge crops and cache hits',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,AffineTransform}=window.luma,{BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));
  const source=new OffscreenCanvas(13,11),c=source.getContext('2d')!,image=c.createImageData(13,11);
  for(let y=0;y<11;y++)for(let x=0;x<13;x++)image.data.set([(x*19+y*13)%256,(x*7+y*29)%256,255,[0,1,85,170,255][(x+y)%5]],(y*13+x)*4);c.putImageData(image,0,0);
  const asset=await editor.assetStore.add(await source.convertToBlob(),'Affine readback source',undefined,false),rows=[];
  for(const channel of ['alpha','luminance'] as const)for(const invert of [false,true])for(const smoothing of [false,true]){
   const texture={assetId:asset.id,channel,invert},samples=[new AffineTransform(1.7,.29,-.33,1.3,-3.4,2.1),new AffineTransform(2,0,0,2,-5,-3),new AffineTransform(.83,-.31,.2,.91,9.5,8.25)].map(m=>({width:29,height:23,smoothing,sourceToOutput:m.toJSON()})),regions=[{x:0,y:0,width:7,height:23},{x:8,y:2,width:17,height:19},{x:21,y:18,width:8,height:5}],sampler=new BrushTextureSampler(editor.renderer.processor),outputs:HTMLCanvasElement[]=[];
   try{
    const full=await sampler.prepareAffineBatch(editor.assetStore,texture,samples);outputs.push(...full);
    const partial=await sampler.prepareAffineBatch(editor.assetStore,texture,samples,{},regions);outputs.push(...partial);
    const cached=await sampler.prepareAffineBatch(editor.assetStore,texture,samples,{},regions);outputs.push(...cached);
    let difference=0;
    for(const [i,r]of regions.entries()){
     const expected=full[i].getContext('2d')!.getImageData(r.x,r.y,r.width,r.height).data;
     for(const output of [partial[i],cached[i]]){const actual=output.getContext('2d')!.getImageData(0,0,r.width,r.height).data;for(let p=0;p<actual.length;p++)difference=Math.max(difference,Math.abs(actual[p]-expected[p]));}
    }
    rows.push({channel,invert,smoothing,difference});
   }finally{outputs.forEach(c=>c.width=c.height=0);sampler.dispose();}
  }return rows;
 });await info.attach('affine-readback-reference',{body:JSON.stringify(rows),contentType:'application/json'});for(const row of rows)expect(row.difference,JSON.stringify(row)).toBe(0);
});

test('partial texture batches release shared projection scratch before waiting and cancel every private output',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor}=window.luma,{BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));
  const source=new OffscreenCanvas(8,8);source.getContext('2d')!.fillRect(0,0,8,8);const asset=await editor.assetStore.add(await source.convertToBlob(),'Readback lifetime',undefined,false);
  let enter!:()=>void,unblock!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>unblock=resolve),sampler=new BrushTextureSampler({brushTexture:async(...args:Parameters<typeof editor.renderer.processor.brushTexture>)=>{const pixels=await editor.renderer.processor.brushTexture(...args);enter();await gate;return pixels;}}),abort=new AbortController(),allocated:HTMLCanvasElement[]=[],original=document.createElement;
  document.createElement=function(...args:Parameters<Document['createElement']>){const element=original.apply(document,args);if(element instanceof HTMLCanvasElement)allocated.push(element);return element;} as Document['createElement'];
  try{
   const pending=sampler.prepareAffineBatch(editor.assetStore,{assetId:asset.id,channel:'alpha'},[0,1].map(i=>({width:260,height:132,sourceToOutput:{a:32,b:.1,c:0,d:16,e:i,f:0}})),{signal:abort.signal},[{x:240,y:2,width:16,height:128},{x:240,y:2,width:16,height:128}]);await entered;
   const liveAtWorker=allocated.filter(c=>c.width&&c.height).map(c=>[c.width,c.height]),releasedAtWorker=allocated.filter(c=>!c.width&&!c.height).length;abort.abort();unblock();let error='';try{await pending;}catch(cause){error=String(cause);}sampler.dispose();return{liveAtWorker,releasedAtWorker,error,allReleased:allocated.every(c=>!c.width&&!c.height),cacheBytes:sampler.byteLength,sourceAlive:asset.bitmap.width===8};
  }finally{document.createElement=original;unblock();sampler.dispose();}
 });await info.attach('partial-readback-lifetime',{body:JSON.stringify(result),contentType:'application/json'});expect(result.liveAtWorker).toEqual([[16,128],[16,128]]);expect(result.releasedAtWorker).toBeGreaterThan(0);expect(result.error).toContain('Abort');expect(result).toMatchObject({allReleased:true,cacheBytes:0,sourceAlive:true});
});
