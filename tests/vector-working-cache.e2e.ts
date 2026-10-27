import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('compact vector working surfaces retain exact pixels across affine grids, masks, styles, gradients and edits',async({page},info)=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const{editor,Document,VectorLayer,VectorPath,VectorContour,LayerGroup,PaintLayer,PaintFill,LayerStyle,LayerMask,MarqueeSelection,AffineTransform}=window.luma;
  const{CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
  const renderer=new CanvasRenderer(),rows=[];
  try{
   for(const mode of ['plain','overlay','shadow','mask','shadow-mask','unlinked-mask','multiply','linear-light','linear-burn','blend-if','fill-opacity','extreme-miter','off-canvas']){
    const doc=new Document({width:640,height:480}),back=doc.layers.add(new PaintLayer());back.strokes.add(new PaintFill({bounds:{x:0,y:0,width:640,height:480},color:'#183858'}));
    const parent=doc.layers.add(new LayerGroup()),layer=parent.layers.add(new VectorLayer({x:140.25,y:96.5,opacity:.63}));
    const compound=layer.paths.add(VectorPath.fromSvgPath('M-24 -12 C-14 -36 28 -28 36 -4 L30 26 L-28 18 Z',{fill:'#e7814b',fillRule:'evenodd',stroke:'#443366',strokeWidth:5.25,strokeJoin:'miter',strokeMiterLimit:12,strokeCap:'square',strokeDashArray:[5,3],strokeDashOffset:-1.5}));
    compound.subpaths.add(new VectorContour({points:[{x:-8,y:-2},{x:12,y:-2},{x:12,y:12},{x:-8,y:12}]}));
    const gradient=layer.paths.add(VectorPath.rectangle({x:38.5,y:-16.25,width:20.75,height:44.5},0,{fill:null,stroke:null,strokeWidth:0}));
    gradient.fillGradient={kind:'linear',start:{x:38,y:-16},end:{x:60,y:28},stops:[{position:0,color:'#ff0000',opacity:.3},{position:1,color:'#0000ff',opacity:.8}],transform:{a:1,b:.2,c:.25,d:.8,e:-4,f:2}};
    if(mode==='extreme-miter')layer.paths.add(VectorPath.fromSvgPath('M20 50L40 0L60 50',{fill:null,stroke:'#ff0000',strokeWidth:8,strokeJoin:'miter',strokeMiterLimit:Number.MAX_SAFE_INTEGER}));
    if(['overlay','shadow','shadow-mask'].includes(mode))layer.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#3355e0',opacity:.4},dropShadow:{enabled:mode!=='overlay',color:'#443366',opacity:.65,blur:3.7,x:-8.25,y:11.75}});
    if(['mask','shadow-mask','unlinked-mask'].includes(mode))layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:-20,y:-16,width:74,height:46}),feather:2.5,inverted:mode==='unlinked-mask',linked:mode!=='unlinked-mask',density:.7});
    if(mode==='multiply'||mode==='linear-light'||mode==='linear-burn')layer.blendMode=mode;if(mode==='blend-if')layer.styles=new LayerStyle({blendIf:{enabled:true,source:[0,40,210,255],underlying:[0,80,200,255]}});if(mode==='fill-opacity')layer.fillOpacity=.45;if(mode==='off-canvas'){layer.x=-14.25;layer.y=-8.5;}
    for(const affine of [0,1,2]){
     parent.transform=affine===2?new AffineTransform(-.91,-.22,-.15,1.07,330.3,40.4):affine===1?new AffineTransform(.91,.22,-.15,1.07,.3,-.4):new AffineTransform();
     for(const options of [{},{outputSize:{width:320,height:240}},{region:{x:101.25,y:42.5,width:240,height:180},scale:.625}]){
      renderer.clearCache();const snapshot=doc.getSnapshot().document,before=JSON.stringify(snapshot),read=async(cache:boolean)=>{const canvas=await renderer.render(snapshot,editor.assetStore,{...options,cache});try{return{width:canvas.width,height:canvas.height,data:canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data};}finally{canvas.width=canvas.height=0;}};
      await read(true);const cached=await read(true),fresh=await read(false);let max=0,different=0;for(let i=0;i<fresh.data.length;i++){const delta=Math.abs(fresh.data[i]-cached.data[i]);max=Math.max(max,delta);if(delta)different++;}
      if(JSON.stringify(doc.getSnapshot().document)!==before)throw new Error('Rendering changed authored vector data');rows.push({mode,affine,options,width:fresh.width,height:fresh.height,max,different,retainedBytes:renderer.cache.byteLength});
     }
    }
   }
   return rows;
  }finally{renderer.dispose();}
 });
 await writeFile(info.outputPath('vector-working-pixels.json'),JSON.stringify(result,null,2));expect(result).toHaveLength(117);expect(result.every(r=>r.max===0),JSON.stringify(result.filter(r=>r.max))).toBe(true);
});

test('64 small vector layers retain compact pixels without cache thrashing or changing the rendered document',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{editor,Document,VectorLayer,VectorPath}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts')),renderer=new CanvasRenderer(),doc=new Document({width:800,height:600});
  for(let i=0;i<64;i++){const layer=new VectorLayer({x:30+i%8*90,y:30+Math.floor(i/8)*65});for(let j=0;j<32;j++)layer.paths.add(VectorPath.rectangle({x:j%8*2,y:Math.floor(j/8)*3,width:3,height:3},0,{fill:'#2468ac',stroke:null,strokeWidth:0}));doc.layers.add(layer);}
  const read=async(cache:boolean)=>{const canvas=await renderer.render(doc.getSnapshot().document,editor.assetStore,{cache});try{return canvas.getContext('2d')!.getImageData(0,0,800,600).data;}finally{canvas.width=canvas.height=0;}};
  try{const first=await read(true),bytes=renderer.cache.byteLength,second=await read(true),fresh=await read(false);return{retainedBytes:bytes,stableBytes:renderer.cache.byteLength,layers:64,paths:2048,exact:first.every((v:number,i:number)=>v===second[i]&&v===fresh[i])};}finally{renderer.dispose();}
 });expect(result.exact).toBe(true);expect(result.retainedBytes).toBeGreaterThan(0);expect(result.retainedBytes).toBeLessThan(2*1024*1024);expect(result.stableBytes).toBe(result.retainedBytes);await writeFile(info.outputPath('vector-cache-budget.json'),JSON.stringify(result,null,2));
});

test('mutable Pen geometry and same-ID replacement cannot reuse stale compact vector bounds',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{editor,Document,VectorLayer,VectorPath}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts')),renderer=new CanvasRenderer(),doc=new Document({width:300,height:200}),layer=doc.layers.add(new VectorLayer({x:40,y:30}));layer.paths.add(VectorPath.rectangle({x:0,y:0,width:20,height:10},0,{fill:'#2468ac',stroke:null,strokeWidth:0}));
  const mutable=doc.toJSON(),node=mutable.children[0];if(node.kind!=='vector')throw new Error('Missing vector');Object.freeze(node.paths);const rows=[];
  try{for(const shift of [0,70,130]){for(const point of node.paths[0].points){point.x+=shift;point.in.x+=shift;point.out.x+=shift;}const a=await renderer.render(mutable,editor.assetStore,{cache:true}),b=await renderer.render(mutable,editor.assetStore,{cache:false});try{const x=a.getContext('2d')!.getImageData(0,0,300,200).data,y=b.getContext('2d')!.getImageData(0,0,300,200).data;rows.push(x.every((v:number,i:number)=>v===y[i]));}finally{a.width=a.height=b.width=b.height=0;}}return rows;}finally{renderer.dispose();}
 });expect(result).toEqual([true,true,true]);await writeFile(info.outputPath('vector-mutable-bounds.json'),JSON.stringify(result));
});

import {vectorWorkingWorkflow} from './helpers/vector-working-cache';
test('dense vector movement preserves actual native pixels, complete editable paths, one Undo and project reopening',async({page},info)=>{await vectorWorkingWorkflow(page,info);});

test('50 MP native affine vector output preserves every original source byte through project reopening',async({page},info)=>{
 const original=await import('node:fs/promises').then(fs=>fs.readFile('tests/fixtures/raw/native-50mp.png'));await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/raw/native-50mp.png');await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.width===10000&&!!window.luma.editor.document.layers.at(0))).toBe(true);
 await page.evaluate(()=>{const{editor,VectorLayer,VectorPath,LayerGroup,AffineTransform}=window.luma,parent=editor.document.layers.add(new LayerGroup({name:'Affine native vectors'}));parent.transform=new AffineTransform(0,1,-1,0,2216,2024);const layer=parent.layers.add(new VectorLayer({name:'Original vector geometry'}));layer.paths.add(VectorPath.rectangle({x:0,y:0,width:600,height:200},0,{fill:'#2468ac',stroke:null,strokeWidth:0}));editor.document.selectedLayer=layer;});
 const{historyProject,historyPng}=await import('./helpers/history-inspector'),project=await historyProject(page,info,'vector-cache-50mp.luma');await page.reload();await page.getByTestId('project-input').setInputFiles(project.path);await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.width)).toBe(10000);await historyPng(page,info,'vector-cache-50mp.png');const actual=await page.evaluate(async()=>{const{editor}=window.luma,asset=editor.assetStore.values().find(a=>a.width===10000&&a.height===5000)!;return{document:editor.document.toJSON(),source:[...new Uint8Array(await asset.blob.arrayBuffer())]};});expect(actual.document).toEqual(project.value.document);expect(Buffer.from(actual.source)).toEqual(original);await writeFile(info.outputPath('vector-cache-50mp.json'),JSON.stringify({dimensions:[10000,5000],sourceBytes:original.length,geometryUnchanged:true,referenceRectangle:{x:2016,y:2024,width:200,height:600,color:'#2468ac'}},null,2));
});
