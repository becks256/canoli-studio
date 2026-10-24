import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{fontFeaturesWorkflow}from'./helpers/font-features';

test('native font controls preserve literal text, sparse styles, keyboard input, exact undo and project/SVG output through ordinary UI',async({page},info)=>{await fontFeaturesWorkflow(page,info);});

test('every native capital/stretch request retains whole-line metrics and pixels across multilingual source text',async({page},info)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();
 const results=await page.evaluate(async()=>{
  const out=[];const{editor,TextLayer}=window.luma;
  for(const fontVariantCaps of ['normal','small-caps','all-small-caps','petite-caps','all-petite-caps','unicase','titling-caps']as const)for(const fontStretch of ['ultra-condensed','extra-condensed','condensed','semi-condensed','normal','semi-expanded','expanded','extra-expanded','ultra-expanded']as const){
   editor.newDocument({width:640,height:160});const text='Canoli ß ﬁ é العربية 123',layer=editor.document.layers.add(new TextLayer({text,fontVariantCaps,fontStretch,fontWeight:'553.25',fontSize:32,fontFamily:'serif',color:'#000000',x:16,y:16}));
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=160;const context=canvas.getContext('2d')!;context.font='553.25 32px serif';context.fontVariantCaps=fontVariantCaps;context.fontStretch=fontStretch;context.textBaseline='top';context.fillStyle='#000000';const advance=context.measureText(text).width;context.fillText(text,16,16);const expected=context.getImageData(0,0,640,160).data;
   const image=await createImageBitmap(await editor.exportPng());context.clearRect(0,0,640,160);context.drawImage(image,0,0);image.close();const actual=context.getImageData(0,0,640,160).data;let maximum=0,coverage=0;for(let i=0;i<actual.length;i++){maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));if(i%4===3)coverage+=actual[i];}
   out.push({fontVariantCaps,fontStretch,width:layer.width,expectedWidth:Math.max(1,Math.round(advance)),maximum,coverage,sourceUnchanged:layer.text===text});canvas.width=canvas.height=0;await editor.closeDocument(editor.document,{discardChanges:true});
  }return out;
 });await writeFile(info.outputPath('font-features-native-references.json'),JSON.stringify(results,null,2));expect(results).toHaveLength(63);for(const result of results){expect(result.width,JSON.stringify(result)).toBe(result.expectedWidth);expect(result.maximum,JSON.stringify(result)).toBe(0);expect(result.sourceUnchanged).toBe(true);expect(result.coverage).toBeGreaterThan(10000);}
});

test('font stretch selects real declared faces and rejects a pending requested width before any raster or SVG render',async({page},info)=>{
 const normal=await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'),condensed=await readFile('node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2');
 await page.goto('/');await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();
 let releaseFont!:()=>void;const fontBlocked=new Promise<void>(resolve=>{releaseFont=resolve;});await page.route('**/canoli-type-pending-width.woff2',async route=>{await fontBlocked;await route.fulfill({body:condensed,contentType:'font/woff2'});});
 let result;try{result=await page.evaluate(async({normal,condensed})=>{
  const{editor,TextLayer}=window.luma,family='Canoli Native Width Fixture',normalFace=await new FontFace(family,new Uint8Array(normal),{stretch:'normal',weight:'200 800'}).load(),condensedFace=await new FontFace(family,new Uint8Array(condensed),{stretch:'condensed'}).load();document.fonts.add(normalFace);document.fonts.add(condensedFace);
  let pendingFace:FontFace|undefined;
  try{
   editor.newDocument({width:640,height:160});const layer=editor.document.layers.add(new TextLayer({text:'iiii WWWW 123',fontFamily:`"${family}"`,fontSize:32,fontStretch:'normal',color:'#000000'})),normalWidth=layer.width;
   const weights=[];
   for(const weight of ['450','553.25','650']){
    layer.fontWeight=weight;const reference=document.createElement('canvas');reference.width=640;reference.height=160;const c=reference.getContext('2d')!;c.font=`${weight} 32px "${family}"`;c.textBaseline='top';c.fillStyle='#000000';const expected=Math.max(1,Math.round(c.measureText(layer.text).width));c.fillText(layer.text,0,0);const pixels=c.getImageData(0,0,640,160).data,image=await createImageBitmap(await editor.exportPng());c.clearRect(0,0,640,160);c.drawImage(image,0,0);image.close();const actual=c.getImageData(0,0,640,160).data;
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',actual))].map(value=>value.toString(16).padStart(2,'0')).join('');weights.push({weight,width:layer.width,expected,exact:actual.every((value,index)=>value===pixels[index]),sha256:digest});reference.width=reference.height=0;
   }
   layer.fontWeight='400';layer.fontStretch='condensed';const condensedWidth=layer.width;
   const canvas=document.createElement('canvas'),context=canvas.getContext('2d')!;context.font=`32px "${family}"`;context.fontStretch='condensed';const expectedWidth=Math.max(1,Math.round(context.measureText(layer.text).width));await editor.exportPng();
   document.fonts.delete(condensedFace);pendingFace=new FontFace(family,'url(/canoli-type-pending-width.woff2)',{stretch:'condensed'});document.fonts.add(pendingFace);
   const renderer=editor.renderer,render=renderer.render.bind(renderer);let calls=0;renderer.render=async(...args)=>{calls++;return render(...args);};let pngError='',svgError='';
   try{await editor.exportPng();}catch(error){pngError=String(error);}finally{renderer.render=render;}
   try{await editor.export({format:'svg'});}catch(error){svgError=String(error);}
   return{weights,normalWidth,condensedWidth,expectedWidth,calls,pngError,svgError,pendingStatus:pendingFace.status,source:layer.text};
  }finally{document.fonts.delete(normalFace);document.fonts.delete(condensedFace);if(pendingFace)document.fonts.delete(pendingFace);}
 },{normal:[...normal],condensed:[...condensed]});}finally{releaseFont();}
 await writeFile(info.outputPath('font-features-width-matching.json'),JSON.stringify(result,null,2));expect(result.weights).toHaveLength(3);for(const sample of result.weights){expect(sample.exact).toBe(true);expect(sample.width).toBe(sample.expected);}expect(new Set(result.weights.map(sample=>sample.sha256)).size).toBe(3);expect(result.normalWidth).not.toBe(result.condensedWidth);expect(result.condensedWidth).toBe(result.expectedWidth);expect(result.calls).toBe(0);expect(result.pngError).toContain('not loaded');expect(result.svgError).toContain('not loaded');expect(['unloaded','loading']).toContain(result.pendingStatus);
});

test('unsupported native feature APIs reject before drawing while one-command reset restores editability and undo',async({page},info)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{
  const{Document,TextLayer,AffineTransform}=window.luma,documentModel=new Document(),text=documentModel.layers.add(new TextLayer({text:'Native text',fontVariantCaps:'small-caps',fontStretch:'condensed'})),before=JSON.stringify(text.toJSON()),canvas=document.createElement('canvas');canvas.width=400;canvas.height=100;const context=canvas.getContext('2d')!,{drawText}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const saved=[CanvasRenderingContext2D.prototype,OffscreenCanvasRenderingContext2D.prototype].flatMap(proto=>['fontVariantCaps','fontStretch'].map(key=>({proto,key,descriptor:Object.getOwnPropertyDescriptor(proto,key)!})));let calls=0,error='';const save=context.save.bind(context);context.save=()=>{calls++;save();};
  try{for(const value of saved)delete(value.proto as unknown as Record<string,unknown>)[value.key];try{drawText(text.toJSON()as never,canvas,{x:0,y:0,width:400,height:100,sx:1,sy:1},new AffineTransform());}catch(cause){error=String(cause);}const count=documentModel.getSnapshot().past.length;text.resetFontFeatures();const reset=text.fontVariantCaps==='normal'&&text.fontStretch==='normal',oneUndo=documentModel.getSnapshot().past.length===count+1;documentModel.undo();return{calls,error,reset,oneUndo,restored:JSON.stringify(text.toJSON())===before};}finally{for(const value of saved)Object.defineProperty(value.proto,value.key,value.descriptor);canvas.width=canvas.height=0;}
 });await writeFile(info.outputPath('font-features-unsupported.json'),JSON.stringify(result,null,2));expect(result.calls).toBe(0);expect(result.error).toContain('capital variants');expect(result.reset).toBe(true);expect(result.oneUndo).toBe(true);expect(result.restored).toBe(true);
});

test('a genuine 50 MP RAW retains original bytes and every native sample beneath styled text across tile boundaries',async({page},info)=>{
 test.setTimeout(480000);const rawPath=info.outputPath('font-features-50mp.dng');await writeFile(rawPath,gunzipSync(await readFile('tests/fixtures/raw/native-50mp.dng.gz')));
 await page.goto('/');await page.getByTestId('import-input').setInputFiles(rawPath);const review=page.getByRole('dialog',{name:'Import camera RAW',exact:true});await review.getByRole('checkbox',{name:'Convert RAW development to 8-bit editing precision',exact:true}).check();await review.getByRole('button',{name:'Import RAW image',exact:true}).click();await expect(review).toHaveCount(0,{timeout:180000});
 const result=await page.evaluate(async()=>{
  const{editor,PaintLayer,PaintFill,TextLayer}=window.luma,originalDocument=editor.document;
  editor.document.layers.add(new PaintLayer({name:'Opaque reference region'})).strokes.add(new PaintFill({bounds:{x:2016,y:2024,width:600,height:200},color:'#ffffff'}));
  const text=editor.document.layers.add(new TextLayer({text:'Native Canoli ß é',fontSize:32,fontFamily:'serif',fontWeight:'553.25',fontVariantCaps:'small-caps',fontStretch:'semi-condensed',color:'#000000',x:2032,y:2040})),source=text.text,model=JSON.stringify(editor.document.toJSON()),project=await editor.saveProject();
  await editor.openProject(new File([project],'Font features 50MP.luma'));await editor.closeDocument(originalDocument,{discardChanges:true});const asset=editor.assetStore.values().find(value=>value.raw)!,original=asset.raw!.originalBlob;
  const originalSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await original.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('');
  const glyphs=document.createElement('canvas');glyphs.width=600;glyphs.height=200;const c=glyphs.getContext('2d')!;c.font='553.25 32px serif';c.fontVariantCaps='small-caps';c.fontStretch='semi-condensed';c.textBaseline='top';c.fillStyle='#000000';c.fillText(source,16,16);
  const reference=document.createElement('canvas');reference.width=600;reference.height=200;const r=reference.getContext('2d')!;r.fillStyle='#ffffff';r.fillRect(0,0,600,200);r.drawImage(glyphs,0,0);const referencePng=await new Promise<Blob>(resolve=>reference.toBlob(value=>resolve(value!)));glyphs.width=glyphs.height=reference.width=reference.height=0;
  const surfaces:HTMLCanvasElement[]=[],renderer=editor.renderer,render=renderer.render.bind(renderer);renderer.render=async(...args)=>{const value=await render(...args);if(args[2]?.readback&&args[2]?.cache===false)surfaces.push(value);return value;};let png:Blob;
  try{png=await editor.exportPng();}finally{renderer.render=render;}
  (window as any).fontFeaturesLarge={png,reference:referencePng,project};return{originalBytes:original.size,originalSha256,modelUnchanged:JSON.stringify(editor.document.toJSON())===model,released:surfaces.every(canvas=>canvas.width===0&&canvas.height===0),surfaces:surfaces.length};
 });expect(result).toMatchObject({originalBytes:100000672,originalSha256:'cfe25bed379735dfea685695e956838b284106e6527e6aff77e3901ef6ef9d85',modelUnchanged:true,released:true});expect(result.surfaces).toBeGreaterThan(0);
 for(const key of ['png','reference','project']){const pending=page.waitForEvent('download'),path=info.outputPath('font-features-50mp-'+key+(key==='project'?'.luma':'.png'));await page.evaluate(key=>{const anchor=document.createElement('a'),blob=(window as any).fontFeaturesLarge[key];anchor.href=URL.createObjectURL(blob);anchor.download=key+(key==='project'?'.luma':'.png');anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000);},key);await(await pending).saveAs(path);}
 await writeFile(info.outputPath('font-features-50mp.json'),JSON.stringify(result,null,2));
});
