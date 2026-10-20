import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const root='tests/fixtures/psd/groups/';
const cases=JSON.parse(readFileSync(root+'manifest.json','utf8')).cases as {file:string;reference:string;width:number;height:number;masked:boolean;locked:boolean;blendMode:string;changedPixels?:number}[];

for(const fixture of cases)test(`Photoshop hierarchy ${fixture.file} preserves independent pixels, source planes and editable groups`,async({page},info)=>{
 if(fixture.width===10000)expect(fixture.changedPixels,'The full-resolution reference must exercise an actual group effect.').toBeGreaterThan(0);
 test.setTimeout(240000);await page.goto('/');await page.getByTestId('psd-input').setInputFiles(root+fixture.file);const dialog=page.locator('.psd-import-dialog');await expect(dialog.locator('.psd-meta-card')).toBeVisible();await expect(dialog.locator('input[value="layered"]')).toBeEnabled();await dialog.locator('input[value="layered"]').check();await dialog.getByRole('button',{name:'Import Layers',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:fixture.width===10000?120000:5000});
 const result=await page.evaluate(async()=>{
  const {editor,LayerGroup}=window.luma,doc=editor.document,group=doc.layers.at(1)!;if(!(group instanceof LayerGroup))throw new Error('Missing native group');
  const before=JSON.stringify(doc.toJSON()),hashes=async()=> (await Promise.all(editor.assetStore.values().map(async asset=>[asset.id,[...new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer()))].join()]))).sort(([a],[b])=>a.localeCompare(b)),sources=await hashes();
  if(!group.locked){doc.transaction('Edit imported group',()=>{group.opacity=.25;group.x+=3;});doc.undo();}
  const undo=before===JSON.stringify(doc.toJSON()),project=await editor.saveProject();await editor.openProject(new File([project],'groups.luma'));
  const restored=editor.document.layers.at(1)!;
  return{undo,sameModel:before===JSON.stringify(editor.document.toJSON()),sameSources:JSON.stringify(sources)===JSON.stringify(await hashes()),kind:restored.kind,blendMode:restored.blendMode,assetCount:editor.assetStore.values().length};
 });expect(result.undo).toBe(true);expect(result.sameModel).toBe(true);expect(result.sameSources).toBe(true);expect(result.kind).toBe('group');expect(result.blendMode).toBe(fixture.blendMode);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const path=info.outputPath('groups.png');await(await pending).saveAs(path);
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size;maximum=0\nfor y in range(0,a.height,64):\n box=(0,y,a.width,min(a.height,y+64));x=np.asarray(a.crop(box)).astype(int);z=np.asarray(b.crop(box)).astype(int);assert np.array_equal(x[:,:,3],z[:,:,3]);maximum=max(maximum,int(np.abs(x-z).max()))\nassert maximum<=1,maximum\nprint('Every alpha is exact; maximum independent RGB byte difference:',maximum)",path,root+fixture.reference],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr).toBe(0);await info.attach('photoshop-group-independent',{body:JSON.stringify({fixture,result,independent:checked.stdout}),contentType:'application/json'});
});

for(const fixture of ['pass','pass-opacity','pass-opacity-mask','normal-mask'])
test(`imported ${fixture} exports independent PSD/PSB layers and native SVG appearance`,async({page},info)=>{
 await page.goto('/');
 const result=await page.evaluate(async fixture=>{
  const {editor}=window.luma;
  const response=await fetch(`/tests/fixtures/psd/groups/${fixture}.psd`);
  await editor.openPsd(await response.blob(),{mode:'layered'});
  const before=JSON.stringify(editor.document.toJSON()),outputs:Record<string,string>={};
  for(const format of ['psd','psb','svg'] as const){
   const {blob}=await editor.export({format});
   outputs[format]=btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  }
  const svg=atob(outputs.svg),image=new Image(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;
  const reference=await createImageBitmap(await fetch(`/tests/fixtures/psd/groups/${fixture}.png`).then(r=>r.blob()));
  try{
   image.src=url;await image.decode();const c=canvas.getContext('2d')!;c.drawImage(image,0,0);const actual=c.getImageData(0,0,32,24).data;c.clearRect(0,0,32,24);c.drawImage(reference,0,0);const expected=c.getImageData(0,0,32,24).data;
   let alpha=0,rgb=0;for(let i=0;i<actual.length;i++)if(i%4===3)alpha=Math.max(alpha,Math.abs(actual[i]-expected[i]));else rgb=Math.max(rgb,Math.abs(actual[i]-expected[i]));
   return{outputs,alpha,rgb,sameModel:before===JSON.stringify(editor.document.toJSON())};
  }finally{URL.revokeObjectURL(url);reference.close();canvas.width=canvas.height=0;}
 },fixture);
 expect(result.sameModel).toBe(true);expect(result.alpha).toBe(0);expect(result.rgb).toBeLessThanOrEqual(1);
 const cases=[];
 for(const format of ['psd','psb']){
  const path=info.outputPath(`groups.${format}`);await writeFile(path,Buffer.from(result.outputs[format],'base64'));
  cases.push({path,format,reference:root+fixture+'.png',names:['Backdrop','Outer Ω','Top yellow'],visibility:[true,true,true]});
 }
 const manifest=info.outputPath('independent.json');await writeFile(manifest,JSON.stringify(cases));
 const checked=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['scripts/check-photoshop-export.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 await info.attach('photoshop-group-export',{body:JSON.stringify({fixture,alpha:result.alpha,rgb:result.rgb,sameModel:result.sameModel,independent:JSON.parse(checked.stdout)}),contentType:'application/json'});
});

for(const kind of ['tone','tonal','patch'] as const)
test(`pass-through ${kind} adjustment invalidates the real sibling backdrop and restores cached undo`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async kind=>{
  const {editor,LayerGroup,VectorLayer,VectorPath,AdjustmentLayer,BrushStroke}=window.luma;
  const {release}=await import(/* @vite-ignore */String('/src/engine/canvas.ts'));
  editor.newDocument({width:32,height:24});const doc=editor.document;
  const base=doc.layers.add(new VectorLayer()),path=base.paths.add(VectorPath.rectangle({x:0,y:0,width:32,height:24},0,{fill:'#804020',stroke:null}));
  const group=doc.layers.add(new LayerGroup({blendMode:'pass-through',opacity:.65}));
  if(kind==='tone')group.layers.add(new AdjustmentLayer({adjustment:{kind:'tone',exposure:1,contrast:0,saturation:0}}));
  if(kind==='tonal')group.layers.add(new AdjustmentLayer({adjustment:{kind:'tonal',strokes:[{brush:new BrushStroke({points:[{x:3,y:12},{x:29,y:12}],size:16,hardness:1}).toJSON() as import('../src/core/drawing').BrushStrokeData,mode:'dodge',range:'midtones',exposure:.5,protectTones:true}]}}));
  if(kind==='patch'){
   const source=await editor.assetStore.add(await fetch('/tests/fixtures/psd/groups/alpha-red.png').then(r=>r.blob()),'Patch');
   group.layers.add(new AdjustmentLayer({opacity:.7,adjustment:{kind:'patch',assetId:source.id,width:16,height:24}}));
  }
  const pixels=async(cache=true)=>{const canvas=await editor.renderer.render(doc.getSnapshot().document,editor.assetStore,{cache});try{return [...canvas.getContext('2d')!.getImageData(0,0,32,24).data];}finally{release(canvas);}};
  const before=await pixels();await pixels();path.fill='#204080';const warm=await pixels(),cold=await pixels(false);
  doc.undo();const undone=await pixels();const frame=await editor.renderer.prepareViewport(doc.getSnapshot().document,editor.assetStore);const backend=frame.backend;frame.dispose();
  return{changed:JSON.stringify(warm)!==JSON.stringify(before),matches:JSON.stringify(warm)===JSON.stringify(cold),undo:JSON.stringify(undone)===JSON.stringify(before),backend};
 },kind);
 expect(result).toEqual({changed:true,matches:true,undo:true,backend:'canvas2d'});
});

test('native pass-through group inspector offers group-only mode and shared keyboard undo',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{const {editor,LayerGroup,TextLayer}=window.luma,group=editor.document.layers.add(new LayerGroup({blendMode:'pass-through'}));group.layers.add(new TextLayer({text:'Inside'}));editor.document.selectedLayer=group;});
 await expect(page.getByLabel('Blend mode',{exact:true})).toHaveValue('pass-through');await expect(page.getByLabel('Fill opacity',{exact:true})).toBeDisabled();
 await page.getByLabel('Blend mode',{exact:true}).selectOption('normal');expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer!.blendMode)).toBe('normal');await page.getByLabel('Blend mode',{exact:true}).evaluate(element=>(element as HTMLElement).blur());await page.keyboard.press('Control+z');expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer!.blendMode)).toBe('pass-through');
});

test('pass-through opacity interpolates premultiplied color and alpha over a translucent backdrop',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,LayerGroup,RasterLayer}=window.luma;editor.newDocument({width:1,height:1});
  const blue=await editor.assetStore.add(await fetch('/tests/fixtures/psd/groups/alpha-blue.png').then(r=>r.blob()),'Blue');
  const red=await editor.assetStore.add(await fetch('/tests/fixtures/psd/groups/alpha-red.png').then(r=>r.blob()),'Red');
  editor.document.layers.add(new RasterLayer({assetId:blue.id,width:1,height:1}));const group=editor.document.layers.add(new LayerGroup({blendMode:'pass-through',opacity:128/255}));group.layers.add(new RasterLayer({assetId:red.id,width:1,height:1}));
  const bitmap=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d')!;c.drawImage(bitmap,0,0);bitmap.close();return [...c.getImageData(0,0,1,1).data];
 });expect(result).toEqual([102,0,153,160]);
});

for(const action of ['allocation-error','cancel'] as const)
test(`pass-through ${action} releases before/after surfaces and allows retry`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async action=>{
  const {Document,LayerGroup,editor}=window.luma;
  const {CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
  const {release}=await import(/* @vite-ignore */String('/src/engine/canvas.ts'));
  const model=new Document({width:32,height:24});model.layers.add(new LayerGroup({blendMode:'pass-through',opacity:.5}));
  const renderer=new CanvasRenderer(),create=document.createElement.bind(document),surfaces:HTMLCanvasElement[]=[];let cancelled=false,error='',returned=false;
  document.createElement=function(...args:Parameters<typeof document.createElement>){
   const element=create(...args);
   if(args[0]==='canvas'){
    const canvas=element as HTMLCanvasElement;surfaces.push(canvas);
    if(surfaces.length===3){if(action==='allocation-error')canvas.getContext=(()=>null) as typeof canvas.getContext;else cancelled=true;}
   }
   return element;
  } as typeof document.createElement;
  try{const canvas=await renderer.render(model.getSnapshot().document,editor.assetStore,{cache:false,isCancelled:()=>cancelled});returned=true;release(canvas);}catch(cause){error=String(cause);}finally{document.createElement=create;}
  try{
   const count=surfaces.length,released=surfaces.every(canvas=>canvas.width===0&&canvas.height===0),retry=await renderer.render(model.getSnapshot().document,editor.assetStore,{cache:false});const retrySize=[retry.width,retry.height];release(retry);
   return{returned,error,count,released,retrySize};
  }finally{renderer.dispose();}
 },action);
 expect(result.returned).toBe(false);expect(result.error).toMatch(action==='allocation-error'?/working buffer/:/AbortError.*superseded/i);expect(result.count).toBe(action==='allocation-error'?3:4);expect(result.released).toBe(true);expect(result.retrySize).toEqual([32,24]);
});
