import {test,expect}from '@playwright/test';
import {readFile,writeFile}from 'node:fs/promises';
import {spawnSync}from 'node:child_process';

const root='tests/fixtures/psd/clipping/';
const manifest=JSON.parse(await readFile(root+'manifest.json','utf8'))as{cases:{name:string;file:string;reference:string;editable:boolean}[]};
for(const item of manifest.cases)test(`Photoshop ${item.name} uses verified clipping admission, native pixels and portable edits`,async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async({input,reference,editable})=>{
  const{editor}=window.luma;await editor.openPsd(new Uint8Array(input));
  const doc=editor.document,before=doc.toJSON(),png=await editor.exportPng();
  async function pixels(blob:Blob){const image=await createImageBitmap(blob),c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext('2d')!;try{ctx.drawImage(image,0,0);return ctx.getImageData(0,0,c.width,c.height).data;}finally{image.close();c.width=c.height=0;}}
  const a=await pixels(png),b=await pixels(new Blob([new Uint8Array(reference)],{type:'image/png'}));let rgb=0,alpha=0;
  for(let i=0;i<a.length;i+=4){alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));for(let c=0;c<3;c++)rgb=Math.max(rgb,Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255));}
  const assets=await Promise.all(editor.assetStore.values().map(async asset=>({id:asset.id,width:asset.width,height:asset.height,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer()))]})));
  let reversible=true,oneUndo=true,releaseChanges=true;
  if(editable){const scope=doc.layers.at(1)?.kind==='group'?(doc.layers.at(1)as InstanceType<typeof window.luma.LayerGroup>).layers:doc.layers,member=scope.at(scope.length-1)!,past=doc.getSnapshot().past.length;member.clipped=false;oneUndo=doc.getSnapshot().past.length===past+1;const released=await pixels(await editor.exportPng());releaseChanges=released.some((value,i)=>value!==a[i]);doc.undo();reversible=JSON.stringify(doc.toJSON())===JSON.stringify(before);}
  const outputs:Record<string,number[]>={},reports=[];
  for(const format of ['psd','psb']as const){if(format==='psd'&&doc.width>30000)continue;const result=await editor.export({format});outputs[format]=[...new Uint8Array(await result.blob.arrayBuffer())];reports.push(result.report);}
  const names=before.children.map(layer=>layer.name),visibility=before.children.map(layer=>layer.visible),clipping=before.children.map(layer=>!!layer.clipped),project=await editor.saveProject();
  await editor.openPsd(new Uint8Array(outputs.psd??outputs.psb));const roundtrip=await pixels(await editor.exportPng());let roundtripError=0;for(let i=0;i<a.length;i++)roundtripError=Math.max(roundtripError,Math.abs(a[i]-roundtrip[i]));
  await editor.openProject(new File([project],'clipping-import.luma'));
  const retained=await Promise.all(editor.assetStore.values().map(async asset=>({id:asset.id,width:asset.width,height:asset.height,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer()))]})));
  return{before,rgb,alpha,roundtripError,reversible,oneUndo,releaseChanges,projectExact:JSON.stringify(editor.document.toJSON())===JSON.stringify(before),assetsExact:JSON.stringify(assets)===JSON.stringify(retained),png:[...new Uint8Array(await png.arrayBuffer())],project:[...new Uint8Array(await project.arrayBuffer())],outputs,reports,names,visibility,clipping};
 },{input:[...await readFile(root+item.file)],reference:[...await readFile(root+item.reference)],editable:item.editable});
 await writeFile(info.outputPath('runtime.json'),JSON.stringify({...result,png:undefined,project:undefined,outputs:undefined},null,2));
 expect(result.rgb).toBeLessThanOrEqual(3);expect(result.alpha).toBe(0);expect(result.roundtripError).toBeLessThanOrEqual(3);expect(result.reversible).toBe(true);expect(result.oneUndo).toBe(true);if(!['hidden'].includes(item.name))expect(result.releaseChanges).toBe(true);expect(result.projectExact).toBe(true);expect(result.assetsExact).toBe(true);
 await writeFile(info.outputPath('native.png'),Buffer.from(result.png));await writeFile(info.outputPath('native.luma'),Buffer.from(result.project));
 const cases=[];for(const[format,bytes]of Object.entries(result.outputs)){const path=info.outputPath('native.'+format);await writeFile(path,Buffer.from(bytes));cases.push({path,reference:info.outputPath('native.png'),format,names:result.names,visibility:result.visibility,clipping:result.clipping});}
 const path=info.outputPath('independent-cases.json');await writeFile(path,JSON.stringify(cases));const checked=spawnSync(process.env.CANOLI_PSB_PYTHON??'python3',['scripts/check-photoshop-export.py',path],{encoding:'utf8',timeout:120000});await writeFile(info.outputPath('independent.json'),checked.stdout);expect(checked.status,checked.stderr||checked.stdout).toBe(0);
});

test('authored soft clipping exports retain member masks, rendered effects and grouped blend/opacity across independent recomposition',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const outputs=await page.evaluate(async()=>{
  const{editor,RasterLayer,PaintLayer,PaintFill,LayerStyle,LayerMask,MarqueeSelection}=window.luma,outputs=[];
  for(const mode of ['normal','multiply','screen']as const)for(const memberMode of ['normal','multiply','screen','overlay']as const){
   editor.newDocument({width:40,height:24});const d=editor.document,background=d.layers.add(new PaintLayer({name:'Backdrop'}));background.strokes.add(new PaintFill({bounds:{x:0,y:0,width:40,height:24},color:'#d0b090'}));
   const canvas=new OffscreenCanvas(24,16),ctx=canvas.getContext('2d')!,image=ctx.createImageData(24,16);for(let i=0;i<image.data.length;i+=4)image.data.set([192,64,128,[0,64,128,255][i/4%4]],i);ctx.putImageData(image,0,0);const blob=await canvas.convertToBlob(),asset=await editor.assetStore.add(blob,'Soft original',undefined,false),base=d.layers.add(new RasterLayer({name:'Soft base',assetId:asset.id,width:24,height:16,x:4,y:3,blendMode:mode,opacity:128/255}));
   base.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:2,y:2,width:32,height:18}),linked:false});
   const member=d.layers.add(new PaintLayer({name:'Masked member',clipped:true,blendMode:memberMode,opacity:128/255}));member.strokes.add(new PaintFill({bounds:{x:0,y:0,width:40,height:24},color:'#30c060'}));member.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:0,y:0,width:32,height:24}),linked:false});
   const style=d.layers.add(new PaintLayer({name:'Styled member',clipped:true,fillOpacity:.5}));style.strokes.add(new PaintFill({bounds:{x:8,y:8,width:8,height:8},color:'#0000ff'}));style.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#c04020',opacity:.5},dropShadow:{enabled:true,color:'#000000',opacity:.5,x:1,y:1,blur:1}});
   const hidden=d.layers.add(new PaintLayer({name:'Hidden member',clipped:true,visible:false}));hidden.strokes.add(new PaintFill({bounds:{x:0,y:0,width:40,height:24},color:'#ff0000'}));
   const original=JSON.stringify(d.toJSON()),png=await editor.exportPng(),key=mode+'-'+memberMode;
   for(const format of ['psd','psb']as const){const result=await editor.export({format});outputs.push({key,format,png:[...new Uint8Array(await png.arrayBuffer())],file:[...new Uint8Array(await result.blob.arrayBuffer())],unchanged:JSON.stringify(d.toJSON())===original,roundtripError:0,roundtripLayers:0,report:result.report});}
   await editor.openPsd(new Uint8Array(outputs.at(-1)!.file));
   const read=async(blob:Blob)=>{const image=await createImageBitmap(blob),canvas=new OffscreenCanvas(40,24),ctx=canvas.getContext('2d')!;try{ctx.drawImage(image,0,0);return ctx.getImageData(0,0,40,24).data;}finally{image.close();canvas.width=canvas.height=0;}},a=await read(png),b=await read(await editor.exportPng());let error=0;for(let i=0;i<a.length;i++)error=Math.max(error,Math.abs(a[i]-b[i]));for(const output of outputs.slice(-2)){output.roundtripError=error;output.roundtripLayers=editor.document.layers.length;}
  }
  return outputs;
 });
 const cases=[];for(const output of outputs){expect(output.unchanged).toBe(true);expect(output.roundtripError).toBeLessThanOrEqual(3);expect(output.roundtripLayers).toBe(5);expect(output.report.featuresPreserved.join(' ')).toContain('Editable sibling pixel clipping');const path=info.outputPath(output.key+'.'+output.format),reference=info.outputPath(output.key+'.png');await writeFile(path,Buffer.from(output.file));await writeFile(reference,Buffer.from(output.png));cases.push({path,reference,format:output.format,names:['Backdrop','Soft base','Masked member','Styled member','Hidden member'],visibility:[true,true,true,true,false],clipping:[false,false,true,true,true]});}
 const path=info.outputPath('independent-cases.json');await writeFile(path,JSON.stringify(cases));const checked=spawnSync(process.env.CANOLI_PSB_PYTHON??'python3',['scripts/check-photoshop-export.py',path],{encoding:'utf8',timeout:120000});await writeFile(info.outputPath('independent.json'),checked.stdout);expect(checked.status,checked.stderr||checked.stdout).toBe(0);
});
