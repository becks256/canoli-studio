import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function setup(page:import('@playwright/test').Page){
  await page.goto('/');await page.evaluate(async()=>{
    const {editor,RasterLayer}=window.luma;editor.newDocument({width:96,height:48});
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=48;const c=canvas.getContext('2d')!;
    c.fillStyle='#d8b098';c.fillRect(0,0,96,48);c.fillStyle='#f01828';c.fillRect(14,10,16,16);c.fillRect(62,10,16,16);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!))),asset=await editor.assetStore.add(blob,'Original study',undefined,false);
    editor.document.selectedLayer=editor.document.layers.add(new RasterLayer({assetId:asset.id,width:96,height:48}));canvas.width=canvas.height=0;
  });
}
async function addFromPalette(page:import('@playwright/test').Page){await page.keyboard.press('Control+k');await page.getByLabel('Search commands').fill('Red Eye');await page.getByRole('option',{name:'New Red Eye adjustment layer'}).click();}

test('pupil selection creation is atomic; controls preview, cancel, commit, reset and respect locks',async({page})=>{
 await setup(page);const before=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()));
 await addFromPalette(page);await expect(page.getByRole('alert')).toContainText('Select the red pupils first');expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before);
 await page.evaluate(()=>{const {editor,MarqueeSelection}=window.luma;editor.document.selection=new MarqueeSelection({shape:'rectangle',x:14,y:10,width:16,height:16});});
 const snapshot=await page.evaluate(()=>window.luma.editor.document.toJSON()),past=await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length);
 await addFromPalette(page);await expect(page.getByLabel('Adjustment type',{exact:true})).toHaveValue('red-eye');
 expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(past+1);
 const mask=await page.evaluate(()=>window.luma.editor.document.selectedLayer!.mask!.toJSON());expect(mask.kind).toBe('selection');
 const strength=page.getByRole('spinbutton',{name:'Correction strength value',exact:true}),threshold=page.getByRole('spinbutton',{name:'Red excess threshold value',exact:true});
 await expect(strength).toHaveValue('100');await expect(threshold).toHaveValue('32');
 const revision=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
 const slider=page.getByRole('slider',{name:'Correction strength',exact:true});await slider.focus();await page.keyboard.down('ArrowLeft');expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision);await page.keyboard.press('Escape');await page.keyboard.up('ArrowLeft');await expect(strength).toHaveValue('100');
 await strength.fill('45.5');await strength.press('Enter');expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision+1);
 await threshold.fill('32.01');await threshold.press('Enter');await threshold.fill('256');await threshold.press('Enter');await expect(threshold).toHaveValue('32.01');
 await page.getByRole('button',{name:'Reset adjustment',exact:true}).click();await expect(strength).toHaveValue('100');await expect(threshold).toHaveValue('32');
 await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');await expect(strength).toHaveValue('45.5');await expect(threshold).toHaveValue('32.01');
 expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer!.mask!.toJSON())).toEqual(mask);
 await page.evaluate(()=>{window.luma.editor.document.selectedLayer!.locked=true;});await expect(strength).toBeDisabled();await expect(threshold).toBeDisabled();
 // Unwind lock, strength, threshold and creation through the actual shared history.
 await page.evaluate(()=>{const d=window.luma.editor.document;for(let i=0;i<4;i++)d.undo();});expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(snapshot);
});

test('affine parent masks, native PNG/SVG/PSD pixels, source identity and project reopen agree',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{
  const {editor,AdjustmentLayer,RedEyeAdjustment,MarqueeSelection,LayerGroup,AffineTransform}=window.luma,doc=editor.document;
  const asset=editor.assetStore.values()[0],original=[...new Uint8Array(await asset.blob.arrayBuffer())],group=doc.layers.add(new LayerGroup({name:'Scaled portrait'}));
  group.transform=new AffineTransform(2,0,0,2,0,0);doc.layers.at(0)!.moveTo(group);doc.selectedLayer=group;
  const before=doc.toJSON(),correction=new AdjustmentLayer({adjustment:new RedEyeAdjustment()});
  doc.transaction('Correct left pupil',()=>{group.layers.add(correction);correction.maskFromSelection(new MarqueeSelection({shape:'rectangle',x:28,y:20,width:32,height:28}));});
  const sample=async(blob:Blob)=>{const image=new Image(),url=URL.createObjectURL(blob),canvas=document.createElement('canvas');canvas.width=96;canvas.height=48;try{image.src=url;await image.decode();const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return[ [40,30],[80,30],[4,4] ].map(([x,y])=>[...c.getImageData(x,y,1,1).data]);}finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}};
  const native=await sample(await editor.exportPng()),svg=await editor.export({format:'svg'}),svgPixels=await sample(svg.blob);
  const {parsePsd}=await import(/* @vite-ignore */String('/src/core/interchange/psd/parser.ts'));const outputs=[];
  for(const psdMode of ['layers','flatten'] as const){const out=await editor.export({format:'psd',psdMode}),parsed=parsePsd(new Uint8Array(await out.blob.arrayBuffer()));outputs.push({mode:psdMode,pixels:[[40,30],[80,30],[4,4]].map(([x,y])=>[...parsed.composite!.data.slice((y*96+x)*4,(y*96+x)*4+4)]),warnings:out.report.featuresDegradedOrOmitted});}
  const saved=doc.toJSON(),project=await editor.saveProject();doc.undo();const undo=doc.toJSON();await editor.openProject(new File([project],'red-eye.luma'));
  return{native,svg:svgPixels,outputs,saved,reopened:editor.document.toJSON(),reopenedPixels:await sample(await editor.exportPng()),source:original,after:[...new Uint8Array(await editor.assetStore.get(asset.id).blob.arrayBuffer())],before,undo};
 });
 expect(result.native).toEqual([[32,24,40,255],[216,176,152,255],[216,176,152,255]]);expect(result.svg).toEqual(result.native);
 for(const out of result.outputs)expect(out.pixels).toEqual(result.native);
 expect(result.reopened).toEqual(result.saved);expect(result.reopenedPixels).toEqual(result.native);expect(result.after).toEqual(result.source);expect(result.undo).toEqual(result.before);
});

test('bounded worker tiles correct across the 1024 seam and snapshot caller input before readiness',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts'));const p=new PixelProcessor(),input=new Uint8ClampedArray([220,20,40,128]),settings={kind:'red-eye' as const,threshold:32,strength:100};
  const pending=p.redEye(input,settings);input.fill(0);settings.strength=0;let owned:number[];try{owned=[...await pending];}finally{p.dispose();}
  const {editor,PaintLayer,PaintFill,AdjustmentLayer,RedEyeAdjustment,MarqueeSelection}=window.luma;editor.newDocument({width:2081,height:4});const layer=editor.document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:2081,height:4},color:'#f01828'}));
  const correction=editor.document.layers.add(new AdjustmentLayer({adjustment:new RedEyeAdjustment()}));correction.maskFromSelection(new MarqueeSelection({shape:'rectangle',x:1023,y:0,width:3,height:4}));
  const image=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=2081;canvas.height=4;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();
  return{owned,inputSize:input.byteLength,pixels:[0,1022,1023,1024,1025,1026,2080].map(x=>[...c.getImageData(x,1,1,1).data])};
 });expect(result.owned).toEqual([30,20,40,128]);expect(result.inputSize).toBe(4);expect(result.pixels).toEqual([[240,24,40,255],[240,24,40,255],[32,24,40,255],[32,24,40,255],[32,24,40,255],[240,24,40,255],[240,24,40,255]]);
});

test('documented RedEyeAdjustment constructor runs in the isolated script runtime with atomic undo',async({page})=>{
 const source=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: red-eye-correction -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();await page.goto('/');const before=await page.evaluate(()=>window.luma.editor.document.toJSON());
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Red-eye study ready; threshold 32');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await expect(page.getByLabel('Adjustment type',{exact:true})).toHaveValue('red-eye');await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
});

test('a 50 MP original retains native detail and source bytes through masked correction, undo and project reopen',async({page})=>{
 test.setTimeout(240000);await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/psd/native-50mp.png');await expect(page.locator('.layer-row')).toHaveCount(1,{timeout:120000});
 const result=await page.evaluate(async()=>{
  const {editor,RasterLayer,AdjustmentLayer,RedEyeAdjustment,MarqueeSelection}=window.luma,doc=editor.document,source=doc.layers.at(0);if(!(source instanceof RasterLayer))throw new Error('Missing source');
  const asset=editor.assetStore.get(source.assetId),hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),original=await hash(asset.blob),before=doc.toJSON(),region={x:9000,y:4000,width:128,height:64};
  const correction=new AdjustmentLayer({adjustment:new RedEyeAdjustment({threshold:0,strength:100})});doc.transaction('Correct native region',()=>{doc.layers.add(correction);correction.maskFromSelection(new MarqueeSelection({shape:'rectangle',...region}));});
  const render=async()=>{const out=await editor.renderer.render(editor.document.getSnapshot().document,editor.assetStore,{region,cache:false,readback:true});try{return[...out.getContext('2d')!.getImageData(0,0,128,64).data];}finally{out.width=out.height=0;}};
  const actual=await render(),reference=document.createElement('canvas');reference.width=128;reference.height=64;const c=reference.getContext('2d')!;c.drawImage(asset.bitmap,region.x,region.y,128,64,0,0,128,64);const input=c.getImageData(0,0,128,64).data;let changed=0,exact=true;
  for(let i=0;i<input.length;i+=4){const [r,g,b,a]=input.subarray(i,i+4),expected=a&&r>g&&r>b?Math.round((g+b)/2):r;if(expected!==r)changed++;if(actual[i]!==expected||actual[i+1]!==g||actual[i+2]!==b||actual[i+3]!==a)exact=false;}
  const bitmap=await createImageBitmap(await editor.exportPng()),exportSize=[bitmap.width,bitmap.height];
  c.clearRect(0,0,128,64);c.drawImage(bitmap,region.x,region.y,128,64,0,0,128,64);const fullExportPixels=[...c.getImageData(0,0,128,64).data];
  c.clearRect(0,0,128,64);c.drawImage(bitmap,100,100,1,1,0,0,1,1);const outside=[...c.getImageData(0,0,1,1).data];bitmap.close();reference.width=reference.height=0;
  const saved=doc.toJSON(),project=await editor.saveProject();doc.undo();const undo=JSON.stringify(doc.toJSON())===JSON.stringify(before);await editor.openProject(new File([project],'red-eye-50mp.luma'));const restored=editor.assetStore.get(asset.id);
  return{exact,changed,undo,exportSize,outside,fullExportMatches:JSON.stringify(fullExportPixels)===JSON.stringify(actual),samePixels:JSON.stringify(await render())===JSON.stringify(actual),sameModel:JSON.stringify(editor.document.toJSON())===JSON.stringify(saved),sourceHash:original,reopenedHash:await hash(restored.blob),sourceSize:[restored.width,restored.height],documentSize:[editor.document.width,editor.document.height]};
 });expect(result.exact).toBe(true);expect(result.changed).toBeGreaterThan(0);expect(result.undo).toBe(true);expect(result.samePixels).toBe(true);expect(result.sameModel).toBe(true);expect(result.sourceHash).toBe(result.reopenedHash);expect(result.exportSize).toEqual([10000,5000]);expect(result.fullExportMatches).toBe(true);expect(result.outside).toEqual([255,0,0,255]);expect(result.sourceSize).toEqual([10000,5000]);expect(result.documentSize).toEqual([10000,5000]);
});

test('canvas context creates a masked Red Eye adjustment without overflowing its menu',async({page})=>{
 await setup(page);await page.evaluate(()=>{const {editor,MarqueeSelection}=window.luma;editor.document.selection=new MarqueeSelection({shape:'ellipse',x:14,y:10,width:16,height:16});});
 await page.locator('.viewport').click({button:'right',position:{x:50,y:50}});expect(await page.locator('.canvas-context-menu').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
 await page.locator('.canvas-context-menu').getByRole('button',{name:'Red Eye',exact:true}).click();await expect(page.getByLabel('Adjustment type',{exact:true})).toHaveValue('red-eye');
 const mask=await page.evaluate(()=>window.luma.editor.document.selectedLayer!.mask!.toJSON());expect(mask.kind).toBe('selection');
});
