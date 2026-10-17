import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { sourcePng } from './png-fixture';

for (const mode of ['evenodd', 'nonzero-filled', 'nonzero-hole', 'islands', 'curves', 'gradient-affine', 'dashes'] as const)
test(`native compound ${mode} preserves independent Canvas coverage and SVG/project geometry`, async ({page}) => {
 await page.goto('/');
 const result=await page.evaluate(async mode=>{
  const {editor,VectorLayer,VectorPath,VectorContour,LayerGroup,AffineTransform}=window.luma;
  editor.newDocument({width:160,height:128});
  const outer='M16 16H112V112H16Z',inner=mode==='nonzero-hole'?'M40 40V88H88V40Z':mode==='curves'?'M40 64C40 32 88 32 88 64C88 96 40 96 40 64Z':'M40 40H88V88H40Z',island='M128 32H152V96H128Z';
  const rule=mode.startsWith('nonzero')?'nonzero':'evenodd',group=editor.document.layers.add(new LayerGroup()),layer=group.layers.add(new VectorLayer());
  const p=layer.paths.add(VectorPath.fromSvgPath(outer,{fill:'#ff0000',stroke:mode==='dashes'?'#00ff00':null,strokeWidth:4,strokeDashArray:mode==='dashes'?[8,4]:[],fillRule:rule}));
  p.subpaths.add(new VectorContour({points:VectorPath.fromSvgPath(inner).points}));
  if(mode==='islands')p.subpaths.add(new VectorContour({points:VectorPath.fromSvgPath(island).points}));
  const expected=document.createElement('canvas');expected.width=160;expected.height=128;const c=expected.getContext('2d')!;
  if(mode==='gradient-affine'){
   group.transform=new AffineTransform(.8,.1,-.1,.8,14,10);c.setTransform(.8,.1,-.1,.8,14,10);
   p.fillGradient={kind:'linear',start:{x:0,y:0},end:{x:160,y:0},transform:{a:1,b:.2,c:.3,d:1,e:4,f:0},stops:[{position:0,color:'#ff0000',opacity:.5},{position:1,color:'#0000ff'}]};
  }
  const d=outer+' '+inner+(mode==='islands'?' '+island:''),geometry=new Path2D(d);c.fillStyle='#ff0000';
  if(mode==='gradient-affine'){c.save();c.beginPath();c.rect(16,16,96,96);c.rect(40,40,48,48);c.transform(1,.2,.3,1,4,0);const g=c.createLinearGradient(0,0,160,0);g.addColorStop(0,'rgba(255,0,0,.5)');g.addColorStop(1,'#0000ff');c.fillStyle=g;c.fill(rule);c.restore();}
  else c.fill(geometry,rule);
  if(mode==='dashes'){c.strokeStyle='#00ff00';c.lineWidth=4;c.lineCap=c.lineJoin='round';c.setLineDash([8,4]);c.stroke(geometry);}
  async function pixels(blob:Blob){const b=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.drawImage(b,0,0);b.close();return ctx.getImageData(0,0,160,128).data;}
  const reference=c.getImageData(0,0,160,128).data,native=await pixels(await editor.exportPng()),{compareImportPixels}=await import(/* @vite-ignore */String('/tests/svg-import-pixels.ts')),metrics=compareImportPixels(reference,native,160,128);let alpha=0,premult=0,coverage=0;
  const mask=document.createElement('canvas');mask.width=160;mask.height=128;const m=mask.getContext('2d')!;if(mode==='gradient-affine')m.setTransform(.8,.1,-.1,.8,14,10);m.fillStyle='#ffffff';m.fill(geometry,rule);const coverageMask=m.getImageData(0,0,160,128).data;let interior=0;
  for(let y=1;y<127;y++)for(let x=1;x<159;x++){let inside=true;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(coverageMask[((y+dy)*160+x+dx)*4+3]!==255)inside=false;if(inside){const i=(y*160+x)*4;interior=Math.max(interior,Math.abs(reference[i+3]-native[i+3]));for(let ch=0;ch<3;ch++)interior=Math.max(interior,Math.abs(reference[i+ch]*reference[i+3]/255-native[i+ch]*native[i+3]/255));}}
  for(let i=0;i<native.length;i+=4){coverage+=native[i+3];alpha=Math.max(alpha,Math.abs(native[i+3]-reference[i+3]));for(let j=0;j<3;j++)premult=Math.max(premult,Math.abs(native[i+j]*native[i+3]/255-reference[i+j]*reference[i+3]/255));}
  const saved=JSON.stringify(editor.document.toJSON()),project=await editor.saveProject();await editor.openProject(new File([project],'Compound.luma'));const reopened=JSON.stringify(editor.document.toJSON())===saved,svg=await editor.export({format:'svg'}),xml=await svg.blob.text(),inspection=await editor.inspectSvg(new File([svg.blob],'Compound.svg'));await editor.openSvg(new File([svg.blob],'Compound.svg'));const roundtrip=await pixels(await editor.exportPng());
  return{mode,alpha,premult,interior,...metrics,coverage,reopened,editable:inspection.canImportEditable,svgNoMask:!xml.includes('<mask'),roundtrip:roundtrip.every((v,i)=>v===native[i]),center:Array.from(native.slice((64*160+64)*4,(64*160+64)*4+4)),island:Array.from(native.slice((64*160+140)*4,(64*160+140)*4+4))};
 },mode);
 await writeFile(`/tmp/canoli-vector-compound-${mode}.json`,JSON.stringify(result,null,2)+'\n');
 expect(result.reopened).toBe(true);expect(result.editable).toBe(true);expect(result.svgNoMask).toBe(true);expect(result.roundtrip,JSON.stringify(result)).toBe(true);expect(result.coverage).toBeGreaterThan(500000);expect(result.alpha,JSON.stringify(result)).toBeLessThanOrEqual(mode==='gradient-affine'?8:2);expect(result.premult,JSON.stringify(result)).toBeLessThanOrEqual(mode==='gradient-affine'?8:2);expect(result.interior,JSON.stringify(result)).toBeLessThanOrEqual(2);expect(result.interiorErrors).toBe(0);expect(result.contourErrors).toBe(0);expect(result.areaError).toBeLessThan(.001);expect(result.centroidError).toBeLessThan(.01);
 if(mode!=='gradient-affine')expect(result.center[3]).toBe(mode==='nonzero-filled'?255:0);
 if(mode==='islands')expect(result.island).toEqual([255,0,0,255]);
});

test('Pen edits inner anchors and handles with previews, Escape, shared styling, undo and locks',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.evaluate(()=>{
  const{editor,VectorLayer,VectorPath,VectorContour}=window.luma;editor.newDocument({width:400,height:300});const layer=editor.document.layers.add(new VectorLayer({name:'Compound'})),p=layer.paths.add(VectorPath.rectangle({x:20,y:20,width:340,height:250},0,{fill:'#ff0000',fillRule:'evenodd',stroke:null}));p.subpaths.add(new VectorContour({points:VectorPath.rectangle({x:100,y:90,width:100,height:100}).points}));p.subpaths.at(0)!.setPoint(0,{out:{x:140,y:70}});editor.document.selectedLayer=layer;
 });
 await page.getByRole('button',{name:'Vector pen (P)',exact:true}).click();await page.keyboard.press('Control+1');
 const read=()=>page.evaluate(()=>{const doc=window.luma.editor.document,layer=doc.selectedLayer as InstanceType<typeof window.luma.VectorLayer>;return{data:layer.paths.at(0)!.toJSON(),history:doc.getSnapshot().past.length};});
 const before=await read(),box=(await page.locator('.canvas-wrap').boundingBox())!;
 await page.mouse.move(box.x+100,box.y+90);await page.mouse.down();await page.mouse.move(box.x+110,box.y+100,{steps:4});expect(await read()).toEqual(before);await page.keyboard.press('Escape');await page.mouse.up();expect(await read()).toEqual(before);
 await page.mouse.move(box.x+100,box.y+90);await page.mouse.down();await page.mouse.move(box.x+110,box.y+100,{steps:4});await page.mouse.up();const moved=await read();expect(moved.data.points).toEqual(before.data.points);expect(moved.data.subpaths![0].points[0]).toMatchObject({x:110,y:100,out:{x:150,y:80}});expect(moved.history).toBe(before.history+1);
 await page.mouse.move(box.x+150,box.y+80);await page.mouse.down();await page.mouse.move(box.x+160,box.y+65,{steps:4});await page.mouse.up();expect((await read()).data.subpaths![0].points[0].out).toEqual({x:160,y:65});
 await page.keyboard.press('Control+z');expect((await read()).data).toEqual(moved.data);await page.keyboard.press('Control+z');expect((await read()).data).toEqual(before.data);
 await expect(page.getByLabel('Closed path',{exact:true})).toBeDisabled();await page.getByLabel('Path fill rule',{exact:true}).selectOption('nonzero');expect((await read()).data.fillRule).toBe('nonzero');await page.keyboard.press('Control+z');expect((await read()).data.fillRule).toBe('evenodd');
 await page.getByText('2 editable contours',{exact:true}).click();await page.getByRole('button',{name:'Remove contour 2',exact:true}).click();expect((await read()).data.subpaths).toHaveLength(0);await page.keyboard.press('Control+z');expect((await read()).data).toEqual(before.data);await page.getByText('2 editable contours',{exact:true}).click();
 await page.screenshot({path:'/tmp/canoli-vector-compound-controls.png'});await page.evaluate(()=>{window.luma.editor.document.selectedLayer!.locked=true;});await expect(page.getByLabel('Path fill rule',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Remove contour 2',exact:true})).toBeDisabled();expect(errors).toEqual([]);await writeFile('/tmp/canoli-vector-compound-ui.json',JSON.stringify({before,moved,errors},null,2)+'\n');
});

test('documented compound constructor runs in the isolated scripting boundary as one undo entry',async({page})=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: vector-compound-paths -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();await page.goto('/');
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Compound ready: 2 contours');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await expect(page.getByLabel('Path fill rule',{exact:true})).toHaveValue('evenodd');await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);
});

test('SVG translucent compound fill and stroke composite independently before element opacity',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{editor}=window.luma,svg='<svg xmlns="http://www.w3.org/2000/svg" width="160" height="128"><path d="M16 16H144V112H16Z M40 40H120V88H40Z" fill-rule="evenodd" fill="red" stroke="blue" stroke-width="4" fill-opacity=".5" stroke-opacity=".5" opacity=".6"/></svg>',file=new File([svg],'Translucent.svg',{type:'image/svg+xml'}),report=await editor.inspectSvg(file);await editor.openSvg(file);
  async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);try{image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,160,128).data;}finally{URL.revokeObjectURL(url);}}
  const source=await pixels(file),native=await pixels(await editor.exportPng());let alpha=0,premult=0;for(let i=0;i<source.length;i+=4){alpha=Math.max(alpha,Math.abs(source[i+3]-native[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(source[i+c]*source[i+3]/255-native[i+c]*native[i+3]/255));}
  return{alpha,premult,overlap:[...native.slice((64*160+17)*4,(64*160+17)*4+4)],hole:[...native.slice((64*160+80)*4,(64*160+80)*4+4)],degraded:report.featuresDegraded};
 });expect(result.alpha,JSON.stringify(result)).toBeLessThanOrEqual(2);expect(result.premult,JSON.stringify(result)).toBeLessThanOrEqual(2);expect(result.overlap[3]).toBeGreaterThanOrEqual(114);expect(result.overlap[3]).toBeLessThanOrEqual(116);expect(result.hole).toEqual([0,0,0,0]);expect(result.degraded.join(' ')).toContain('independent editable fill/stroke layers');await writeFile('/tmp/canoli-vector-compound-translucent.json',JSON.stringify(result,null,2)+'\n');
});

test('50 MP compound holes and disconnected islands persist with original source bytes across tile seams',async({page})=>{
 await page.goto('/');const buffer=await sourcePng(10000,5000);await page.getByTestId('import-input').setInputFiles({name:'Compound source.png',mimeType:'image/png',buffer});await expect(page.locator('.layer-row')).toHaveCount(1);
 const result=await page.evaluate(async()=>{
  const{editor,VectorLayer,VectorPath,VectorContour}=window.luma,source=editor.assetStore.values()[0],original=new Uint8Array(await source.blob.arrayBuffer()),layer=editor.document.layers.add(new VectorLayer()),p=layer.paths.add(VectorPath.rectangle({x:0,y:0,width:9000,height:5000},0,{fill:'#ff0000',stroke:null,fillRule:'evenodd'}));
  p.subpaths.add(new VectorContour({points:VectorPath.rectangle({x:2047,y:0,width:2,height:5000}).points}));p.subpaths.add(new VectorContour({points:VectorPath.rectangle({x:9500,y:0,width:500,height:5000}).points}));
  const geometry=JSON.stringify(editor.document.toJSON()),project=await editor.saveProject();await editor.openProject(new File([project],'50MP compound.luma'));const saved=new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer()),reopened=JSON.stringify(editor.document.toJSON())===geometry,tiles:HTMLCanvasElement[]=[],render=editor.renderer.render.bind(editor.renderer);editor.renderer.render=async(...args)=>{const c=await render(...args);if(args[2]?.readback&&args[2]?.cache===false)tiles.push(c);return c;};let output:Blob;const start=performance.now();try{output=await editor.exportPng();}finally{editor.renderer.render=render;}const elapsed=performance.now()-start,bitmap=await createImageBitmap(output),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d')!,samples=[];for(const x of [0,2046,2047,2048,2049,8999,9000,9499,9500,9999]){c.clearRect(0,0,1,1);c.drawImage(bitmap,x,2048,1,1,0,0,1,1);samples.push([...c.getImageData(0,0,1,1).data]);}const dimensions=[bitmap.width,bitmap.height];bitmap.close();return{elapsed,bytes:output.size,reopened,sourceUnchanged:original.length===saved.length&&original.every((v,i)=>v===saved[i]),dimensions,samples,tiles:tiles.length,released:tiles.every(c=>c.width===0&&c.height===0)};
 });
 await writeFile('/tmp/canoli-vector-compound-50mp.json',JSON.stringify(result,null,2)+'\n');expect(result.reopened).toBe(true);expect(result.sourceUnchanged).toBe(true);expect(result.dimensions).toEqual([10000,5000]);for(let i=0;i<result.samples.length;i++)expect(result.samples[i]).toEqual([2,3,6,7].includes(i)?[40,60,80,255]:[255,0,0,255]);expect(result.tiles).toBe(395);expect(result.released).toBe(true);
});
