import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';

for(const mode of ['plain','multiline','whitespace','center','right','rtl-left','rtl-right','bidi','affine','bold','italic','tracking','escaped','reflection','scale','masked-style','zero-fill','color','fallback'] as const)test(`SVG editable text ${mode} retains measured placement and native appearance`,async({page})=>{
 await page.goto('/');await page.evaluate(()=>document.fonts.ready);
 const result=await page.evaluate(async mode=>{
  const{editor,TextLayer,LayerGroup,LayerStyle,LayerMask,MarqueeSelection,AffineTransform,VectorLayer,VectorPath}=window.luma;editor.newDocument({width:400,height:220});
  const group=editor.document.layers.add(new LayerGroup({x:20,y:18})),text=group.layers.add(new TextLayer({text:'Canoli ffi 123',fontFamily:'monospace',fontSize:24,color:'#4070a0',x:10,y:12,lineHeight:1.35}));
  if(mode==='multiline')text.text='First\n\nThird';
  if(mode==='whitespace')text.text='  A  B\tC\r D  ';
  if(mode==='center')text.align='center';if(mode==='right')text.align='right';
  if(mode==='rtl-left'||mode==='rtl-right'){text.text='مرحبا بالعالم';text.direction='rtl';text.align=mode==='rtl-left'?'left':'right';}
  if(mode==='bidi'){text.text='אבג ABC 123';text.direction='rtl';text.align='center';}
  if(mode==='affine'){group.transform=new AffineTransform(1,0.1,0.25,1,20,18);text.fontWeight='bold';text.fontStyle='italic';text.letterSpacing=2;}
  if(mode==='masked-style'||mode==='zero-fill'){
   text.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:10,y:10,width:170,height:42}),feather:2.5,density:0.8});text.styles=new LayerStyle({dropShadow:{enabled:true,color:'#0000ff',opacity:0.7,x:12,y:6,blur:2},colorOverlay:{enabled:true,color:'#ff0040',opacity:0.3}});group.opacity=0.8;text.fillOpacity=mode==='zero-fill'?0:0.7;
  }
  if(mode==='bold')text.fontWeight='bold';if(mode==='italic')text.fontStyle='italic';if(mode==='tracking')text.letterSpacing=2;if(mode==='escaped')text.text='A <script> & \"B\" 🙂';if(mode==='reflection')group.transform=new AffineTransform(-1,0.1,0.25,1,290,18);if(mode==='scale')group.transform=new AffineTransform(1.5,0,0,0.75,20,18);
  if(mode==='fallback')text.fontFamily='"Canoli Missing SVG Family", monospace';if(mode==='color')text.color='rgba(40, 80, 160, 0.6)';
  const vector=editor.document.layers.add(new VectorLayer());vector.paths.add(VectorPath.rectangle({x:320,y:170,width:20,height:20},0,{fill:'#ff0000',stroke:null}));
  const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,exported=await editor.export({format:'svg'}),xml=new DOMParser().parseFromString(await exported.blob.text(),'image/svg+xml');
  async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=400;canvas.height=220;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,400,220).data;}
  const svg=await pixels(exported.blob),png=await pixels(await editor.exportPng());let alpha=0,premult=0,alphaSum=0,svgArea=0,pngArea=0,solidMisses=0,svgX=0,svgY=0,pngX=0,pngY=0,textSvgArea=0,textPngArea=0;
  for(let i=0;i<svg.length;i+=4){const diff=Math.abs(svg[i+3]-png[i+3]);alpha=Math.max(alpha,diff);alphaSum+=diff;if((svg[i+3]===0&&png[i+3]===255)||(svg[i+3]===255&&png[i+3]===0))solidMisses++;svgArea+=svg[i+3];pngArea+=png[i+3];if(i/4<400*150){const x=(i/4)%400,y=Math.floor(i/4/400);textSvgArea+=svg[i+3];textPngArea+=png[i+3];svgX+=x*svg[i+3];svgY+=y*svg[i+3];pngX+=x*png[i+3];pngY+=y*png[i+3];}for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(svg[i+c]*svg[i+3]/255-png[i+c]*png[i+3]/255));}
  let displacedPixels=0;
  if(['affine','reflection','scale'].includes(mode))for(const [a,b] of [[svg,png],[png,svg]])for(let y=0;y<150;y++)for(let x=0;x<400;x++){
   if(a[(y*400+x)*4+3]<16||b[(y*400+x)*4+3]>=16)continue;let near=false;for(let yy=Math.max(0,y-1);yy<=Math.min(219,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(399,x+1);xx++)if(b[(yy*400+xx)*4+3]>=16)near=true;if(!near)displacedPixels++;
  }
  const holder=document.createElement('div');holder.style.cssText='position:fixed;left:-10000px;top:0';holder.innerHTML=await exported.blob.text();document.body.append(holder);const nodes=[...holder.querySelectorAll<SVGTextElement>('text')],measure=document.createElement('canvas').getContext('2d')!;measure.font=`${text.fontStyle??'normal'} ${text.fontWeight??'normal'} ${text.fontSize}px ${text.fontFamily}`;measure.letterSpacing=`${text.letterSpacing??0}px`;measure.direction=text.direction??'ltr';const geometry=nodes.map((node,i)=>({length:node.getComputedTextLength(),nativeAdvance:measure.measureText(text.text.split('\n')[i]).width,matrix:Array.from([node.getCTM()!.a,node.getCTM()!.b,node.getCTM()!.c,node.getCTM()!.d,node.getCTM()!.e,node.getCTM()!.f]),box:{x:node.getBBox().x,y:node.getBBox().y,width:node.getBBox().width,height:node.getBBox().height}}));holder.remove();
  return{mode,alpha,premult,solidMisses,displacedPixels,geometry,textAreaRatio:textSvgArea/textPngArea,centroidDelta:[svgX/textSvgArea-pngX/textPngArea,svgY/textSvgArea-pngY/textPngArea],meanAlpha:alphaSum/(400*220),svgArea,pngArea,lines:[...xml.querySelectorAll('text')].map(node=>({text:node.textContent,y:Number(node.getAttribute('y')),anchor:node.getAttribute('text-anchor'),direction:node.getAttribute('direction')})),paths:xml.querySelectorAll('svg > g path').length,images:xml.querySelectorAll('defs > image').length,parserErrors:xml.querySelectorAll('parsererror').length,unchanged:before===JSON.stringify(editor.document.toJSON()),revision,after:editor.document.getSnapshot().revision,report:exported.report};
 },mode);await writeFile(`/tmp/canoli-svg-text-${mode}.json`,JSON.stringify(result,null,2)+'\n');expect(result.unchanged).toBe(true);expect(result.after).toBe(result.revision);expect(result.parserErrors).toBe(0);expect(result.images).toBe(0);expect(result.paths).toBe(1);expect(result.lines).toHaveLength(mode==='multiline'?3:1);expect(result.solidMisses).toBe(0);
 if(['affine','reflection','scale'].includes(mode)){
  // Independent placement/advance and integrated coverage constrain geometry;
  // SVG and Canvas hint transformed outlines differently in this Chromium.
  const matrix=mode==='affine'?[1,0.1,0.25,1,33,31]:mode==='reflection'?[-1,0.1,0.25,1,283,31]:[1.5,0,0,0.75,35,27];for(let i=0;i<6;i++)expect(result.geometry[0].matrix[i]).toBeCloseTo(matrix[i],5);
  expect(Math.abs(result.geometry[0].length-result.geometry[0].nativeAdvance)).toBeLessThan(0.125);expect(Math.abs(result.textAreaRatio-1),JSON.stringify(result)).toBeLessThan(0.003);expect(result.displacedPixels).toBe(0);for(const delta of result.centroidDelta)expect(Math.abs(delta),JSON.stringify(result)).toBeLessThan(0.125);expect(result.meanAlpha).toBeLessThan(0.1);
 }else{expect(result.alpha,JSON.stringify(result)).toBeLessThanOrEqual(2);expect(result.premult,JSON.stringify(result)).toBeLessThanOrEqual(3);}
});

for(const action of ['cancel','font-add','font-remove','unrelated-font','encoding-change','pending-font','font-descriptor','escaped-family','host-edit'] as const)test(`SVG text preparation ${action} respects font lifetime, history and cleanup`,async({page})=>{
 const bytes=await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'),font=[...bytes];let resume=()=>{};
 if(action==='pending-font'){const gate=new Promise<void>(resolve=>{resume=resolve;});await page.route('**/pending-svg-font.woff2',async route=>{await gate;await route.fulfill({body:bytes,contentType:'font/woff2'});});}
 await page.goto('/');
 const result=await page.evaluate(async({action,font})=>{
  const{TextLayer}=window.luma,{EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts')),editor:typeof window.luma.editor=new EditorApplication();editor.newDocument({width:400,height:220});
  const family='Canoli SVG Text Fixture',face=action==='pending-font'?new FontFace(family,'url("/pending-svg-font.woff2")'):new FontFace(family,new Uint8Array(font));if(action==='pending-font')void face.load().catch(()=>{});else await face.load();document.fonts.add(face);const initialFontStatus=face.status;
  const many=Array(3000).fill('x').join('\n'),text=editor.document.layers.add(new TextLayer({text:action==='encoding-change'||action==='pending-font'?'Hello':many,fontFamily:action==='escaped-family'?'"Canoli\\20 SVG Text Fixture", monospace':`"${family}", monospace`,fontSize:18}));
  const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,abort=new AbortController(),surfaces:HTMLCanvasElement[]=[],create=document.createElement.bind(document),replacement=new FontFace(action==='unrelated-font'?'Canoli Unrelated Fixture':family,new Uint8Array(font));
  document.createElement=((...args:Parameters<typeof document.createElement>)=>{const element=create(...args);if(args[0]==='canvas')surfaces.push(element as HTMLCanvasElement);return element;}) as typeof document.createElement;
  let invoked=false,error='',returned=false,output='',timer:ReturnType<typeof setTimeout>|undefined;
  function mutate(){invoked=true;if(action==='cancel')abort.abort();else if(action==='font-remove')document.fonts.delete(face);else if(action==='font-descriptor')face.weight='700';else if(action==='host-edit')text.text='Later host edit';else document.fonts.add(replacement);}
  if(action!=='encoding-change'&&action!=='pending-font')timer=setTimeout(mutate,0);
  try{output=await(await editor.export({format:'svg'},{signal:abort.signal,onProgress:p=>{if(action==='encoding-change'&&!invoked&&p.phase==='encoding')mutate();}})).blob.text();returned=true;}catch(cause){error=String(cause);}finally{if(timer!==undefined)clearTimeout(timer);document.createElement=create;}
  const unchanged=before===JSON.stringify(editor.document.toJSON()),after=editor.document.getSnapshot().revision;
  const lines=output?new DOMParser().parseFromString(output,'image/svg+xml').querySelectorAll('text').length:0;
  let undoRestored=false;if(action==='host-edit'){editor.document.undo();undoRestored=before===JSON.stringify(editor.document.toJSON());}
  const result={action,initialFontStatus,error,returned,invoked,surfaces:surfaces.length,released:surfaces.every(canvas=>canvas.width===0&&canvas.height===0),unchanged,revision,after,lines,undoRestored};document.fonts.delete(face);document.fonts.delete(replacement);editor.dispose();return result;
 },{action,font});resume();if(action==='pending-font')expect(result.initialFontStatus).toBe('loading');await writeFile(`/tmp/canoli-svg-text-${action}.json`,JSON.stringify(result,null,2)+'\n');expect(result.surfaces).toBe(1);expect(result.released).toBe(true);
 if(action==='unrelated-font'||action==='host-edit'){expect(result.returned,JSON.stringify(result)).toBe(true);expect(result.invoked).toBe(true);expect(result.lines).toBe(3000);}else{expect(result.returned).toBe(false);expect(result.error).toMatch(/abort|font.*changed|font.*not loaded/i);}
 if(action==='host-edit'){expect(result.after).toBe(result.revision+1);expect(result.undoRestored).toBe(true);}else{expect(result.unchanged).toBe(true);expect(result.after).toBe(result.revision);}
});

for(const setting of ['font','color','xml'] as const)test(`invalid SVG text ${setting} fails without a partial result or history changes`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async setting=>{
  const{TextLayer}=window.luma,{EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts')),editor:typeof window.luma.editor=new EditorApplication(),text=editor.document.layers.add(new TextLayer({text:'Hello',fontFamily:'monospace'}));
  if(setting==='font')text.fontWeight='not-a-valid-weight';else if(setting==='color')text.color='url(https://example.com/paint.svg)';else text.text='A\u0000B';
  const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;let returned=false,error='';try{await editor.export({format:'svg'});returned=true;}catch(cause){error=String(cause);}const result={returned,error,unchanged:before===JSON.stringify(editor.document.toJSON()),revision,after:editor.document.getSnapshot().revision};editor.dispose();return result;
 },setting);expect(result.returned).toBe(false);expect(result.error).toMatch(setting==='xml'?/XML 1.0/:/invalid text/);expect(result.unchanged).toBe(true);expect(result.after).toBe(result.revision);
});

test('downloaded SVG references a page-only font without copying font files or promising its appearance',async({page})=>{
 const font=[...await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2')];await page.goto('/');const result=await page.evaluate(async font=>{
  const{editor,TextLayer}=window.luma;editor.newDocument({width:400,height:140});const face=new FontFace('Canoli Page Only Font',new Uint8Array(font));await face.load();document.fonts.add(face);editor.document.layers.add(new TextLayer({text:'Canoli typography',fontSize:32,fontFamily:'"Canoli Page Only Font", monospace',x:12,y:12,color:'#2050a0'}));
  const output=await editor.export({format:'svg'}),text=await output.blob.text(),xml=new DOMParser().parseFromString(text,'image/svg+xml');async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=400;canvas.height=140;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,400,140).data;}
  const a=await pixels(output.blob),b=await pixels(await editor.exportPng());let differences=0;for(let i=3;i<a.length;i+=4)if(a[i]!==b[i])differences++;document.fonts.delete(face);return{differences,report:output.report,family:xml.querySelector('text')!.getAttribute('font-family'),embeddedFonts:/@font-face|data:font|data:application\/(?:x-font|font)/i.test(text)};
 },font);await writeFile('/tmp/canoli-svg-text-font-portability.json',JSON.stringify(result,null,2)+'\n');expect(result.family).toBe('"Canoli Page Only Font", monospace');expect(result.embeddedFonts).toBe(false);expect(result.differences).toBeGreaterThan(100);expect(result.report.warnings.join(' ')).toContain('without embedding font files');
});

test('SVG text keeps every layer untracked when native Canvas letter spacing is unavailable',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const prototype=CanvasRenderingContext2D.prototype,descriptor=Object.getOwnPropertyDescriptor(prototype,'letterSpacing');if(!descriptor?.configurable)throw new Error('Cannot emulate missing Canvas letterSpacing.');Reflect.deleteProperty(prototype,'letterSpacing');
  try{
   const{editor,TextLayer}=window.luma;editor.newDocument({width:240,height:120});for(const y of [10,60])editor.document.layers.add(new TextLayer({text:'ABCD',fontFamily:'monospace',fontSize:24,letterSpacing:8,x:10,y}));
   const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,output=await editor.export({format:'svg'}),xml=new DOMParser().parseFromString(await output.blob.text(),'image/svg+xml');
   async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=240;canvas.height=120;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,240,120).data;}
   const a=await pixels(output.blob),b=await pixels(await editor.exportPng());let alpha=0,premult=0;for(let i=0;i<a.length;i+=4){alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255));}
   return{spacing:[...xml.querySelectorAll('text')].map(node=>node.getAttribute('letter-spacing')),alpha,premult,unchanged:before===JSON.stringify(editor.document.toJSON()),revision,after:editor.document.getSnapshot().revision};
  }finally{Object.defineProperty(prototype,'letterSpacing',descriptor);}
 });await writeFile('/tmp/canoli-svg-text-spacing-after.json',JSON.stringify(result,null,2)+'\n');expect(result.spacing).toEqual(['0','0']);expect(result.alpha).toBe(0);expect(result.premult).toBe(0);expect(result.unchanged).toBe(true);expect(result.after).toBe(result.revision);
});
