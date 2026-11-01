import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
for(const [fixture,settings]of [['fonts/Regular.ttf','normal'],['fonts/CFF.otf','normal'],['font-variations/Axes.ttf','"TEST" 50,"wght" 600']]as const)test('selected native glyph retains original hinted/affine pixels: '+fixture,async({page},info)=>{
 const bytes=[...await readFile('tests/fixtures/'+fixture)];await page.goto('/');const result=await page.evaluate(async({bytes,settings})=>{
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts')) as typeof import('../src/engine/styled-text');
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts')) as typeof import('../src/core/assets');
  const assets=new AssetStore(),doc=new window.luma.Document({assets,width:320,height:220}),errors=[];let reference:FontFace|undefined;
  try{const file=await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),plan=await captureStyledTextPlan({width:320,height:220,style:{fontFamily:file.family,fontSize:40},lines:[{spans:[{text:'A'}]}]},doc.toJSON(),assets);
   try{const glyph=await plan.captureGlyphFont(file.id,settings);reference=new FontFace('IndependentGlyphReference',new Uint8Array(bytes).buffer,{variationSettings:settings});await reference.load();document.fonts.add(reference);const c=document.createElement('canvas');c.width=320;c.height=220;const ctx=c.getContext('2d')!;
    for(const size of [13,40,80])for(const affine of [false,true]){const draw=(family:string,text:string)=>{ctx.resetTransform();ctx.clearRect(0,0,320,220);if(affine)ctx.setTransform(1.25,.125,-.25,.9,32,10);ctx.font=size+'px '+family;ctx.fillStyle='#fff';ctx.fillText(text,48,120);return ctx.getImageData(0,0,320,220).data;},a=draw('IndependentGlyphReference','A'),b=draw(glyph.family,glyph.character(2));let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));errors.push(max);}
    const family=glyph.family;plan.retireMeasurement();file.remove();for(let i=0;i<65;i++)doc.name='Retain glyph '+i;glyph.check();const retained=assets.fonts.size;plan.release();let retired='';try{glyph.character(2);}catch(e){retired=String(e);}return{errors,retained,remaining:assets.fonts.size,retired,nativeFaces:[...document.fonts].filter(f=>f.family===family).length};
   }finally{plan.release();}
  }finally{if(reference)document.fonts.delete(reference);assets.dispose();}
 },{bytes,settings});expect(result.errors).toEqual([0,0,0,0,0,0]);expect(result).toMatchObject({retained:1,remaining:0,nativeFaces:0});expect(result.retired).toContain('released');await writeFile(info.outputPath('native-glyph-reference.json'),JSON.stringify(result,null,2));
});

test('ordered native glyph fields retain HDR and tiny alpha through actual WASM and exact work-window partitions',async({page},info)=>{
 const bytes=[...await readFile('tests/fixtures/fonts/Regular.ttf')];await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts')) as typeof import('../src/engine/styled-text');
  const {FloatPixelProcessor}=await import(/* @vite-ignore */String('/src/engine/float-pixels.ts')) as typeof import('../src/engine/float-pixels');
  const {instantiateKernel}=await import(/* @vite-ignore */String('/src/engine/wasm.ts')) as typeof import('../src/engine/wasm');
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts')) as typeof import('../src/core/assets');
  const assets=new AssetStore(),doc=new window.luma.Document({assets,width:160,height:160}),file=await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),plan=await captureStyledTextPlan({width:160,height:160,style:{fontFamily:file.family},lines:[{spans:[{text:'AA'}]}]},doc.toJSON(),assets),native=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await(await fetch('/wasm/pixels.wasm')).arrayBuffer()))),processor={floatComposite:async(...args:Parameters<typeof native.composite>)=>native.composite(...args)},results=[];
  try{const font=await plan.captureGlyphFont(file.id),style={fontSize:80,fontWeight:'400',fontStyle:'normal'as const},area={x:0,y:0,width:160,height:160};
   for(const alpha of [.5,.64123012345,1e-8]){const a=Math.fround(alpha),color=[4,-.25,1.5,a]as const,glyphs=[48,60].map(x=>({font,glyphId:2,style,color,transform:window.luma.AffineTransform.translation(x,120)})),full=await plan.renderGlyphs(glyphs,area,processor,()=>{}),parts=new Float32Array(full.length);for(let x=0;x<160;x+=53){const width=Math.min(53,160-x),part=await plan.renderGlyphs(glyphs,{...area,x,width},processor,()=>{});for(let y=0;y<160;y++)parts.set(part.subarray(y*width*4,(y+1)*width*4),(y*160+x)*4);}const maxAlpha=Math.max(...Array.from({length:160*160},(_,i)=>full[i*4+3])),at=full.findIndex((_,i)=>i%4===3&&full[i]===maxAlpha);results.push({alpha,maxAlpha,expected:Math.fround(a+a*(1-a)),rgb:[...full.slice(at-3,at)],partitions:new Uint32Array(full.buffer).every((v,i)=>v===new Uint32Array(parts.buffer)[i])});}
   return{results};
  }finally{plan.release();assets.dispose();}
 },bytes);for(const r of result.results){expect(r.maxAlpha).toBe(r.expected);expect(r.rgb).toEqual([4,-.25,1.5]);expect(r.partitions).toBe(true);}expect(result.results[2].maxAlpha).toBeGreaterThan(0);await writeFile(info.outputPath('float-glyph-overlap.json'),JSON.stringify(result,null,2));
});

for(const fault of ['cancel','timeout']as const)test('glyph preparation '+fault+' releases private registrations and permits a queued retry',async({page},info)=>{
 const bytes=[...await readFile('tests/fixtures/fonts/Regular.ttf')];await page.goto('/');const result=await page.evaluate(async({bytes,fault})=>{
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts')) as typeof import('../src/engine/styled-text');
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts')) as typeof import('../src/core/assets');
  const assets=new AssetStore(),doc=new window.luma.Document({assets}),file=await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),plan=await captureStyledTextPlan({width:160,height:160,style:{fontFamily:file.family},lines:[{spans:[{text:'A'}]}]},doc.toJSON(),assets),add=FontFaceSet.prototype.add,RealWorker=Worker,abort=new AbortController();let error='Unexpected success';
  try{
   if(fault==='cancel')FontFaceSet.prototype.add=function(face){const value=add.call(this,face);if(face.family.startsWith('CanoliGlyph_'))abort.abort(new Error('Expected glyph cancellation'));return value;};
   if(fault==='timeout')globalThis.Worker=class extends RealWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(String(url).includes('glyph-selector-worker'))this.postMessage=()=>{};}}as typeof Worker;
   try{const value=await plan.captureGlyphFont(file.id,'normal',{signal:abort.signal,timeoutMs:fault==='timeout'?50:60000});value.release();}catch(e){error=String(e);}finally{FontFaceSet.prototype.add=add;globalThis.Worker=RealWorker;}
   const remainingAfterFault=[...document.fonts].filter(f=>f.family.startsWith('CanoliGlyph_')).length,retry=await plan.captureGlyphFont(file.id);retry.check();const character=retry.character(2);let zero='';try{retry.character(0);}catch(e){zero=String(e);}file.remove();for(let i=0;i<65;i++)doc.name='Collect glyph '+i;plan.release();return{error,remainingAfterFault,character,zero,remaining:assets.fonts.size,nativeFaces:[...document.fonts].filter(f=>f.family.startsWith('CanoliGlyph_')).length};
  }finally{FontFaceSet.prototype.add=add;globalThis.Worker=RealWorker;plan.release();assets.dispose();}
 },{bytes,fault});expect(result).toMatchObject({remainingAfterFault:0,remaining:0,nativeFaces:0});expect(result.error).toContain(fault==='timeout'?'time budget':'Expected glyph cancellation');expect(result.zero).toContain('missing-glyph');expect(result.character.codePointAt(0)).toBeGreaterThan(0xffff);await writeFile(info.outputPath('glyph-'+fault+'.json'),JSON.stringify(result,null,2));
});
