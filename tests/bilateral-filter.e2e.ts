import {expect,test} from '@playwright/test';

test('bilateral worker captures input before readiness, preserves alpha and recovers after rejected requests',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {PixelProcessor}=await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const processor=new PixelProcessor();
    try{
      const input=new Uint8ClampedArray(9*7*4);for(let i=0;i<input.length;i+=4)input.set([80,110,140,255],i);
      input.set([255,255,255,255],(3*9+4)*4);input.set([23,56,231,0],0);const saved=input.slice();
      const options={radius:1,colorSigma:255,amount:1};
      const pending=processor.bilateralFilter(input,9,7,options);input.fill(0);options.radius=0;options.amount=0;const output:Uint8ClampedArray=await pending;
      const errors:string[]=[];for(const [width,height,radius] of [[8,7,1],[9,7,.5],[9,7,17]]){
        try{await processor.bilateralFilter(saved,width,height,{radius,colorSigma:25,amount:1});}catch(error){errors.push(String(error));}
      }
      const again:Uint8ClampedArray=await processor.bilateralFilter(saved,9,7,{radius:1,colorSigma:255,amount:1}),noop:Uint8ClampedArray=await processor.bilateralFilter(saved,9,7,{radius:0,colorSigma:25,amount:1});
      return {changed:output.some((v,i)=>v!==saved[i]),center:[...output.slice((3*9+4)*4,(3*9+4)*4+4)],hidden:[...output.slice(0,4)],
        equal:output.every((v,i)=>v===again[i]),source:saved[(3*9+4)*4],noop:noop.every((v,i)=>v===saved[i]),errors};
    }finally{processor.dispose();}
  });
  expect(result).toMatchObject({changed:true,hidden:[23,56,231,0],equal:true,source:255,noop:true});
  expect(result.errors).toHaveLength(3);
  await info.attach('bilateral-worker',{body:JSON.stringify(result),contentType:'application/json'});
});

test('scripted bilateral stack matches independent native equations and reduces controlled fine noise, masks, tile seams, undo and project reopening',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {editor,LayerMask,MarqueeSelection}=window.luma,width=603,height=49;
    editor.newDocument({width,height});
    const image=new OffscreenCanvas(width,height),context=image.getContext('2d')!,bytes=new Uint8ClampedArray(width*height*4);
    const clean=bytes.slice();let seed=7319841;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const at=(y*width+x)*4,color=x<301?[60,85,110,255]:[185,210,235,255];clean.set(color,at);
      for(let c=0;c<3;c++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;bytes[at+c]=color[c]+((seed>>>24)%25)-12;}bytes[at+3]=255;
    }
    context.putImageData(new ImageData(bytes,width,height),0,0);const blob=await image.convertToBlob(),asset=await editor.assetStore.add(blob,'Noisy source',undefined,false);
    await editor.runScript(`const master=new Document({width:${width},height:${height}});master.layers.add(new RasterLayer({assetId:${JSON.stringify(asset.id)},width:${width},height:${height}}));document.placeSmartObject(document.defineComponent(master));`);
    const instance=editor.document.layers.at(0) as InstanceType<typeof window.luma.SmartObjectLayer>,before=editor.document.toJSON(),history=editor.document.getSnapshot().past.length;
    async function pixels(cache=true,region?:{x:number;y:number;width:number;height:number}){
      const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache,readback:true,region});
      const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;canvas.width=canvas.height=0;return pixels;
    }
    const original=await pixels();await editor.runScript('document.layers.at(0).setFilters([new BilateralDenoiseFilter({radius:3,colorSigma:20,amount:1})]);');
    const authored=editor.document.toJSON(),oneUndo=editor.document.getSnapshot().past.length===history+1,filtered=await pixels(),uncached=await pixels(false);
    // Independent normalized direct 2D equation, using no WASM weight tables.
    let maxError=0,beforeMse=0,afterMse=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const at=(y*width+x)*4,channels=[0,0,0];let total=0;
      for(let yy=Math.max(0,y-3);yy<=Math.min(height-1,y+3);yy++)for(let xx=Math.max(0,x-3);xx<=Math.min(width-1,x+3);xx++){
        const p=(yy*width+xx)*4;let d=0;for(let c=0;c<3;c++)d+=(bytes[p+c]-bytes[at+c])**2;
        const w=Math.exp(-((xx-x)**2+(yy-y)**2)/4.5-d/2400);total+=w;for(let c=0;c<3;c++)channels[c]+=bytes[p+c]*w;
      }
      for(let c=0;c<3;c++){
        maxError=Math.max(maxError,Math.abs(filtered[at+c]-Math.round(channels[c]/total)));
        beforeMse+=(bytes[at+c]-clean[at+c])**2;afterMse+=(filtered[at+c]-clean[at+c])**2;
      }
    }
    beforeMse/=width*height*3;afterMse/=width*height*3;
    let cropDifferences=0;
    for(const region of [{x:249,y:5,width:29,height:33},{x:503,y:7,width:75,height:30}]){
      const cropped=await pixels(false,region);for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++)for(let c=0;c<4;c++)
        if(cropped[(y*region.width+x)*4+c]!==filtered[((y+region.y)*width+x+region.x)*4+c])cropDifferences++;
    }
    editor.document.undo();const undoEqual=JSON.stringify(editor.document.toJSON())===JSON.stringify(before),undone=await pixels();editor.document.redo();
    instance.filterMask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:300,height}),density:.5});
    const masked=await pixels();let maskDifferences=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){
      const p=(y*width+x)*4+c,expected=x<300?filtered[p]:Math.round((original[p]+filtered[p])/2);if(masked[p]!==expected)maskDifferences++;
    }
    const exported=await editor.exportPng(),decoded=await createImageBitmap(exported),check=new OffscreenCanvas(width,height),checkContext=check.getContext('2d')!;
    checkContext.drawImage(decoded,0,0);decoded.close();const exportPixels=checkContext.getImageData(0,0,width,height).data;
    const project=await editor.saveProject();await editor.openProject(new File([project],'bilateral.luma'));const reopened=await pixels();
    const sourceEqual=new Uint8Array(await editor.assetStore.get(asset.id).blob.arrayBuffer()).join()===new Uint8Array(await blob.arrayBuffer()).join();
    return {maxError,beforeMse,afterMse,noiseRatio:afterMse/beforeMse,cropDifferences,maskDifferences,oneUndo,undoEqual,undoPixels:original.every((v,i)=>v===undone[i]),
      cacheEqual:filtered.every((v,i)=>v===uncached[i]),exportEqual:masked.every((v,i)=>v===exportPixels[i]),reopenedEqual:masked.every((v,i)=>v===reopened[i]),
      sourceEqual,masterEqual:JSON.stringify(before.components)===JSON.stringify(authored.components),filter:(editor.document.layers.at(0) as typeof instance).smartFilters[0]};
  });
  expect(result).toMatchObject({cropDifferences:0,maskDifferences:0,oneUndo:true,undoEqual:true,undoPixels:true,cacheEqual:true,exportEqual:true,reopenedEqual:true,sourceEqual:true,masterEqual:true,filter:{kind:'bilateral-denoise',radius:3,colorSigma:20,amount:1}});
  expect(result.maxError).toBeLessThanOrEqual(1);expect(result.noiseRatio).toBeLessThan(.35);
  await info.attach('bilateral-native',{body:JSON.stringify(result),contentType:'application/json'});
});

test('Inspector bilateral radius has exact input, cancellable keyboard preview, enable and remove with one-step undo',async({page})=>{
  await page.goto('/');await page.evaluate(()=>{
    const {editor,Document}=window.luma;editor.newDocument({width:64,height:64});
    const instance=editor.document.placeSmartObject(editor.document.defineComponent(new Document({width:64,height:64})));
    editor.document.selectedLayer=instance;
  });
  await page.getByRole('combobox',{name:'Filter type',exact:true}).selectOption('bilateral-denoise');await page.getByRole('button',{name:'Add filter',exact:true}).click();
  const card=page.getByRole('group',{name:'Bilateral denoise filter 1',exact:true}),number=card.getByRole('spinbutton',{name:'Denoise radius value',exact:true}),slider=card.getByRole('slider',{name:'Denoise radius',exact:true});
  const state=()=>page.evaluate(()=>({history:window.luma.editor.document.getSnapshot().past.length,json:window.luma.editor.document.toJSON()}));
  await expect(card.getByRole('spinbutton',{name:'Color tolerance value',exact:true})).toHaveValue('25');
  await expect(card.getByRole('spinbutton',{name:'Denoise strength value',exact:true})).toHaveValue('0.5');
  const added=await state();await number.fill('3');await number.press('Enter');const exact=await state();expect(exact.history).toBe(added.history+1);await expect(slider).toHaveAttribute('aria-valuenow','3');
  await slider.focus();await page.keyboard.down('ArrowRight');await expect(number).toHaveValue('4');expect(await state()).toEqual(exact);
  await page.keyboard.press('Escape');await page.keyboard.up('ArrowRight');await expect(number).toHaveValue('3');expect(await state()).toEqual(exact);
  await number.fill('1.5');await number.press('Enter');await expect(number).toHaveValue('3');expect(await state()).toEqual(exact);
  await card.getByRole('checkbox',{name:'Enable Bilateral denoise filter 1'}).uncheck();await expect(number).toBeDisabled();
  await page.getByRole('button',{name:'Remove Bilateral denoise filter',exact:true}).click();await expect(card).toHaveCount(0);
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+z');await expect(card).toBeVisible();await expect(number).toHaveValue('3');
});

test('native bilateral keeps 50 MP original dimensions/bytes through crop, export-source storage and project reopening',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {editor,Document,RasterLayer,BilateralDenoiseFilter}=window.luma,width=10000,height=5000;editor.newDocument({width,height});
    const image=new OffscreenCanvas(width,height),context=image.getContext('2d')!;context.fillStyle='#466482';context.fillRect(0,0,width,height);
const blob=await image.convertToBlob();image.width=image.height=1;
    const digest=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');
    const sourceHash=await digest(blob),asset=await editor.assetStore.add(blob,'50 MP source',undefined,false);
    const master=new Document({width,height});master.layers.add(new RasterLayer({assetId:asset.id,width,height}));
    const instance=editor.document.placeSmartObject(editor.document.defineComponent(master));
    instance.setFilters([new BilateralDenoiseFilter({radius:3,colorSigma:20,amount:1})]);const region={x:4096,y:2048,width:1024,height:128};
    async function check(){const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{readback:true,cache:false,region});
      const bytes=canvas.getContext('2d')!.getImageData(0,0,region.width,region.height).data;canvas.width=canvas.height=0;
      return bytes.every((v,i)=>v===[70,100,130,255][i%4]);}
    const before=await check(),project=await editor.saveProject();await editor.openProject(new File([project],'bilateral-50mp.luma'));
    const after=await check(),source=editor.assetStore.get(asset.id),saved=editor.document.toJSON();
    return {before,after,sourceHash,restoredHash:await digest(source.blob),sourceSize:[source.width,source.height],documentSize:[saved.width,saved.height],
      component:saved.components?.[0].source.kind==='document'?[saved.components[0].source.document.width,saved.components[0].source.document.height]:null};
  });
  expect(result).toMatchObject({before:true,after:true,sourceSize:[10000,5000],documentSize:[10000,5000],component:[10000,5000]});expect(result.restoredHash).toBe(result.sourceHash);
  await info.attach('bilateral-50mp',{body:JSON.stringify(result),contentType:'application/json'});
});

test('ordered bilateral filters retain affine native masks, cache/crop parity, bypass and editable source ownership',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {editor,Document,RasterLayer,BilateralDenoiseFilter,SmartToneFilter,LayerMask,MarqueeSelection,AffineTransform}=window.luma;
    editor.newDocument({width:320,height:180});const width=151,height=87,canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d')!;
    const bytes=Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?255:(i*79+Math.floor(i/17)*43)%256);
    context.putImageData(new ImageData(bytes,width,height),0,0);const asset=await editor.assetStore.add(await canvas.convertToBlob(),'Color noise',undefined,false);
    const master=new Document({width,height});master.layers.add(new RasterLayer({assetId:asset.id,width,height}));
    const instance=editor.document.placeSmartObject(editor.document.defineComponent(master),{x:45.375,y:30.25,width:210,height:121});
    instance.transform=new AffineTransform(.93,.11,-.19,.96,0,0);
    instance.filterMask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:19,y:9,width:109,height:67}),density:.65,inverted:true,feather:1.7});
    const originalSource=JSON.stringify(editor.document.toJSON().components);
    const bilateral=new BilateralDenoiseFilter({radius:3}),tone=new SmartToneFilter({saturation:-80});
    async function pixels(cache=true,region?:{x:number;y:number;width:number;height:number}){
      const surface=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{readback:true,cache,region});
      const data=surface.getContext('2d')!.getImageData(0,0,surface.width,surface.height).data;surface.width=surface.height=0;return data;
    }
    const original=await pixels();instance.setFilters([bilateral,tone]);const after=await pixels(),uncached=await pixels(false);let crops=0;
    for(const region of [{x:47,y:36,width:111,height:89},{x:129,y:71,width:115,height:73}]){
      const tile=await pixels(false,region);for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++)for(let c=0;c<4;c++)
        if(tile[(y*region.width+x)*4+c]!==after[((y+region.y)*320+x+region.x)*4+c])crops++;
    }
    instance.setFilters([tone,bilateral]);const reordered=await pixels();
    instance.setFilters([new BilateralDenoiseFilter({radius:16,enabled:false})]);const disabled=await pixels();
    instance.setFilters([new BilateralDenoiseFilter({radius:0})]);const zero=await pixels();
    instance.setFilters([new BilateralDenoiseFilter({colorSigma:0})]);const zeroColor=await pixels();
    instance.setFilters([new BilateralDenoiseFilter({amount:0})]);const zeroAmount=await pixels();
    return {zeroColor:zeroColor.every((v,i)=>v===original[i]),zeroAmount:zeroAmount.every((v,i)=>v===original[i]),cached:after.every((v,i)=>v===uncached[i]),crops,changed:after.some((v,i)=>v!==original[i]),
      orderMatters:reordered.some((v,i)=>v!==after[i]),disabled:disabled.every((v,i)=>v===original[i]),zero:zero.every((v,i)=>v===original[i]),
      sourceUnchanged:originalSource===JSON.stringify(editor.document.toJSON().components)};
  });
  expect(result).toEqual({zeroColor:true,zeroAmount:true,cached:true,crops:0,changed:true,orderMatters:true,disabled:true,zero:true,sourceUnchanged:true});
  await info.attach('bilateral-affine',{body:JSON.stringify(result),contentType:'application/json'});
});
