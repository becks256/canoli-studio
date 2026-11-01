import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

for(const projected of [false,true])test('resized HDR native replay matches independently completed originals under '+(projected?'perspective':'reflected affine')+' placement and crop partitions',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async({bytes,projected})=>{
  const {prepareHdrWetDocument}=await import(/* @vite-ignore */String('/tests/helpers/hdr-wet-document.ts')) as typeof import('./helpers/hdr-wet-document');
  const {encodeFloatWetTile}=await import(/* @vite-ignore */String('/src/core/float-wet-tile.ts')) as typeof import('../src/core/float-wet-tile');
  const {editor,RasterLayer,LayerGroup,AffineTransform,PerspectiveTransform,PencilStroke,WetPaintStroke}=window.luma,{target,colors,removal,tile}=await prepareHdrWetDocument(editor,bytes);
  const initial=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);let expected:Float32Array;try{expected=await initial.read({x:0,y:0,width:131,height:79});}finally{initial.dispose();}
  for(let pixel=0;pixel<2;pixel++){const at=(4*131+3+pixel)*4,from=pixel*4,alpha=expected[at+3]*(1-.625*removal[from+3])+colors[from+3]*.625;for(let c=0;c<3;c++)expected[at+c]=(expected[at+c]*expected[at+3]*(1-.625*removal[from+3])+colors[from+c]*colors[from+3]*.625)/alpha;expected[at+3]=alpha;}
  target.width=262;target.height=39.5;target.applyWetPaint(new WetPaintStroke({precision:'float32',brush:new PencilStroke({points:[{x:6.5,y:2.5}]}),nativeTransform:AffineTransform.scale(2,.5),opacity:.625,tiles:[tile]}));
  target.width=196.5;target.height=118.5;target.transform=new AffineTransform(-.8,.125,.2,1.1,150.5,10.25);
  if(projected)target.perspective=new PerspectiveTransform({corners:[{x:.05,y:-.03},{x:.95,y:.08},{x:1.2,y:.9},{x:-.1,y:1.05}]});
  const blob=await encodeFloatWetTile(expected,131,79),asset=await editor.assetStore.add(blob,'Independently completed native.tif',undefined,false,{tiff:{editingPrecision:'float32'}}),reference=editor.document.layers.add(new RasterLayer({assetId:asset.id,name:'Independent completed native',width:target.width,height:target.height}));reference.transform=target.transform;reference.perspective=target.perspective;reference.visible=false;
  const group=editor.document.layers.add(new LayerGroup({name:'Native parent'}));group.transform=new AffineTransform(.9,.1,-.15,1.1,7.5,-2.25);target.moveTo(group);reference.moveTo(group);
  const area={x:-32,y:-32,width:256,height:224},capture=()=>editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore),actualScene=await capture();
  let actual:Float32Array,parts:Float32Array;try{actual=await actualScene.read(area);parts=new Float32Array(actual.length);for(let y=0;y<area.height;y+=41)for(let x=0;x<area.width;x+=67){const width=Math.min(67,area.width-x),height=Math.min(41,area.height-y),part=await actualScene.read({x:area.x+x,y:area.y+y,width,height});for(let row=0;row<height;row++)parts.set(part.subarray(row*width*4,(row+1)*width*4),((y+row)*area.width+x)*4);}}finally{actualScene.dispose();}
  target.visible=false;reference.visible=true;const referenceScene=await capture();let control:Float32Array;try{control=await referenceScene.read(area);}finally{referenceScene.dispose();}
  const same=(a:Float32Array,b:Float32Array)=>new Uint32Array(a.buffer).every((word,i)=>word===new Uint32Array(b.buffer)[i]),mismatches=(a:Float32Array,b:Float32Array)=>new Uint32Array(a.buffer).reduce((n,word,i)=>n+Number(word!==new Uint32Array(b.buffer)[i]),0);
  return {projected,referenceExact:same(actual,control),partitionExact:same(actual,parts),referenceDifferences:mismatches(actual,control),partitionDifferences:mismatches(actual,parts),positiveAlpha:actual.filter((v,i)=>i%4===3&&v>0).length,captured:target.toJSON().kind==='raster'?(target.toJSON() as import('../src/core/model').RasterLayerData).erasures?.[0]:null};
 },{bytes:[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')],projected});await writeFile(info.outputPath('hdr-native-placement.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({referenceExact:true,partitionExact:true,captured:{width:262,height:39.5,stroke:{precision:'float32'}}});expect(result.positiveAlpha).toBeGreaterThan(1000);
});

test('documented isolated HDR constructor commits native pixels through one Undo and lossless project reopening',async({page},info)=>{
 const guide=await readFile('docs/HDR_WET_DOCUMENTS.md','utf8'),code=guide.match(/<!-- example: hdr-wet-prepared -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(code).toBeTruthy();await page.goto('/');
 const result=await page.evaluate(async({bytes,code})=>{
  const {prepareHdrWetDocument}=await import(/* @vite-ignore */String('/tests/helpers/hdr-wet-document.ts')) as typeof import('./helpers/hdr-wet-document');
  const {editor}=window.luma,fixture=await prepareHdrWetDocument(editor,bytes),area={x:0,y:0,width:131,height:79};
  const read=async()=>{const scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);try{return await scene.read(area);}finally{scene.dispose();}};
  const before=await read(),setupProject=await editor.saveProject(),saved=JSON.stringify(editor.document.toJSON()),past=editor.document.getSnapshot().past.length;await editor.runScript(code);const after=await read(),edited=JSON.stringify(editor.document.toJSON()),oneUndo=editor.document.getSnapshot().past.length===past+1;
  editor.document.undo();const undo=JSON.stringify(editor.document.toJSON())===saved;editor.document.redo();const redo=JSON.stringify(editor.document.toJSON())===edited;
  const assetFiles=Object.fromEntries(await Promise.all(editor.assetStore.values().map(async asset=>[asset.id,[...new Uint8Array(await asset.blob.arrayBuffer())]] as const))),project=await editor.saveProject();await editor.openProject(new File([project],'hdr-wet-native.luma'));const reopened=await read(),modelExact=JSON.stringify(editor.document.toJSON())===edited;
  const originalBytesExact=Object.entries(assetFiles).every(([id,original])=>editor.assetStore.has(id)&&editor.assetStore.get(id).blob.size===original.length);
  const allSourceBytesExact=(await Promise.all(Object.entries(assetFiles).map(async([id,original])=>{const data=new Uint8Array(await editor.assetStore.get(id).blob.arrayBuffer());return data.length===original.length&&data.every((v,i)=>v===original[i]);}))).every(Boolean);
  const output=(a:Float32Array)=>[...new Uint8Array(a.buffer)];return {oneUndo,undo,redo,modelExact,originalBytesExact,allSourceBytesExact,area,before:output(before),after:output(after),reopened:output(reopened),setupProject:[...new Uint8Array(await setupProject.arrayBuffer())],pixels:[...new Uint8Array(await fixture.pixels.arrayBuffer())],coverage:[...new Uint8Array(await fixture.coverage.arrayBuffer())],schema:editor.document.toJSON().schemaVersion,precision:editor.document.precision};
 },{bytes:[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')],code:code!});
 expect(result).toMatchObject({oneUndo:true,undo:true,redo:true,modelExact:true,originalBytesExact:true,allSourceBytesExact:true,schema:57,precision:'float32'});
 for(const name of ['before','after','reopened'] as const)await writeFile(info.outputPath(name+'.f32le'),Buffer.from(result[name]));for(const name of ['pixels','coverage'] as const)await writeFile(info.outputPath(name+'.tif'),Buffer.from(result[name]));
 await writeFile(info.outputPath('hdr-setup.luma'),Buffer.from(result.setupProject));await writeFile(info.outputPath('hdr-document.json'),JSON.stringify({...result,before:undefined,after:undefined,reopened:undefined,setupProject:undefined,pixels:undefined,coverage:undefined},null,2));
 const checked=spawnSync(process.env.CANOLI_REFERENCE_PYTHON??'python3',['scripts/check-hdr-wet-document.py',info.outputDir],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);await writeFile(info.outputPath('independent-hdr-document.json'),checked.stdout);
});

test('isolated and plugin HDR edits reject invalid native pairs atomically and retain existing authority',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {prepareHdrWetDocument}=await import(/* @vite-ignore */String('/tests/helpers/hdr-wet-document.ts')) as typeof import('./helpers/hdr-wet-document');
  const {editor}=window.luma;await prepareHdrWetDocument(editor,bytes);const before=JSON.stringify(editor.document.toJSON()),past=editor.document.getSnapshot().past.length;
  const script=(coverage:string)=>`const target=[...document.layers].find(layer=>layer.name==='HDR target'); const output=[...document.layers].find(layer=>layer.name==='HDR wet output'); const coverage=[...document.layers].find(layer=>layer.name===${JSON.stringify(coverage)});target.opacity=.625;target.applyWetPaint(new WetPaintStroke({precision:'float32',brush:new PencilStroke({points:[{x:3.5,y:4.5}]}),tiles:[{x:3,y:4,width:2,height:1,assetId:output.assetId,coverage:{assetId:coverage.assetId}}]}));`;
  let invalid='';try{await editor.runScript(script('HDR wet invalid coverage'));}catch(error){invalid=String(error);}const atomic=before===JSON.stringify(editor.document.toJSON())&&editor.document.getSnapshot().past.length===past;
  const manifest={format:'luma-plugin' as const,apiVersion:1 as const,id:'hdr-wet-test',name:'Prepared HDR',version:'1.0.0',description:'Prepared native output',permissions:['document:read','document:write'] as ('document:read'|'document:write')[],commands:[{id:'apply',title:'Apply',source:script('HDR wet coverage')}]};editor.plugins.install(manifest);const inert=before===JSON.stringify(editor.document.toJSON());await editor.runPlugin(manifest.id,'apply');const applied=JSON.stringify(editor.document.toJSON());editor.document.undo();const undo=before===JSON.stringify(editor.document.toJSON());editor.plugins.install({...manifest,version:'1.0.1',permissions:['document:read']});let permission='';try{await editor.runPlugin(manifest.id,'apply');}catch(error){permission=String(error);}return {invalid,atomic,inert,undo,changed:applied!==before,permission,unchanged:before===JSON.stringify(editor.document.toJSON())};
 },[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);expect(result).toMatchObject({atomic:true,inert:true,undo:true,changed:true,unchanged:true});expect(result.invalid).toMatch(/already be masked/);expect(result.permission).toMatch(/write|permission|read.only/i);
});

test('recorded HDR recipe packages and workspace redo retain native source bytes and exact replay',async({page},info)=>{
 const code=(await readFile('docs/HDR_WET_DOCUMENTS.md','utf8')).match(/<!-- example: hdr-wet-prepared -->\s*```js\n([\s\S]*?)\n```/)![1];await page.goto('/');
 const result=await page.evaluate(async({bytes,code})=>{
  const {prepareHdrWetDocument}=await import(/* @vite-ignore */String('/tests/helpers/hdr-wet-document.ts')) as typeof import('./helpers/hdr-wet-document');
  const {editor}=window.luma;await prepareHdrWetDocument(editor,bytes);const read=async()=>{const scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);try{return new Uint32Array((await scene.read({x:0,y:0,width:64,height:48})).buffer);}finally{scene.dispose();}};
  const same=(a:Uint32Array,b:Uint32Array)=>a.length===b.length&&a.every((word,i)=>word===b[i]);
  editor.recipes.startRecording();const before=JSON.stringify(editor.document.toJSON());await editor.runScript(code);const expected=await read(),recipe=await editor.recipes.stopRecording({name:'Prepared native HDR'}),file=await editor.recipes.packages.get(recipe.id);if(!file)throw new Error('Missing HDR package');
  editor.document.undo();const undo=before===JSON.stringify(editor.document.toJSON()),past=editor.document.getSnapshot().past.length;await editor.recipes.executeRecipePackage(file);const recipeExact=same(expected,await read()),oneUndo=editor.document.getSnapshot().past.length===past+1,after=JSON.stringify(editor.document.toJSON());
  editor.document.undo();const retained=JSON.stringify(editor.document.toJSON());await editor.saveWorkspace();await editor.restoreWorkspace();const restored=retained===JSON.stringify(editor.document.toJSON());editor.document.redo();const redo=after===JSON.stringify(editor.document.toJSON()),workspaceExact=same(expected,await read());
  const original=editor.document.layers.at(0);if(!(original instanceof window.luma.RasterLayer))throw new Error('No target');const retainedBytes=new Uint8Array(await editor.assetStore.get(original.assetId).blob.arrayBuffer());
  return {undo,recipeExact,oneUndo,restored,redo,workspaceExact,originalExact:retainedBytes.length===bytes.length&&retainedBytes.every((v,i)=>v===bytes[i]),packageBytes:file.size};
 },{bytes:[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')],code});await writeFile(info.outputPath('hdr-recipe-workspace.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({undo:true,recipeExact:true,oneUndo:true,restored:true,redo:true,workspaceExact:true,originalExact:true});expect(result.packageBytes).toBeGreaterThan(0);
});

test('wet erase and clear replay in recorded native order including pigment outside the original image',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {prepareHdrWetDocument}=await import(/* @vite-ignore */String('/tests/helpers/hdr-wet-document.ts')) as typeof import('./helpers/hdr-wet-document');
  const {editor,MarqueeSelection,PencilStroke,WetPaintStroke}=window.luma,{target,tile}=await prepareHdrWetDocument(editor,bytes);
  const area={x:-8,y:-8,width:150,height:96},read=async()=>{const scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);try{return await scene.read(area);}finally{scene.dispose();}};
  const apply=(x:number,y:number)=>target.applyWetPaint(new WetPaintStroke({precision:'float32',brush:new PencilStroke({points:[{x,y}]}),tiles:[{...tile,x,y}]}));
  target.clear(new MarqueeSelection({x:3,y:4,width:2,height:1,shape:'rectangle'}));apply(3,4);apply(-3,-2);const painted=await read();target.clear(new MarqueeSelection({x:3,y:4,width:1,height:1,shape:'rectangle'}));const cleared=await read();editor.document.undo();const restored=await read();
  const at=(x:number,y:number)=>((y-area.y)*area.width+x-area.x)*4,rgba=(data:Float32Array,x:number,y:number)=>[...data.subarray(at(x,y),at(x,y)+4)],same=(a:Float32Array,b:Float32Array)=>new Uint32Array(a.buffer).every((word,i)=>word===new Uint32Array(b.buffer)[i]);
  return {inside:rgba(painted,3,4),outside:rgba(painted,-3,-2),cleared:rgba(cleared,3,4),outsideAfterClear:rgba(cleared,-3,-2),undoExact:same(painted,restored),nativeKinds:(target.toJSON() as import('../src/core/model').RasterLayerData).erasures!.map(entry=>entry.stroke.kind)};
 },[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);await writeFile(info.outputPath('hdr-order-offimage.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({inside:[4,-2,8,.375],outside:[4,-2,8,.375],cleared:[0,0,0,0],outsideAfterClear:[4,-2,8,.375],undoExact:true,nativeKinds:['fill','wet','wet']});
});

for(const kind of ['perspective','mapped'] as const)test('captured '+kind+' HDR placement matches an independent complete native bilinear field',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async({bytes,kind})=>{
  const {prepareHdrWetDocument}=await import(/* @vite-ignore */String('/tests/helpers/hdr-wet-document.ts')) as typeof import('./helpers/hdr-wet-document');
  const {editor,PerspectiveTransform,AffineTransform,MaskPlane,WetPaintStroke,PencilStroke}=window.luma,{target,tile,colors,removal}=await prepareHdrWetDocument(editor,bytes),area={x:0,y:0,width:131,height:79};
  const read=async()=>{const scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);try{return await scene.read(area);}finally{scene.dispose();}},expected=await read();
  // The captured 8x8 parallelogram has the exact forward shear (x,y+.25*x).
  // Sample its full compact support independently, then compose once in f64.
  for(let y=0;y<area.height;y++)for(let x=0;x<area.width;x++){
   const sx=x,sy=y+.25*(x+.5),ix=Math.floor(sx),iy=Math.floor(sy),dx=sx-ix,dy=sy-iy,field=new Float64Array(5);
   for(let row=0;row<2;row++)for(let col=0;col<2;col++){
    const nx=ix+col,ny=iy+row,w=(col?dx:1-dx)*(row?dy:1-dy);if(!w||ny!==4||nx<3||nx>4)continue;const from=(nx-3)*4,a=colors[from+3];for(let c=0;c<3;c++)field[c]+=colors[from+c]*a*w;field[3]+=a*w;field[4]+=removal[from+3]*w;
   }
   if(!field[4])continue;const at=(y*area.width+x)*4,keep=1-.625*field[4],alpha=expected[at+3]*keep+field[3]*.625;for(let c=0;c<3;c++)expected[at+c]=(expected[at+c]*expected[at+3]*keep+field[c]*.625)/alpha;expected[at+3]=alpha;
  }
  const perspective=new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:.25},{x:1,y:1.25},{x:0,y:1}]}),identity=new AffineTransform(),placement=kind==='perspective'?{width:8,height:8,perspective,basis:identity}:{width:8,height:8,plane:new MaskPlane({reference:{width:8,height:8},pose:{width:8,height:8,perspective,transform:identity}}),authoring:identity};
  target.applyWetPaint(new WetPaintStroke({precision:'float32',brush:new PencilStroke({points:[{x:3.5,y:4.5}]}),placement,opacity:.625,tiles:[tile]}));const actual=await read(),edited=JSON.stringify(editor.document.toJSON()),project=await editor.saveProject();await editor.openProject(new File([project],'hdr-placement.luma'));const restored=await read();
  const mismatch=(a:Float32Array,b:Float32Array)=>new Uint32Array(a.buffer).reduce((n,v,i)=>n+Number(v!==new Uint32Array(b.buffer)[i]),0);return {kind,words:actual.length,nativeDifferences:mismatch(actual,expected),reopenedDifferences:mismatch(restored,expected),modelExact:edited===JSON.stringify(editor.document.toJSON())};
 },{bytes:[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')],kind});await writeFile(info.outputPath('hdr-captured-placement.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({nativeDifferences:0,reopenedDifferences:0,modelExact:true,words:131*79*4});
});

test('a genuine 50 MP original retains public HDR commands, native geometry and independently checked window replay',async({page},info)=>{
 test.setTimeout(600000);await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {prepareHdrWetDocument}=await import(/* @vite-ignore */String('/tests/helpers/hdr-wet-document.ts')) as typeof import('./helpers/hdr-wet-document');
  const {editor,WetPaintStroke,PencilStroke}=window.luma,{target,tile,colors,removal}=await prepareHdrWetDocument(editor,bytes,'native-50mp.tif'),area={x:0,y:0,width:64,height:48};
  const read=async()=>{const scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);try{return await scene.read(area);}finally{scene.dispose();}},expected=await read();
  for(let pixel=0;pixel<2;pixel++){const at=(4*area.width+3+pixel)*4,from=pixel*4,keep=1-.625*removal[from+3],alpha=expected[at+3]*keep+colors[from+3]*.625;for(let c=0;c<3;c++)expected[at+c]=(expected[at+c]*expected[at+3]*keep+colors[from+c]*colors[from+3]*.625)/alpha;expected[at+3]=alpha;}
  const before=JSON.stringify(editor.document.toJSON());target.applyWetPaint(new WetPaintStroke({precision:'float32',brush:new PencilStroke({points:[{x:3.5,y:4.5}]}),opacity:.625,tiles:[tile]}));const actual=await read(),after=JSON.stringify(editor.document.toJSON());editor.document.undo();const undo=before===JSON.stringify(editor.document.toJSON());editor.document.redo();const redo=after===JSON.stringify(editor.document.toJSON()),asset=editor.assetStore.get(target.assetId),original=new Uint8Array(await asset.blob.arrayBuffer());
  const a=new Uint32Array(actual.buffer),b=new Uint32Array(expected.buffer);return {dimensions:[asset.width,asset.height],area,words:a.length,nonidenticalWords:a.reduce((n,v,i)=>n+Number(v!==b[i]),0),undo,redo,originalExact:original.length===bytes.length&&original.every((v,i)=>v===bytes[i])};
 },[...await readFile('tests/fixtures/tiff-float/native-50mp.tif')]);await writeFile(info.outputPath('hdr-document-50mp-window.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({dimensions:[10000,5000],words:64*48*4,nonidenticalWords:0,undo:true,redo:true,originalExact:true});
});

test('inert HDR metadata keeps native pixels and bounds without compiling an inactive field horizon',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {prepareHdrWetDocument}=await import(/* @vite-ignore */String('/tests/helpers/hdr-wet-document.ts')) as typeof import('./helpers/hdr-wet-document');
  const {localBounds}=await import(/* @vite-ignore */String('/src/core/spatial.ts')) as typeof import('../src/core/spatial');
  const {editor,WetPaintStroke,PencilStroke,PerspectiveTransform,AffineTransform}=window.luma,{target,tile}=await prepareHdrWetDocument(editor,bytes),read=async()=>{const scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);try{return await scene.read({x:0,y:0,width:64,height:48});}finally{scene.dispose();}},before=await read();
  const options={precision:'float32' as const,brush:new PencilStroke({points:[{x:3.5,y:7.5}]}),tiles:[{...tile,y:7}],placement:{width:8,height:8,perspective:new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:0},{x:.5,y:.5},{x:0,y:.5}]}),basis:new AffineTransform()}};
  target.applyWetPaint(new WetPaintStroke({...options,opacity:0}));const after=await read(),saved=JSON.stringify(editor.document.toJSON());let horizon='';try{target.applyWetPaint(new WetPaintStroke({...options,opacity:1}));}catch(error){horizon=String(error);}
  return {exact:new Uint32Array(before.buffer).every((word,i)=>word===new Uint32Array(after.buffer)[i]),bounds:localBounds(target.toJSON()),horizon,unchanged:saved===JSON.stringify(editor.document.toJSON())};
 },[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);await writeFile(info.outputPath('hdr-inert-horizon.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({exact:true,bounds:{x:0,y:0,width:131,height:79},unchanged:true});expect(result.horizon).toMatch(/horizon|unbounded|infinite/i);
});

test('redo-only HDR original pairs survive explicit history projects and workspace recovery without live layer references',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {prepareHdrWetDocument}=await import(/* @vite-ignore */String('/tests/helpers/hdr-wet-document.ts')) as typeof import('./helpers/hdr-wet-document');
  const {serializeProject}=await import(/* @vite-ignore */String('/src/core/project.ts')) as typeof import('../src/core/project');
  const {captureRetainedHistory}=await import(/* @vite-ignore */String('/src/core/history.ts')) as typeof import('../src/core/history');
  const {referencedAssets}=await import(/* @vite-ignore */String('/src/core/model.ts')) as typeof import('../src/core/model');
  const {editor,WetPaintStroke,PencilStroke,RasterLayer}=window.luma,prepared=await prepareHdrWetDocument(editor,bytes),data=editor.document.toJSON();data.children=data.children.filter(layer=>layer.name==='HDR target');
  const clean=await serializeProject(data,editor.assetStore);await editor.openProject(new File([clean],'HDR original only.luma'));
  await editor.assetStore.add(prepared.pixels,'History-only color.tif',prepared.tile.assetId,false,{tiff:{editingPrecision:'float32'}});await editor.assetStore.add(prepared.coverage,'History-only removal.tif',prepared.tile.coverage.assetId,false,{tiff:{editingPrecision:'float32'}});
  const target=editor.document.layers.at(0);if(!(target instanceof RasterLayer))throw new Error('Missing target');const read=async()=>{const scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);try{return new Uint32Array((await scene.read({x:0,y:0,width:64,height:48})).buffer);}finally{scene.dispose();}},same=(a:Uint32Array,b:Uint32Array)=>a.every((word,i)=>word===b[i]);
  target.applyWetPaint(new WetPaintStroke({precision:'float32',brush:new PencilStroke({points:[{x:3.5,y:4.5}]}),opacity:.625,tiles:[prepared.tile]}));const expected=await read(),edited=JSON.stringify(editor.document.toJSON());editor.document.undo();const current=JSON.stringify(editor.document.toJSON()),onlyRedo=!referencedAssets(editor.document.toJSON()).has(prepared.tile.assetId)&&editor.document.getSnapshot().past.length===0&&editor.document.getSnapshot().future.length===1;
  const project=await serializeProject(editor.document.toJSON(),editor.assetStore,captureRetainedHistory(editor.document.getSnapshot()));await editor.openProject(new File([project],'HDR redo-only.luma'));const projectRestored=current===JSON.stringify(editor.document.toJSON());editor.document.redo();const projectRedo=edited===JSON.stringify(editor.document.toJSON())&&same(expected,await read());editor.document.undo();await editor.saveWorkspace();await editor.restoreWorkspace();const workspaceRestored=current===JSON.stringify(editor.document.toJSON());editor.document.redo();const workspaceRedo=edited===JSON.stringify(editor.document.toJSON())&&same(expected,await read());
  const color=new Uint8Array(await editor.assetStore.get(prepared.tile.assetId).blob.arrayBuffer()),original=new Uint8Array(await prepared.pixels.arrayBuffer());return {onlyRedo,projectRestored,projectRedo,workspaceRestored,workspaceRedo,sourceExact:color.length===original.length&&color.every((v,i)=>v===original[i]),retainedAssets:editor.assetStore.values().length};
 },[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);await writeFile(info.outputPath('hdr-redo-only-sources.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({onlyRedo:true,projectRestored:true,projectRedo:true,workspaceRestored:true,workspaceRedo:true,sourceExact:true,retainedAssets:3});
});

test('project admission validates hidden inert HDR pairs before replacing the active session',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {prepareHdrWetDocument}=await import(/* @vite-ignore */String('/tests/helpers/hdr-wet-document.ts')) as typeof import('./helpers/hdr-wet-document');
  const {serializeProject}=await import(/* @vite-ignore */String('/src/core/project.ts')) as typeof import('../src/core/project');
  const {editor,WetPaintStroke,PencilStroke,RasterLayer}=window.luma,{target,tile}=await prepareHdrWetDocument(editor,bytes),bad=[...editor.document.layers].find(layer=>layer.name==='HDR wet invalid coverage');if(!(bad instanceof RasterLayer))throw new Error('Missing invalid pair');
  target.applyWetPaint(new WetPaintStroke({precision:'float32',opacity:0,brush:new PencilStroke({points:[{x:1000000,y:1000000}]}),tiles:[{...tile,x:1000000,y:1000000,coverage:{assetId:bad.assetId}}]}));target.visible=false;const malformed=await serializeProject(editor.document.toJSON(),editor.assetStore);editor.document.undo();editor.document.undo();const before=JSON.stringify(editor.document.toJSON()),assets=editor.assetStore;let rejected='';try{await editor.openProject(new File([malformed],'Invalid inert HDR.luma'));}catch(error){rejected=String(error);}return {rejected,unchanged:before===JSON.stringify(editor.document.toJSON()),sameAssets:assets===editor.assetStore};
 },[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);expect(result.rejected).toMatch(/already be masked/);expect(result).toMatchObject({unchanged:true,sameAssets:true});
});
