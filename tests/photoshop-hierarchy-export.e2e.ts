import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

for(const [mode,key] of Object.entries({normal:'norm',multiply:'mul',screen:'scrn',overlay:'over',darken:'dark',lighten:'lite','color-dodge':'div','color-burn':'idiv','hard-light':'hLit','soft-light':'sLit',difference:'diff',exclusion:'smud',hue:'hue',saturation:'sat',color:'colr',luminosity:'lum'}))
test(`native Photoshop folder blend ${mode} retains mode, folded fill, mask and independent composition`,async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async mode=>{
  const {editor,LayerGroup,RasterLayer,LayerMask,MarqueeSelection}=window.luma;editor.newDocument({width:32,height:24});
  const image=async(foreground:boolean)=>{const c=document.createElement('canvas');c.width=32;c.height=24;const context=c.getContext('2d')!;
   for(let y=0;y<24;y++)for(let x=0;x<32;x++){context.fillStyle=`rgb(${foreground?32+x*5:40+y*6},${foreground?180-y*4:32+x*5},${foreground?48+y*6:180-x*3})`;context.fillRect(x,y,1,1);}
   const blob=await new Promise<Blob>(resolve=>c.toBlob(value=>resolve(value!)));c.width=c.height=0;return editor.assetStore.add(blob,'Color grid');};
  const base=await image(false),content=await image(true);editor.document.layers.add(new RasterLayer({name:'Backdrop',assetId:base.id,width:32,height:24}));
  const group=editor.document.layers.add(new LayerGroup({name:'Blend',blendMode:mode as import('../src/core/model').BlendMode,opacity:128/255,fillOpacity:128/255}));group.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:4,y:4,width:24,height:16})});group.layers.add(new RasterLayer({name:'Grid',assetId:content.id,width:32,height:24}));
  const before=JSON.stringify(editor.document.toJSON()),outputs:Record<string,string>={};outputs.png=btoa(String.fromCharCode(...new Uint8Array(await(await editor.exportPng()).arrayBuffer())));
  for(const format of ['psd','psb'] as const)outputs[format]=btoa(String.fromCharCode(...new Uint8Array(await(await editor.export({format})).blob.arrayBuffer())));
  return{outputs,unchanged:before===JSON.stringify(editor.document.toJSON())};
 },mode);expect(result.unchanged).toBe(true);
 const common={visible:true,opacity:255,fill:255,blend:'norm',locked:false,maskEnabled:null},expectedTree=[{...common,name:'Backdrop',kind:'pixel'},{...common,name:'Blend',kind:'group',opacity:64,blend:key,maskEnabled:true,children:[{...common,name:'Grid',kind:'pixel'}]}];
 const reference=info.outputPath('native.png');await writeFile(reference,Buffer.from(result.outputs.png,'base64'));const cases=[];
 for(const format of ['psd','psb']){const path=info.outputPath(`blend.${format}`);await writeFile(path,Buffer.from(result.outputs[format],'base64'));cases.push({path,format,reference,expectedTree});}
 const manifest=info.outputPath('independent.json');await writeFile(manifest,JSON.stringify(cases));const checked=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['scripts/check-photoshop-hierarchy.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 await info.attach('photoshop-native-folder-blend',{body:JSON.stringify({mode,independent:JSON.parse(checked.stdout)}),contentType:'application/json'});
});

const fixtures=['normal','multiply-group','pass','pass-opacity','normal-opacity','pass-mask','pass-opacity-mask','normal-mask','hidden','locked','alpha-locked','wide-psb','native-50mp-group'];
for(const fixture of fixtures)test(`native Photoshop folders ${fixture} retain independent records, masks and pixels`,async({page},info)=>{
 test.setTimeout(240000);const extension=fixture==='wide-psb'?'psb':'psd',input=`tests/fixtures/psd/groups/${fixture}.${extension}`;
 await page.goto('/');
 const result=await page.evaluate(async({fixture,extension})=>{
  const {editor}=window.luma;const file=await fetch(`/tests/fixtures/psd/groups/${fixture}.${extension}`).then(r=>r.blob());await editor.openPsd(file,{mode:'layered'});
  const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;
  const hashes=async()=>JSON.stringify(await Promise.all(editor.assetStore.values().map(async asset=>[asset.id,[...new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer()))]])));
  const sources=await hashes(),outputs:Record<string,Blob>={};
  const formats=fixture==='wide-psb'||fixture==='native-50mp-group'?['psb'] as const:['psd','psb'] as const;
  for(const format of formats)outputs[format]=(await editor.export({format})).blob;
  (window as unknown as {hierarchyOutputs:Record<string,Blob>}).hierarchyOutputs=outputs;
  return{sameModel:before===JSON.stringify(editor.document.toJSON()),sameRevision:revision===editor.document.getSnapshot().revision,sameSources:sources===await hashes(),formats};
 },{fixture,extension});expect(result.sameModel).toBe(true);expect(result.sameRevision).toBe(true);expect(result.sameSources).toBe(true);
 const cases=[];
 for(const format of result.formats){
  const pending=page.waitForEvent('download');await page.evaluate(format=>{const blob=(window as unknown as {hierarchyOutputs:Record<string,Blob>}).hierarchyOutputs[format],url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`hierarchy.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);},format);
  const path=info.outputPath(`hierarchy.${format}`);await(await pending).saveAs(path);cases.push({path,format,source:input,reference:`tests/fixtures/psd/groups/${fixture}.png`,large:fixture==='native-50mp-group'});
 }
 const manifest=info.outputPath('independent.json');await writeFile(manifest,JSON.stringify(cases));
 const checked=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['scripts/check-photoshop-hierarchy.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 await info.attach('photoshop-native-hierarchy',{body:JSON.stringify({fixture,runtime:result,independent:JSON.parse(checked.stdout)}),contentType:'application/json'});
});

for(const fixture of ['white-zip','relative-prediction','disabled-rle','density-zip'])
test(`editable Photoshop user mask ${fixture} keeps source planes and native appearance`,async({page},info)=>{
 await page.goto('/');const input=`tests/fixtures/psd/masks/${fixture}.psd`;
 const result=await page.evaluate(async fixture=>{
  const {editor}=window.luma;await editor.openPsd(await fetch(`/tests/fixtures/psd/masks/${fixture}.psd`).then(r=>r.blob()),{mode:'layered'});
  const before=JSON.stringify(editor.document.toJSON()),outputs:Record<string,string>={};
  for(const format of ['psd','psb'] as const)outputs[format]=btoa(String.fromCharCode(...new Uint8Array(await(await editor.export({format})).blob.arrayBuffer())));
  return{outputs,sameModel:before===JSON.stringify(editor.document.toJSON())};
 },fixture);expect(result.sameModel).toBe(true);
 const cases=[];for(const format of ['psd','psb']){const path=info.outputPath(`mask.${format}`);await writeFile(path,Buffer.from(result.outputs[format],'base64'));cases.push({path,format,source:input,reference:`tests/fixtures/psd/masks/${fixture}.png`});}
 const manifest=info.outputPath('independent.json');await writeFile(manifest,JSON.stringify(cases));const checked=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['scripts/check-photoshop-hierarchy.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 await info.attach('photoshop-native-user-masks',{body:checked.stdout,contentType:'application/json'});
});

for(const mode of ['fill','layer-fill','non-normal-fill','disabled-mask','linked-mask','unlinked-mask','translucent'] as const)
test(`native Photoshop ${mode} represents current transparency and editable coverage`,async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async mode=>{
  const {editor,LayerGroup,RasterLayer,LayerMask,MarqueeSelection,AffineTransform}=window.luma;editor.newDocument({width:32,height:24});
  const image=async(color:string,alpha:number)=>{const c=document.createElement('canvas');c.width=32;c.height=24;const context=c.getContext('2d')!;context.globalAlpha=alpha;context.fillStyle=color;context.fillRect(0,0,32,24);const blob=await new Promise<Blob>(resolve=>c.toBlob(value=>resolve(value!)));c.width=c.height=0;return editor.assetStore.add(blob,color);};
  const base=await image(mode==='translucent'?'#0000ff':mode==='non-normal-fill'?'#804020':'#ff0000',mode==='translucent'?128/255:1),green=await image(mode==='non-normal-fill'?'#408020':'#00ff00',mode==='translucent'?128/255:1);
  editor.document.layers.add(new RasterLayer({name:'Backdrop',assetId:base.id,width:32,height:24}));const group=editor.document.layers.add(new LayerGroup({name:'Native Ω',blendMode:mode==='non-normal-fill'?'pass-through':'normal',opacity:mode==='layer-fill'||mode==='non-normal-fill'?1:128/255,fillOpacity:mode==='fill'||mode==='disabled-mask'?128/255:1})),leaf=group.layers.add(new RasterLayer({name:'Green',assetId:green.id,width:32,height:24,blendMode:mode==='non-normal-fill'?'color-dodge':'normal',opacity:mode==='layer-fill'||mode==='non-normal-fill'?128/255:1,fillOpacity:mode==='layer-fill'||mode==='non-normal-fill'?128/255:1}));
  if(mode==='linked-mask'||mode==='unlinked-mask')group.transform=new AffineTransform(1,.2,.1,1,4,3);
  if(mode!=='fill'&&mode!=='layer-fill'&&mode!=='non-normal-fill')group.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:8,y:4,width:16,height:16}),density:mode==='disabled-mask'?128/255:1,feather:mode==='disabled-mask'?1:0,inverted:mode==='disabled-mask',enabled:mode!=='disabled-mask',linked:mode!=='unlinked-mask'});
  if(mode==='non-normal-fill')leaf.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:8,y:4,width:16,height:16})});
  const before=JSON.stringify(editor.document.toJSON()),outputs:Record<string,string>={},png=await editor.exportPng();outputs.png=btoa(String.fromCharCode(...new Uint8Array(await png.arrayBuffer())));
  const bitmap=await createImageBitmap(png),canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;const c=canvas.getContext('2d')!;c.drawImage(bitmap,0,0);const sample=[...c.getImageData(mode==='translucent'||mode==='non-normal-fill'?16:0,mode==='translucent'||mode==='non-normal-fill'?12:0,1,1).data];bitmap.close();canvas.width=canvas.height=0;
  for(const format of ['psd','psb'] as const)outputs[format]=btoa(String.fromCharCode(...new Uint8Array(await(await editor.export({format})).blob.arrayBuffer())));
  return{outputs,sameModel:before===JSON.stringify(editor.document.toJSON()),sample};
 },mode);expect(result.sameModel).toBe(true);
 if(mode==='fill'||mode==='layer-fill'||mode==='disabled-mask')expect(result.sample).toEqual([191,64,0,255]);
 if(mode==='non-normal-fill')expect(result.sample).not.toEqual([128,64,32,255]);
 if(mode==='translucent')expect(result.sample).toEqual([0,102,153,160]);
 const reference=info.outputPath('native.png');await writeFile(reference,Buffer.from(result.outputs.png,'base64'));
 const common={visible:true,opacity:255,fill:255,blend:'norm',locked:false,maskEnabled:null};
 const expectedTree=[{...common,name:'Backdrop',kind:'pixel'},{...common,name:'Native Ω',kind:'group',opacity:mode==='fill'||mode==='disabled-mask'?64:mode==='layer-fill'||mode==='non-normal-fill'?255:128,fill:255,blend:mode==='non-normal-fill'?'pass':'norm',maskEnabled:mode==='fill'||mode==='layer-fill'||mode==='non-normal-fill'?null:mode!=='disabled-mask',children:[{...common,name:'Green',kind:'pixel',opacity:mode==='layer-fill'||mode==='non-normal-fill'?128:255,fill:mode==='layer-fill'?128:255,blend:mode==='non-normal-fill'?'div':'norm'}]}];
 const cases=[];for(const format of ['psd','psb']){const path=info.outputPath(`native.${format}`);await writeFile(path,Buffer.from(result.outputs[format],'base64'));cases.push({path,format,reference,expectedTree,expectedMaskExtrema:mode==='disabled-mask'?[127,255]:undefined});}
 const manifest=info.outputPath('independent.json');await writeFile(manifest,JSON.stringify(cases));const checked=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['scripts/check-photoshop-hierarchy.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 await info.attach('photoshop-native-fill-coverage',{body:checked.stdout,contentType:'application/json'});
});

for(const mode of ['isolated-adjustment','pass-adjustment','styled-group'] as const)
test(`native Photoshop ${mode} preserves the real isolation scope and reports internal baking`,async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async mode=>{
  const {editor,LayerGroup,RasterLayer,LayerMask,MarqueeSelection,LayerStyle,AdjustmentLayer}=window.luma;editor.newDocument({width:32,height:24});
  const image=async(color:string,width:number,height:number)=>{const c=document.createElement('canvas');c.width=width;c.height=height;const context=c.getContext('2d')!;context.fillStyle=color;context.fillRect(0,0,width,height);const blob=await new Promise<Blob>(resolve=>c.toBlob(value=>resolve(value!)));c.width=c.height=0;return editor.assetStore.add(blob,color);};
  const red=await image('#804020',32,24),green=await image('#408020',16,12),blue=await image('#0000ff',4,4);
  editor.document.layers.add(new RasterLayer({name:'Backdrop',assetId:red.id,width:32,height:24}));const group=editor.document.layers.add(new LayerGroup({name:'Scope',x:5,y:3,blendMode:mode==='pass-adjustment'?'pass-through':'normal',opacity:128/255,fillOpacity:mode==='styled-group'?128/255:1}));group.layers.add(new RasterLayer({name:'Green',assetId:green.id,width:16,height:12}));
  if(mode==='styled-group'){
   group.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:1,y:1,width:12,height:10}),feather:1});group.styles=new LayerStyle({dropShadow:{enabled:true,color:'#0000ff',opacity:.75,x:2,y:2,blur:1},colorOverlay:{enabled:true,color:'#20a060',opacity:.25}});group.layers.add(new RasterLayer({name:'Hidden',assetId:blue.id,width:4,height:4,visible:false}));
  }else group.layers.add(new AdjustmentLayer({name:'Tone',adjustment:{kind:'tone',exposure:1,contrast:0,saturation:0}}));
  editor.document.layers.add(new RasterLayer({name:'Top marker',assetId:blue.id,x:24,y:16,width:4,height:4}));
  const before=JSON.stringify(editor.document.toJSON()),outputs:Record<string,string>={},reports=[];outputs.png=btoa(String.fromCharCode(...new Uint8Array(await(await editor.exportPng()).arrayBuffer())));
  for(const format of ['psd','psb'] as const){const result=await editor.export({format});outputs[format]=btoa(String.fromCharCode(...new Uint8Array(await result.blob.arrayBuffer())));reports.push(result.report);}
  return{outputs,reports,unchanged:before===JSON.stringify(editor.document.toJSON())};
 },mode);expect(result.unchanged).toBe(true);
 for(const report of result.reports){
  if(mode==='isolated-adjustment')expect(report.warnings.join(' ')).toContain('group isolation scope');
  if(mode==='pass-adjustment'){expect(report.warnings.join(' ')).toContain('bottom 2 top-level layers are merged');expect(report.featuresPreserved.join(' ')).not.toContain('Nested folder hierarchy');}
  if(mode==='styled-group')expect(report.warnings.join(' ')).toContain('hidden descendants inside those contents are omitted');
 }
 const reference=info.outputPath('native.png');await writeFile(reference,Buffer.from(result.outputs.png,'base64'));const cases=[];
 for(const format of ['psd','psb']){const path=info.outputPath(`scope.${format}`);await writeFile(path,Buffer.from(result.outputs[format],'base64'));cases.push({path,format,reference});}
 const manifest=info.outputPath('independent.json');await writeFile(manifest,JSON.stringify(cases));const checked=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['scripts/check-photoshop-hierarchy.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 const independent=JSON.parse(checked.stdout);for(const value of independent.cases){
  if(mode==='pass-adjustment')expect(value.tree.map((node:{name:string})=>node.name)).toEqual(['Merged through Scope','Top marker']);
  else{expect(value.tree.map((node:{name:string})=>node.name)).toEqual(['Backdrop','Scope','Top marker']);expect(value.tree[1].children.map((node:{name:string})=>node.name)).toEqual([mode==='styled-group'?'Rendered Scope':'Merged through Tone']);}
 }
 await info.attach('photoshop-native-scope',{body:JSON.stringify({mode,reports:result.reports,independent}),contentType:'application/json'});
});

test('native 50 MP editable group mask exports every coverage sample and preserves both original sources',async({page},info)=>{
 test.setTimeout(240000);await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,LayerGroup}=window.luma;await editor.openPsd(await fetch('/tests/fixtures/psd/masks/native-50mp-mask.psd').then(r=>r.blob()),{mode:'layered'});
  const layer=editor.document.layers.at(0)!,name=layer.name,mask=layer.mask;if(!mask)throw new Error('Missing actual 50 MP source mask');
  editor.document.transaction('Group the native mask',()=>{const group=editor.document.layers.add(new LayerGroup({name:'50 MP mask'}));layer.mask=null;layer.moveTo(group);group.mask=mask;});
  const before=JSON.stringify(editor.document.toJSON()),hashes=async()=>JSON.stringify(await Promise.all(editor.assetStore.values().map(async asset=>[asset.id,[...new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer()))]]))),original=await hashes();
  (window as unknown as {hierarchyLarge:Blob}).hierarchyLarge=(await editor.export({format:'psb'})).blob;
  return{name,unchanged:before===JSON.stringify(editor.document.toJSON()),sameSources:original===await hashes(),assets:editor.assetStore.values().length};
 });expect(result.unchanged).toBe(true);expect(result.sameSources).toBe(true);expect(result.assets).toBe(2);
 const pending=page.waitForEvent('download');await page.evaluate(()=>{const url=URL.createObjectURL((window as unknown as {hierarchyLarge:Blob}).hierarchyLarge),a=document.createElement('a');a.href=url;a.download='mask.psb';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});const path=info.outputPath('mask.psb');await(await pending).saveAs(path);
 const common={visible:true,opacity:255,fill:255,blend:'norm',locked:false,maskEnabled:null};
 const manifest=info.outputPath('independent.json');await writeFile(manifest,JSON.stringify([{path,format:'psb',sourcePlanes:'tests/fixtures/psd/masks/native-50mp-mask.psd',reference:'tests/fixtures/psd/masks/native-50mp-mask.png',large:true,maskAlphaReference:true,expectedTree:[{...common,name:'50 MP mask',kind:'group',maskEnabled:true,children:[{...common,name:result.name,kind:'pixel'}]}]}]));
 const checked=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['scripts/check-photoshop-hierarchy.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 await info.attach('photoshop-native-50mp-mask',{body:JSON.stringify({runtime:result,independent:JSON.parse(checked.stdout),bytes:(await readFile(path)).length}),contentType:'application/json'});
});

test('native empty folders survive the actual export/import workers without invented image assets',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,LayerGroup,TextLayer}=window.luma;editor.newDocument({width:32,height:24});const outer=editor.document.layers.add(new LayerGroup({name:'Empty Ω',x:3,y:4,fillOpacity:.5}));outer.layers.add(new LayerGroup({name:'Nested pass',blendMode:'pass-through'}));
  const results=[];
  for(const format of ['psd','psb'] as const){
   const blob=(await editor.export({format})).blob;await editor.openPsd(blob,{mode:'layered'});
   const group=editor.document.layers.at(0);if(!(group instanceof LayerGroup))throw new Error('Empty native folder was flattened');
   const nested=group.layers.at(0);if(!(nested instanceof LayerGroup))throw new Error('Missing nested folder');
   results.push({format,assets:editor.assetStore.values().length,name:group.name,nested:nested.name,mode:nested.blendMode,fill:group.fillOpacity,opacity:group.opacity});
  }
  const group=editor.document.layers.at(0) as InstanceType<typeof LayerGroup>;group.layers.add(new TextLayer({text:'Still editable'}));return{results,child:group.layers.at(1)!.kind};
 });expect(result.child).toBe('text');for(const value of result.results)expect(value).toMatchObject({assets:0,name:'Empty Ω',nested:'Nested pass',mode:'pass-through',fill:1,opacity:128/255});
});

for(const format of ['psd','psb'] as const)for(const action of ['success','invalid-count','cancel-pending','asset-pending'] as const)
test(`native ${format} mask encoding ${action} owns its strips, releases surfaces and permits retry`,async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async({format,action})=>{
  const {editor,LayerGroup,RasterLayer,LayerMask}=window.luma;editor.newDocument({width:2081,height:140});
  const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const c=canvas.getContext('2d')!;c.fillStyle='#20a060';c.fillRect(0,0,16,16);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));canvas.width=canvas.height=0;
  const image=await editor.assetStore.add(blob,'Image'),mask=await editor.assetStore.add(blob,'Mask');const group=editor.document.layers.add(new LayerGroup({blendMode:'pass-through'}));group.mask=new LayerMask({assetId:mask.id});group.layers.add(new RasterLayer({assetId:image.id,width:2081,height:140}));
  const before=JSON.stringify(editor.document.toJSON()),original=new Uint8Array(await mask.blob.arrayBuffer()),Native=window.Worker,abort=new AbortController();let maskReached=false,changed=false,encoding='',workers=0,terminated=0,returned=false,error='';
  const detached:boolean[]=[],surfaces:HTMLCanvasElement[]=[],render=editor.renderer.render.bind(editor.renderer),coverage=editor.renderer.renderMaskCoverage.bind(editor.renderer);
  editor.renderer.render=async(...args)=>{const value=await render(...args);surfaces.push(value);return value;};editor.renderer.renderMaskCoverage=async(...args)=>{const value=await coverage(...args);surfaces.push(value);return value;};
  window.Worker=new Proxy(Native,{construct(Target,args){
   const worker=Reflect.construct(Target,args) as Worker;if(!String(args[0]).includes('photoshop-export.worker'))return worker;
   workers++;const post=worker.postMessage.bind(worker),terminate=worker.terminate.bind(worker);worker.terminate=()=>{terminated++;terminate();};
   worker.addEventListener('message',event=>{if(encoding==='mask'&&!changed&&action==='invalid-count'){changed=true;event.data.channels=Array(4).fill(event.data.channels[0]);}});
   worker.postMessage=((value:{pixels:Uint8ClampedArray;encoding:string},transfer:Transferable[])=>{
    encoding=value.encoding;if(transfer.length!==1||transfer[0]!==value.pixels.buffer)throw new Error('Unexpected mask transfer ownership');post(value,transfer);detached.push(value.pixels.byteLength===0);
    if(encoding==='mask'){
     maskReached=true;if(!changed&&action==='cancel-pending'){changed=true;setTimeout(()=>abort.abort(new Error('Stop mask encoding')),0);}
     if(!changed&&action==='asset-pending'){changed=true;editor.assetStore.remove(mask.id);}
    }
   }) as Worker['postMessage'];return worker;
  }});
  try{await editor.export({format},{signal:abort.signal});returned=true;}catch(cause){error=String(cause);}finally{window.Worker=Native;editor.renderer.render=render;editor.renderer.renderMaskCoverage=coverage;}
  const source=new Uint8Array(await mask.blob.arrayBuffer()),result={maskReached,changed,workers,terminated,returned,error,detached,unchanged:before===JSON.stringify(editor.document.toJSON()),sameSource:source.length===original.length&&source.every((value,index)=>value===original[index]),released:surfaces.every(surface=>!surface.width&&!surface.height)};
  if(action==='asset-pending')await editor.assetStore.add(blob,'Restored mask',mask.id,false);
  return{...result,retry:(await editor.export({format})).blob.size>0};
 },{format,action});
 expect(result.maskReached).toBe(true);expect(result.workers).toBe(1);expect(result.terminated).toBe(1);expect(result.detached.every(Boolean)).toBe(true);expect(result.unchanged).toBe(true);expect(result.sameSource).toBe(true);expect(result.released).toBe(true);expect(result.retry).toBe(true);
 if(action==='success')expect(result.returned).toBe(true);else{expect(result.changed).toBe(true);expect(result.returned).toBe(false);expect(result.error).toMatch(/Stop mask encoding|source changed|Invalid Photoshop/);}
 await info.attach('photoshop-native-mask-worker',{body:JSON.stringify(result),contentType:'application/json'});
});
