import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fontRelinkWorkflow} from './helpers/font-relink';
import {openFontManager} from './helpers/font-management';

test('font relinking preserves original bytes, native output, one-step undo and reopened projects',async({page},info)=>fontRelinkWorkflow(page,info));

test('the trusted relink guide runs against the actual host and retained sources',async({page})=>{
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.match(/<!-- example: font-relink-trusted -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(code).toBeTruthy();
  const inputs={code:code!,original:(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64'),replacement:(await readFile('tests/fixtures/fonts/Bold.ttf')).toString('base64')};
  await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async({code,original,replacement})=>{
    const editor=window.luma.editor,blob=(value:string)=>new Blob([Uint8Array.from(atob(value),v=>v.charCodeAt(0))]);await editor.document.fonts.embed(blob(original),{name:'Guide face'});
    const run=new Function('editor','fontSource','return(async()=>{'+code+'})()'),value=await run(editor,blob(replacement));return{...value,sources:editor.assetStore.fonts.size};
  },inputs);
  expect(result).toMatchObject({name:'Guide face',fullName:'Canoli Source Bold',oldAttached:false,sources:2});expect(result.id).toMatch(/^[a-f0-9]{64}$/);
});

test('rejected and concurrent native imports release only their own staged sources',async({page})=>{
  const encoded=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async encoded=>{
    const{editor,TextLayer}=window.luma,source=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),text=editor.document.layers.add(new TextLayer({text:'Locked',fontFamily:'serif',locked:true}));let locked='';
    try{await editor.document.fonts.embed(source,{replace:'serif'});}catch(error){locked=String(error);}const failedPool=editor.assetStore.fonts.size,failedNative=[...document.fonts].filter(face=>face.family.startsWith('CanoliFont_')).length;text.locked=false;
    const abort=new AbortController(),a=editor.document.fonts.embed(source,{}, {signal:abort.signal,beforeCommit(){abort.abort(new Error('Cancelled first importer.'));}}),b=editor.document.fonts.embed(source),results=await Promise.allSettled([a,b]);
    const font=editor.document.fonts.files.items[0],id=font.id; font.remove();for(let index=0;index<65;index++)editor.document.name='Trimmed '+index;
    return{locked,failedPool,failedNative,results:results.map(value=>value.status),files:editor.document.fonts.files.length,remaining:editor.assetStore.fonts.has(id),native:[...document.fonts].filter(face=>face.family.startsWith('CanoliFont_')).length};
  },encoded);
  expect(result.locked).toContain('Unlock');expect(result.failedPool).toBe(0);expect(result.failedNative).toBe(0);expect(result.results).toEqual(['rejected','fulfilled']);expect(result.files).toBe(0);expect(result.remaining).toBe(false);expect(result.native).toBe(0);
});

test('active exports retain font sources through live model edits and history collection',async({page})=>{
  const encoded=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const results=await page.evaluate(async encoded=>{
    const{editor,TextLayer}=window.luma,source=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),results=[];
    const digest=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');
    for(const format of ['png','jpeg','webp','svg','tiff','pdf','psd','psb','avif']as const){
      const doc=editor.newDocument({name:'Leased '+format,width:180,height:80}),font=await doc.fonts.embed(source),id=font.id;doc.layers.add(new TextLayer({text:'AAAA',fontFamily:font.family,fontSize:30,x:8,y:8}));
      const assets=editor.assetStore,expected=await digest((await editor.export({format})).blob);let edited=false,retained=false;
      const actual=await editor.export({format},{onProgress(){if(edited)return;edited=true;font.remove({replaceWith:'serif'});for(let index=0;index<65;index++)doc.name='Captured '+index;retained=assets.fonts.has(id);}});
      results.push({format,equal:await digest(actual.blob)===expected,edited,retained,collected:!assets.fonts.has(id)});
      await editor.closeDocument(doc,{discardChanges:true});
    }
    return results;
  },encoded);
  expect(results).toHaveLength(9);expect(results.every(value=>value.edited&&value.retained&&value.equal&&value.collected),JSON.stringify(results)).toBe(true);
});

test('export cancellation and throwing callbacks release captured fonts in every format',async({page})=>{
  const encoded=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const results=await page.evaluate(async encoded=>{
    const{editor,TextLayer}=window.luma,source=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),results=[];
    for(const format of ['png','jpeg','webp','svg','tiff','pdf','psd','psb','avif']as const)for(const mode of ['abort','throw']){
      const doc=editor.newDocument({name:'Rejected '+format,width:180,height:80}),font=await doc.fonts.embed(source),id=font.id,assets=editor.assetStore,abort=new AbortController();doc.layers.add(new TextLayer({text:'AAAA',fontFamily:font.family,fontSize:30}));let edited=false,retained=false,error='';
      try{await editor.export({format},{signal:abort.signal,onProgress(){if(edited)return;edited=true;font.remove({replaceWith:'serif'});for(let index=0;index<65;index++)doc.name='Expired '+index;retained=assets.fonts.has(id);const reason=new Error('Expected export '+mode);if(mode==='abort')abort.abort(reason);else throw reason;}});}catch(cause){error=String(cause);}
      results.push({format,mode,edited,retained,collected:!assets.fonts.has(id),expectedError:error.includes('Expected export '+mode)});await editor.closeDocument(doc,{discardChanges:true});
    }
    return results;
  },encoded);
  expect(results).toHaveLength(18);expect(results.every(value=>value.edited&&value.retained&&value.collected&&value.expectedError),JSON.stringify(results)).toBe(true);
});

test('retained wet replay releases font sources on finish, failure and idle abort while output stays readable',async({page})=>{
  const encoded=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const results=await page.evaluate(async encoded=>{
    const{createDocumentWetStrokeSession,prepareDocumentWetStroke}=await import(/* @vite-ignore */ String('/src/engine/wet-document.ts'));
    const{editor,TextLayer,PencilStroke}=window.luma,source=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),results=[];
    const read=async(output:any)=>{const out:Record<string,number[]>={};for await(const tile of output.tiles())for(let y=0;y<tile.region.height;y++)for(let x=0;x<tile.region.width;x++)if(tile.changed[y*tile.region.width+x])out[`${tile.region.x+x},${tile.region.y+y}`]=[...tile.pixels.slice((y*tile.region.width+x)*4,(y*tile.region.width+x+1)*4)];return out;};
    for(const mode of ['finish','failure','abort']){
      const doc=editor.newDocument({name:'Wet font '+mode,width:180,height:80}),font=await doc.fonts.embed(source),id=font.id,assets=editor.assetStore,abort=new AbortController();doc.layers.add(new TextLayer({text:'AAAA',fontFamily:font.family,fontSize:40,x:8,y:8}));
      const points=[{x:25.5,y:25.5,pressure:1},{x:35.5,y:25.5,pressure:1},{x:45.5,y:25.5,pressure:1}],stroke=new PencilStroke({size:5,pressureSize:false,points}).toJSON(),snapshot=doc.toJSON(),options={tileSize:16,cacheBytes:0,mix:{pickup:0}},reference=await prepareDocumentWetStroke(snapshot,assets,editor.renderer,editor.renderer.processor,stroke,{mode:'all-layers'},options);let fail=false;
      const session=await createDocumentWetStrokeSession(snapshot,assets,editor.renderer,editor.renderer.processor,{...stroke,points:points.slice(0,1)},{mode:'all-layers'},{...options,signal:abort.signal,onProgress(){if(fail)throw new Error('Expected wet failure');}});
      font.remove({replaceWith:'serif'});for(let index=0;index<65;index++)doc.name='Wet captured '+index;const retained=assets.fonts.has(id);let equal=true,error='',changed=0,output:any;
      try{
        if(mode==='finish'){await session.append(points.slice(1));output=await session.finish();const actual=await read(output),expected=await read(reference),keys=Object.keys(expected).sort();changed=keys.length;equal=JSON.stringify(Object.keys(actual).sort())===JSON.stringify(keys)&&keys.every(key=>JSON.stringify(actual[key])===JSON.stringify(expected[key]));}
        else if(mode==='failure'){fail=true;try{await session.append(points.slice(1));}catch(cause){error=String(cause);}}
        else{abort.abort(new Error('Expected wet abort'));await new Promise(resolve=>setTimeout(resolve,20));try{await session.append(points.slice(1));}catch(cause){error=String(cause);}}
        results.push({mode,retained,collected:!assets.fonts.has(id),equal,changed,error});
      }finally{await session.dispose();await reference.dispose();await output?.dispose();await editor.closeDocument(doc,{discardChanges:true});}
    }
    return results;
  },encoded);
  expect(results.every(value=>value.retained&&value.collected&&value.equal),JSON.stringify(results)).toBe(true);expect(results[0].changed).toBeGreaterThan(0);expect(results[1].error).toContain('Expected wet failure');expect(results[2].error).toContain('Expected wet abort');
});

test('font relinking keeps long names and actions reachable in light and dark laptop dialogs',async({page},info)=>{
  const encoded=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64'),name='Long embedded source label '.repeat(8).trim();await page.setViewportSize({width:1280,height:720});await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(async({encoded,name})=>{await window.luma.editor.document.fonts.embed(new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),{name});},{encoded,name});
  for(const appearance of ['light','dark']){
    await page.evaluate(value=>window.dispatchEvent(new CustomEvent('luma:set-appearance',{detail:value})),appearance);const dialog=await openFontManager(page);await dialog.getByRole('button',{name:'Choose replacement for '+name,exact:true}).click();await dialog.getByTestId('font-source-input').setInputFiles('tests/fixtures/fonts/Bold.ttf');const action=dialog.getByRole('button',{name:'Relink selected face',exact:true});await expect(action).toBeEnabled();await action.scrollIntoViewIfNeeded();const box=await action.boundingBox();expect(box&&box.x>=0&&box.y>=0&&box.x+box.width<=1280&&box.y+box.height<=720).toBe(true);expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('font-relink-laptop-'+appearance+'.png')});await dialog.getByRole('button',{name:'Cancel font relinking',exact:true}).click();await dialog.getByRole('button',{name:'Done',exact:true}).click();
  }
});

test('native branch, comparison and component-view owners keep fonts until their last reference ends',async({page})=>{
  const encoded=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const results=await page.evaluate(async encoded=>{
    const{editor,Document,TextLayer}=window.luma,source=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),results=[];
    for(const mode of ['branch','comparison','component-view']){
      const doc=editor.newDocument({name:'Native owner '+mode,width:180,height:80}),assets=editor.assetStore,empty=mode==='branch'?doc.createHistoryBranch('Empty'):undefined,fontRoute=mode==='branch'?doc.createHistoryBranch('Font route'):undefined,position=doc.getSnapshot().past.length,font=await doc.fonts.embed(source),id=font.id,family=font.family;
      const comparison=mode==='comparison'?doc.createHistoryComparison('Font reference',{kind:'timeline',position},{kind:'current'}):undefined;
      let view:InstanceType<typeof Document>|undefined,before='',after='';
      const hash=async()=>{const canvas=await editor.renderer.render(view!.toJSON(),assets,{cache:false,readback:true});try{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data))].join(',');}finally{canvas.width=canvas.height=1;}};
      if(mode==='component-view'){const master=new Document({width:180,height:80});master.layers.add(new TextLayer({text:'AAAA',fontFamily:family,fontSize:40,x:8,y:8}));view=doc.getComponent(doc.defineComponent(master));before=await hash();}
      if(empty)doc.checkoutHistoryBranch(empty);else font.remove({replaceWith:'serif'});for(let index=0;index<65;index++)doc.name='Owner trimmed '+index;
      const retained=assets.fonts.has(id),nativeBefore=[...document.fonts].filter(face=>face.family===family).length;
      if(fontRoute)doc.deleteHistoryBranch(fontRoute);if(comparison)doc.deleteHistoryComparison(comparison);if(view){after=await hash();view.assetStore=null;}
      results.push({mode,retained,nativeBefore,collected:!assets.fonts.has(id),nativeAfter:[...document.fonts].filter(face=>face.family===family).length,pixelsEqual:before===after});await editor.closeDocument(doc,{discardChanges:true});
    }
    return results;
  },encoded);
  expect(results).toEqual(['branch','comparison','component-view'].map(mode=>({mode,retained:true,nativeBefore:1,collected:true,nativeAfter:0,pixelsEqual:true})));
});
