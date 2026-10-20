import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('actual texture worker snapshots caller pixels/settings before readiness and validates errors without poisoning later work', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const processor = new PixelProcessor();
    try {
      const source = new Uint8ClampedArray([0,0,0,255,255,255,255,128,255,0,0,128,0,0,0,0]);
      const settings = { channel: 'luminance', invert: false };
      const pending = processor.brushTexture(source, settings);
      source.fill(17); settings.channel = 'alpha'; settings.invert = true;
      const output = await pending;
      const errors = [];
      for (const run of [() => processor.brushTexture(new Uint8ClampedArray(3)),
        () => processor.brushTexture(new Uint8ClampedArray(4), { extra: true })]) {
        try { await run(); } catch (error) { errors.push(String(error)); }
      }
      const recovered = await processor.brushTexture(new Uint8ClampedArray([123,45,67,64]), { channel: 'alpha', invert: true });
      return { output: [...output], recovered: [...recovered], caller: [...source], errors };
    } finally { processor.dispose(); }
  });
  expect(result.output).toEqual([255,255,255,255,255,255,255,0,255,255,255,101,255,255,255,0]);
  expect(result.recovered).toEqual([255,255,255,191]);
  expect(result.caller).toEqual(Array(16).fill(17));
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]).toContain('RGBA');
});

test('source-backed masks preserve original bytes and agree with independent native source pixels for every channel/inversion', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { BrushTextureSampler } = await import(/* @vite-ignore */ String('/src/engine/brush-texture.ts'));
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const { AssetStore } = await import(/* @vite-ignore */ String('/src/core/assets.ts'));
    const assets = new AssetStore(), processor = new PixelProcessor(), sampler = new BrushTextureSampler(processor);
    const source = document.createElement('canvas'); source.width = 8; source.height = 4;
    const context = source.getContext('2d')!, image = context.createImageData(8, 4);
    for (let i = 0; i < image.data.length; i += 4) image.data.set([(i * 71) % 256,(i * 43) % 256,(i * 17) % 256, ((i / 4) % 4) * 85], i);
    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>(resolve => source.toBlob(value => resolve(value!)));
    try {
      const asset = await assets.add(blob, 'Original tip', 'tip', false);
      context.clearRect(0,0,8,4); context.drawImage(asset.bitmap,0,0);
      const decoded = context.getImageData(0,0,8,4).data;
      const cases = [];
      for (const channel of ['alpha', 'luminance']) for (const invert of [false, true]) {
        const tile = await sampler.prepare(assets, { assetId: asset.id, channel, invert }, { width:8, height:4, smoothing:false });
        try {
          const pixels = tile.getContext('2d')!.getImageData(0,0,8,4).data;
          const expected = [];
          for (let i = 0; i < decoded.length; i += 4) {
            const value = decoded[i] * 2126 + decoded[i+1] * 7152 + decoded[i+2] * 722;
            const alpha = channel === 'alpha' ? (invert ? 255-decoded[i+3] : decoded[i+3]) :
              Math.floor((decoded[i+3] * (invert ? value : 2550000-value) + 1275000) / 2550000);
            expected.push(...(alpha ? [255,255,255,alpha] : [0,0,0,0]));
          }
          cases.push({ channel, invert, equal: JSON.stringify([...pixels]) === JSON.stringify(expected) });
        } finally { tile.width = tile.height = 0; }
      }
      const original = [...new Uint8Array(await blob.arrayBuffer())];
      return { cases, sourceEqual: JSON.stringify(original) === JSON.stringify([...new Uint8Array(await asset.blob.arrayBuffer())]),
        width:asset.bitmap.width,height:asset.bitmap.height,cacheBytes:sampler.byteLength };
    } finally { source.width=source.height=0; sampler.dispose(); processor.dispose(); assets.dispose(); }
  });
  expect(result.cases).toHaveLength(4);
  expect(result.cases.every(value => value.equal)).toBe(true);
  expect(result).toMatchObject({ sourceEqual:true,width:8,height:4 });
  expect(result.cacheBytes).toBeGreaterThan(0);
});

test('texture cache keys include bitmap identity, native crop, sampling grid and options; returned surfaces own their pixels', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { BrushTextureSampler } = await import(/* @vite-ignore */ String('/src/engine/brush-texture.ts'));
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const { AssetStore } = await import(/* @vite-ignore */ String('/src/core/assets.ts'));
    const processor = new PixelProcessor(), stores = [new AssetStore(),new AssetStore()];
    let conversions = 0;
    const sampler = new BrushTextureSampler({ brushTexture: (...args: Parameters<import('../src/engine/processor').PixelProcessor['brushTexture']>) => {
      conversions++; return processor.brushTexture(...args);
    }});
    const canvas = document.createElement('canvas'); canvas.width=8;canvas.height=4;
    const context = canvas.getContext('2d')!;
    for (const [index, store] of stores.entries()) {
      context.fillStyle=index?'#ffffff':'#000000';context.fillRect(0,0,8,4);
      if(!index){context.fillStyle='#ffffff';context.fillRect(4,0,4,4);}
      const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));
      await store.add(blob,'Shared ID','same',false);
    }
    const outputs:HTMLCanvasElement[]=[];
    const read=(tile:HTMLCanvasElement)=>[...tile.getContext('2d')!.getImageData(0,0,tile.width,tile.height).data];
    const prepare=async(store=stores[0],source={},sample={})=>{
      const tile=await sampler.prepare(store,{assetId:'same',...source},{width:8,height:4,...sample});outputs.push(tile);return tile;
    };
    try {
      const first=await prepare(),expected=read(first);
      first.getContext('2d')!.clearRect(0,0,8,4);
      const second=await prepare(),cached=conversions===1&&JSON.stringify(read(second))===JSON.stringify(expected);
      await prepare(stores[1]); const scoped=conversions===2;
      const right=await prepare(stores[0],{},{sourceRect:{x:4,y:0,width:4,height:4}});
      // Native smooth sampling may include a neighboring source texel at the crop edge.
      context.clearRect(0,0,8,4);context.drawImage(stores[0].get('same').bitmap,4,0,4,4,0,0,8,4);
      const reference=context.getImageData(0,0,8,4).data,actual=read(right);
      const crop=Array.from({length:32},(_,i)=>{
        const p=i*4,value=reference[p]*2126+reference[p+1]*7152+reference[p+2]*722;
        return actual[p+3]===Math.floor((reference[p+3]*(2550000-value)+1275000)/2550000);
      }).every(Boolean);
      await prepare(stores[0],{channel:'alpha'});
      await prepare(stores[0],{invert:true});
      await prepare(stores[0],{},{width:4});
      await prepare(stores[0],{},{smoothing:false});
      const allKeys=conversions===7;
      sampler.clear();
      const retained=JSON.stringify(read(second))===JSON.stringify(expected),empty=sampler.byteLength===0;
      await prepare();
      sampler.dispose();
      return {cached,scoped,crop,allKeys,retained,empty,convertedAgain:conversions===8,
        sourceAlive:stores[0].get('same').bitmap.width===8,afterDispose:sampler.byteLength};
    } finally { for(const tile of outputs)tile.width=tile.height=0;canvas.width=canvas.height=0;sampler.dispose();processor.dispose();stores.forEach(store=>store.dispose()); }
  });
  expect(result).toEqual({cached:true,scoped:true,crop:true,allKeys:true,retained:true,empty:true,convertedAgain:true,sourceAlive:true,afterDispose:0});
});

test('bounded texture caches evict and allocation failure releases a private copy while preserving valid caller output', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { BrushTextureSampler } = await import(/* @vite-ignore */ String('/src/engine/brush-texture.ts'));
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const { AssetStore } = await import(/* @vite-ignore */ String('/src/core/assets.ts'));
    const assets=new AssetStore(),processor=new PixelProcessor(),canvas=document.createElement('canvas');canvas.width=canvas.height=8;
    const context=canvas.getContext('2d')!;context.fillRect(0,0,8,8);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));await assets.add(blob,'Black','tip',false);
    let conversions=0;const sampler=new BrushTextureSampler({brushTexture:(...args:Parameters<import('../src/engine/processor').PixelProcessor['brushTexture']>)=>{conversions++;return processor.brushTexture(...args);}},600);
    const outputs:HTMLCanvasElement[]=[],allocated:HTMLCanvasElement[]=[];
    const originalDraw=CanvasRenderingContext2D.prototype.drawImage;
    try {
      for(const invert of [false,true,false]){const tile=await sampler.prepare(assets,{assetId:'tip',invert},{width:8,height:8});outputs.push(tile);}
      const evicted=conversions===3&&sampler.byteLength<=600;
      sampler.clear();
      CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,...args:Parameters<CanvasRenderingContext2D['drawImage']>){
        if(args[0] instanceof HTMLCanvasElement){allocated.push(this.canvas);throw new Error('Injected cache-copy allocation failure');}
        return originalDraw.apply(this,args);
      } as CanvasRenderingContext2D['drawImage'];
      const tile=await sampler.prepare(assets,{assetId:'tip'},{width:8,height:8});outputs.push(tile);
      const output=[...tile.getContext('2d')!.getImageData(4,4,1,1).data];
      return {evicted,cacheCopyReleased:allocated.length===1&&allocated[0].width===0&&allocated[0].height===0,
        output,cacheBytes:sampler.byteLength,sourceAlive:assets.get('tip').bitmap.width===8};
    } finally {CanvasRenderingContext2D.prototype.drawImage=originalDraw;outputs.forEach(tile=>tile.width=tile.height=0);canvas.width=canvas.height=0;sampler.dispose();processor.dispose();assets.dispose();}
  });
  expect(result).toEqual({evicted:true,cacheCopyReleased:true,output:[255,255,255,255],cacheBytes:0,sourceAlive:true});
});

for (const action of ['abort','cancel','clear','dispose','remove-source','replace-source','dispose-store'] as const)
  test(`pending actual texture conversion rejects ${action} and releases its unpublished working surface`, async ({ page }, info) => {
    await page.goto('/');
    const result = await page.evaluate(async action => {
      const { BrushTextureSampler } = await import(/* @vite-ignore */ String('/src/engine/brush-texture.ts'));
      const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
      const { AssetStore } = await import(/* @vite-ignore */ String('/src/core/assets.ts'));
      const assets=new AssetStore(),processor=new PixelProcessor(),abort=new AbortController();
      const source=document.createElement('canvas');source.width=source.height=8;source.getContext('2d')!.fillRect(0,0,8,8);
      const blob=await new Promise<Blob>(resolve=>source.toBlob(value=>resolve(value!)));await assets.add(blob,'Tip','tip',false);source.width=source.height=0;
      let enter!:()=>void,unblock!:()=>void,cancelled=false;
      const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>unblock=resolve);
      const sampler=new BrushTextureSampler({brushTexture:async(...args:Parameters<import('../src/engine/processor').PixelProcessor['brushTexture']>)=>{
        const converted=await processor.brushTexture(...args);enter();await gate;return converted;
      }});
      const created:HTMLCanvasElement[]=[],original=document.createElement;
      document.createElement=function(...args:Parameters<Document['createElement']>){const element=original.apply(document,args);if(element instanceof HTMLCanvasElement)created.push(element);return element;} as Document['createElement'];
      try{
        const pending=sampler.prepare(assets,{assetId:'tip'},{width:8,height:8},{signal:abort.signal,isCancelled:()=>cancelled});
        await entered;
        if(action==='abort')abort.abort();else if(action==='cancel')cancelled=true;else if(action==='clear')sampler.clear();
        else if(action==='dispose')sampler.dispose();else if(action==='remove-source')assets.remove('tip');
        else if(action==='replace-source'){assets.remove('tip');await assets.add(blob,'Replacement tip','tip',false);}else assets.dispose();
        unblock();let error='';try{await pending;}catch(reason){error=String(reason);}
        return{error,cacheBytes:sampler.byteLength,createdCount:created.length,released:created.every(canvas=>canvas.width===0&&canvas.height===0)};
      }finally{document.createElement=original;unblock();sampler.dispose();processor.dispose();assets.dispose();}
    },action);
    expect(result.error).not.toBe('');expect(result.cacheBytes).toBe(0);expect(result.released).toBe(true);
    // Replacing an asset also creates and releases its ordinary thumbnail canvas.
    expect(result.createdCount).toBe(action==='replace-source'?2:1);
    await info.attach(`texture-cancellation-${action}`,{body:JSON.stringify(result),contentType:'application/json'});
  });

test('invalid sampling, malformed worker coverage and pre-aborted requests leave assets and working allocations intact', async ({ page }) => {
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));
    const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'));
    const assets=new AssetStore(),source=document.createElement('canvas');source.width=source.height=8;
    const blob=await new Promise<Blob>(resolve=>source.toBlob(value=>resolve(value!)));await assets.add(blob,'Tip','tip',false);source.width=source.height=0;
    let calls=0;const sampler=new BrushTextureSampler({brushTexture:async()=>{calls++;return new Uint8ClampedArray(3);}}),created:HTMLCanvasElement[]=[];
    const original=document.createElement,abort=new AbortController();abort.abort();
    document.createElement=function(...args:Parameters<Document['createElement']>){const element=original.apply(document,args);if(element instanceof HTMLCanvasElement)created.push(element);return element;} as Document['createElement'];
    try{
      const errors=[];
      for(const sample of [{width:4096,height:4096},{width:1,height:1,sourceRect:{x:7,y:0,width:2,height:1}}])
        try{await sampler.prepare(assets,{assetId:'tip'},sample);}catch(error){errors.push(String(error));}
      try{await sampler.prepare(assets,{assetId:'tip'},{width:8,height:8},{signal:abort.signal});}catch(error){errors.push(String(error));}
      const noAllocation=created.length===0;
      try{await sampler.prepare(assets,{assetId:'tip'},{width:8,height:8});}catch(error){errors.push(String(error));}
      return{errors,noAllocation,calls,released:created.length===1&&created[0].width===0,cacheBytes:sampler.byteLength,sourceAlive:assets.get('tip').bitmap.width===8};
    }finally{document.createElement=original;sampler.dispose();assets.dispose();}
  });
  expect(result.errors).toHaveLength(4);expect(result.errors[3]).toContain('invalid coverage');
  expect(result).toMatchObject({noAllocation:true,calls:1,released:true,cacheBytes:0,sourceAlive:true});
});

test('actual 50 MP source yields native crop and whole-source proxy masks without full-image working canvases or source/project changes', async ({page},info)=>{
  test.setTimeout(240000);await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('tests/fixtures/psd/native-50mp.png');
  await expect(page.locator('.layer-row')).toHaveCount(1,{timeout:120000});
  const result=await page.evaluate(async()=>{
    const {BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));
    const {PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts'));
    const {editor,RasterLayer}=window.luma,layer=editor.document.layers.at(0);
    if(!(layer instanceof RasterLayer))throw new Error('Missing 50 MP image');
    const asset=editor.assetStore.get(layer.assetId),processor=new PixelProcessor(),sampler=new BrushTextureSampler(processor);
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('');
    const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,sourceHash=await hash(asset.blob);
    const created:HTMLCanvasElement[]=[],original=document.createElement;
    document.createElement=function(...args:Parameters<Document['createElement']>){const element=original.apply(document,args);if(element instanceof HTMLCanvasElement)created.push(element);return element;} as Document['createElement'];
    const tiles:HTMLCanvasElement[]=[];
    try{
      const rect={x:9800,y:4900,width:128,height:64};
      const crop=await sampler.prepare(editor.assetStore,{assetId:asset.id,channel:'luminance'},{width:128,height:64,sourceRect:rect,smoothing:false});tiles.push(crop);
      const native=document.createElement('canvas');native.width=128;native.height=64;tiles.push(native);
      const context=native.getContext('2d')!;context.imageSmoothingEnabled=false;context.drawImage(asset.bitmap,rect.x,rect.y,128,64,0,0,128,64);
      const source=context.getImageData(0,0,128,64).data,actual=crop.getContext('2d')!.getImageData(0,0,128,64).data;
      let matches=true;for(let i=0;i<source.length;i+=4){const weighted=source[i]*2126+source[i+1]*7152+source[i+2]*722;const alpha=Math.floor((source[i+3]*(2550000-weighted)+1275000)/2550000);if(actual[i+3]!==alpha)matches=false;}
      const proxy=await sampler.prepare(editor.assetStore,{assetId:asset.id,channel:'alpha'},{width:200,height:100});tiles.push(proxy);
      const proxyPixels:Uint8ClampedArray=proxy.getContext('2d')!.getImageData(0,0,200,100).data;
      const proxyOpaque=proxyPixels.filter((_,i)=>i%4===3).every(value=>value===255);
      const shapes=created.map(canvas=>({width:canvas.width,height:canvas.height}));
      document.createElement=original;
      const unchanged=before===JSON.stringify(editor.document.toJSON())&&revision===editor.document.getSnapshot().revision;
      const project=await editor.saveProject();await editor.openProject(new File([project],'texture-source-50mp.luma'));
      const restored=editor.document.layers.at(0);if(!(restored instanceof RasterLayer))throw new Error('Missing restored 50 MP source');
      const reopened=editor.assetStore.get(restored.assetId);
      return{matches,proxyOpaque,unchanged,sourceHash,reopenedHash:await hash(reopened.blob),sameProject:before===JSON.stringify(editor.document.toJSON()),
        width:reopened.bitmap.width,height:reopened.bitmap.height,shapes,cacheBytes:sampler.byteLength};
    }finally{document.createElement=original;tiles.forEach(tile=>tile.width=tile.height=0);sampler.dispose();processor.dispose();}
  });
  expect(result).toMatchObject({matches:true,proxyOpaque:true,unchanged:true,sameProject:true,width:10000,height:5000});
  expect(result.sourceHash).toBe(createHash('sha256').update(await readFile('tests/fixtures/psd/native-50mp.png')).digest('hex'));
  expect(result.reopenedHash).toBe(result.sourceHash);
  expect(result.shapes.length).toBeGreaterThanOrEqual(5);
  expect(result.shapes.every(shape=>shape.width<=200&&shape.height<=100)).toBe(true);
  await info.attach('texture-source-native-50mp',{body:JSON.stringify(result),contentType:'application/json'});
});
