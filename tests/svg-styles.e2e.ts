import {test,expect} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';

for(const mode of ['overlay','hard-shadow','soft-shadow','affine-shadow','reflected-shadow','scaled-shadow','zero-fill','vector-mask','native-mask','offcanvas-vector','offcanvas-native','nested','nested-unmasked','nested-mask-only'] as const)test(`SVG ${mode} preserves native effect ordering and placement`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async mode=>{
  const{editor,LayerGroup,VectorLayer,VectorPath,LayerStyle,LayerMask,MarqueeSelection,AffineTransform}=window.luma;
  editor.newDocument({width:160,height:120});const doc=editor.document,group=doc.layers.add(new LayerGroup({x:20,y:15})),layer=group.layers.add(new VectorLayer({x:10,y:5}));
  layer.paths.add(VectorPath.rectangle({x:0,y:0,width:32,height:24},0,{fill:'#804020',stroke:null}));
  const shadow={enabled:mode!=='overlay',color:'#0020ff',opacity:1,x:20,y:12,blur:(['soft-shadow','affine-shadow','reflected-shadow','scaled-shadow','native-mask'].includes(mode)||mode.startsWith('nested'))?4:0};
  layer.styles=new LayerStyle({dropShadow:shadow,colorOverlay:{enabled:true,color:'#2040e0',opacity:0.5}});
  if(mode==='zero-fill'||mode==='affine-shadow'||mode==='reflected-shadow'||mode==='scaled-shadow')layer.fillOpacity=0;
  if(mode==='affine-shadow'){group.transform=new AffineTransform(0,1,-1,0,100,10);layer.transform=new AffineTransform(1,0,0.5,1,10,5);}
  if(mode==='reflected-shadow'){group.transform=new AffineTransform(-1,0,0,1,120,20);layer.transform=new AffineTransform(1,0,0.5,1,10,5);}
  if(mode==='scaled-shadow')group.transform=new AffineTransform(2,0,0,0.5,10,20);
  if(mode==='vector-mask')layer.mask=new LayerMask({paths:[VectorPath.rectangle({x:0,y:0,width:16,height:24})]});
  if(mode==='native-mask')layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:16,height:24}),feather:3.75,density:0.8});

 if(mode.startsWith('offcanvas')){
   group.transform=new AffineTransform();layer.x=-25;layer.y=40;layer.fillOpacity=0;layer.styles=new LayerStyle({dropShadow:{...shadow,x:25,y:0,blur:0}});
   layer.mask=mode==='offcanvas-vector'?new LayerMask({paths:[VectorPath.rectangle({x:0,y:0,width:32,height:24})]}):new LayerMask({base:1});
  }
  if(mode.startsWith('nested')){
   group.opacity=0.8;group.fillOpacity=0.7;layer.fillOpacity=0.6;layer.opacity=0.9;
   if(mode!=='nested-mask-only')group.styles=new LayerStyle({dropShadow:{enabled:true,color:'#20ff00',opacity:0.7,x:-20,y:10,blur:3},colorOverlay:{enabled:true,color:'#ff8000',opacity:0.2}});
   if(mode!=='nested-unmasked')group.mask=new LayerMask({base:0.8,feather:2});
  }
  const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision,exported=await editor.export({format:'svg'}),text=await exported.blob.text(),xml=new DOMParser().parseFromString(text,'image/svg+xml');
  async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,160,120).data;}
  const svg=await pixels(exported.blob),png=await pixels(await editor.exportPng());let maxAlpha=0,maxPremult=0,sum=0,mass=0,mx=0,my=0;const differences=[];
  for(let i=0;i<svg.length;i+=4){mass+=svg[i+3];mx+=((i/4)%160+0.5)*svg[i+3];my+=(Math.floor(i/4/160)+0.5)*svg[i+3];const a=Math.abs(svg[i+3]-png[i+3]);maxAlpha=Math.max(maxAlpha,a);sum+=a;for(let c=0;c<3;c++)maxPremult=Math.max(maxPremult,Math.abs(svg[i+c]*svg[i+3]/255-png[i+c]*png[i+3]/255));if(a>1&&differences.length<10)differences.push({x:(i/4)%160,y:Math.floor(i/4/160),svg:svg[i+3],png:png[i+3]});}
  const coords=[[35,25],[55,37],[75,50],[10,50],[25,50],[120,80]],samples=coords.map(([x,y])=>({x,y,svg:Array.from(svg.slice((y*160+x)*4,(y*160+x)*4+4)),png:Array.from(png.slice((y*160+x)*4,(y*160+x)*4+4))}));
  return{mode,maxAlpha,maxPremult,alphaArea:mass/255,centroid:[mx/mass,my/mass],meanAlpha:sum/(160*120),differences,samples,filters:xml.querySelectorAll('filter').length,images:xml.querySelectorAll('image').length,paths:xml.querySelectorAll('path').length,unchanged:before===JSON.stringify(doc.toJSON()),revision,after:doc.getSnapshot().revision,report:exported.report};
 },mode);await writeFile(`/tmp/canoli-svg-style-${mode}.json`,JSON.stringify(result,null,2)+'\n');
 expect(result.unchanged).toBe(true);expect(result.after).toBe(result.revision);expect(result.filters).toBeGreaterThan(0);
 // Separate 8-bit native surfaces and SVG filter intermediates round differently.
 // Keep simple effects strict; nested masked/opacity chains have at most two
 // alpha levels and 2.5 premultiplied values of fixture-specific error.
 expect(result.maxAlpha,JSON.stringify(result)).toBeLessThanOrEqual(mode.startsWith('nested')?2:1);
 expect(result.maxPremult,JSON.stringify(result)).toBeLessThanOrEqual(mode.startsWith('nested')?2.5:(['native-mask','affine-shadow','reflected-shadow','scaled-shadow'].includes(mode))?2:1.5);
 if(mode==='overlay')expect(result.samples[0].svg).toEqual([80,64,128,255]);
 if(mode==='zero-fill'){expect(result.samples[0].svg[3]).toBe(0);expect(result.samples[2].svg).toEqual([0,32,255,255]);}
 if(mode==='affine-shadow'){expect(Math.abs(result.alphaArea-768)).toBeLessThan(0.2);expect(result.centroid[0]).toBeCloseTo(103,1);expect(result.centroid[1]).toBeCloseTo(54,1);}
 if(mode==='reflected-shadow'||mode==='scaled-shadow'){const target=mode==='reflected-shadow'?[108,49]:[82,40.5];expect(Math.abs(result.alphaArea-768)).toBeLessThan(1);expect(result.centroid[0]).toBeCloseTo(target[0],1);expect(result.centroid[1]).toBeCloseTo(target[1],1);}
 if(mode.startsWith('offcanvas'))expect(result.samples[3].svg).toEqual([0,32,255,255]);
});

test('styled native SVG masks retain their padded coverage across tile seams',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{editor,VectorLayer,VectorPath,LayerStyle,LayerMask,MarqueeSelection}=window.luma;editor.newDocument({width:2100,height:100});
  const layer=editor.document.layers.add(new VectorLayer());layer.paths.add(VectorPath.rectangle({x:-100,y:-100,width:2400,height:400},0,{fill:'#804020',stroke:null}));
  layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:965,y:20,width:70,height:40}).combine(new MarqueeSelection({shape:'ellipse',x:1980,y:20,width:70,height:40}),'add'),feather:3.75,density:0.8});
  layer.styles=new LayerStyle({dropShadow:{enabled:true,color:'#0020ff',opacity:1,x:20,y:12,blur:4},colorOverlay:{enabled:true,color:'#2040e0',opacity:0.5}});
  const blob=(await editor.export({format:'svg'})).blob,xml=new DOMParser().parseFromString(await blob.text(),'image/svg+xml');
  async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=2100;canvas.height=100;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,2100,100).data;}
  const a=await pixels(blob),b=await pixels(await editor.exportPng());let alpha=0,premult=0;
  for(let i=0;i<a.length;i+=4){alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255));}
  return{alpha,premult,tiles:[...xml.querySelectorAll('mask image')].map(image=>({x:Number(image.getAttribute('x')),y:Number(image.getAttribute('y')),width:Number(image.getAttribute('width')),height:Number(image.getAttribute('height'))}))};
 });await writeFile('/tmp/canoli-svg-style-seams.json',JSON.stringify(result,null,2)+'\n');expect(result.tiles.map(t=>t.x)).toEqual([-34,990,2014]);expect(result.tiles.every(t=>t.y===-26)).toBe(true);expect(result.alpha,JSON.stringify(result)).toBeLessThanOrEqual(1);expect(result.premult,JSON.stringify(result)).toBeLessThanOrEqual(2.5);
});

test('documented standalone SVG effects run in the isolated constructor runtime',async({page})=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: standalone-svg-style -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();
 await page.goto('/');const result=await page.evaluate(async source=>{const editor=window.luma.editor,before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,logs=await editor.runScript(source!);return{logs,unchanged:before===JSON.stringify(editor.document.toJSON()),revision,after:editor.document.getSnapshot().revision};},source);
 expect(result.logs.join(' ')).toContain('Styled SVG ready');expect(result.unchanged).toBe(true);expect(result.after).toBe(result.revision);
});
