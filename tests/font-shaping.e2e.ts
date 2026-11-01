import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
for(const [fixture,settings,texts]of [
 ['shaping-font/Shaping.ttf','normal',['AV','fi','a\u0301','ببلا','אב']],
 ['fonts/Regular.ttf','normal',['AA','A A']],
 ['fonts/CFF.otf','normal',['AA','A A']],
 ['font-variations/Axes.ttf','"TEST" 50,"wght" 600',['AA']],
]as const)test('source-shaped placements match complete native Canvas runs: '+fixture,async({page},info)=>{
 const bytes=[...await readFile('tests/fixtures/'+fixture)];await page.goto('/');const result=await page.evaluate(async({bytes,settings,texts})=>{
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts'))as typeof import('../src/engine/styled-text');
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'))as typeof import('../src/core/assets');
  const assets=new AssetStore(),doc=new window.luma.Document({assets}),file=await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),plan=await captureStyledTextPlan({width:320,height:220,style:{fontFamily:file.family,fontVariationSettings:settings},lines:[{spans:[{text:texts.join(' ')}]}]},doc.toJSON(),assets),results=[];
  try{const font=await plan.captureGlyphFont(file.id,settings);
   for(const text of texts)for(const fontSize of [13,40,80])for(const affine of [false,true]){
    const match=await plan.matchGlyphRun(font,{text,direction:/[\u0590-\u06ff]/.test(text)?'rtl':'ltr',style:{fontSize,fontKerning:'normal'},transform:affine?[1.25,.125,-.25,.9,32,120]:[1,0,0,1,32,120]});
    results.push({text,fontSize,affine,status:match.status,evidence:match.evidence,...(match.status==='matched'?{glyphs:match.run.glyphs}:{reason:match.reason})});
   }
   return{results};
  }finally{plan.release();assets.dispose();}
 },{bytes,settings,texts});await writeFile(info.outputPath('native-shaped-runs.json'),JSON.stringify(result,null,2));expect(result.results.filter(r=>r.status!=='matched')).toEqual([]);
});

test('matched tracked glyphs retain ordered HDR/alpha paint with exact native coverage and window partitions',async({page},info)=>{
 const bytes=[...await readFile('tests/fixtures/fonts/Regular.ttf')];await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts'))as typeof import('../src/engine/styled-text');
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'))as typeof import('../src/core/assets');
  const {FloatPixelProcessor}=await import(/* @vite-ignore */String('/src/engine/float-pixels.ts'))as typeof import('../src/engine/float-pixels');
  const {instantiateKernel}=await import(/* @vite-ignore */String('/src/engine/wasm.ts'))as typeof import('../src/engine/wasm');
  const assets=new AssetStore(),doc=new window.luma.Document({assets}),file=await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),plan=await captureStyledTextPlan({width:160,height:160,style:{fontFamily:file.family},lines:[{spans:[{text:'AA'}]}]},doc.toJSON(),assets),native=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await(await fetch('/wasm/pixels.wasm')).arrayBuffer()))),processor={floatComposite:async(...args:Parameters<typeof native.composite>)=>native.composite(...args)};
  try{const font=await plan.captureGlyphFont(file.id),match=await plan.matchGlyphRun(font,{text:'AA',style:{fontSize:80,letterSpacing:-35,fontKerning:'none'},transform:[1,0,0,1,32,120]});if(match.status!=='matched')return{status:match.status,reason:match.reason,results:[]};
   const canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;const c=canvas.getContext('2d')!;c.font='80px '+file.family;c.fillStyle='#fff';const cover=[32,45].map(x=>{c.clearRect(0,0,160,160);c.fillText('A',x,120);return c.getImageData(0,0,160,160).data;});const results=[];
   for(const alpha of [.5,.64123012345,1e-8]){const color=[4,-.25,1.5,alpha]as const,glyphs=match.glyphs.map(g=>({...g,color})),area={x:0,y:0,width:160,height:160},full=await plan.renderGlyphs(glyphs,area,processor),parts=new Float32Array(full.length);let alphaError=0,maxAlpha=0,rgb:number[]=[];
    for(let i=0;i<160*160;i++){const a=Math.fround(Math.fround(alpha)*Math.fround(cover[0][i*4+3]/255)),b=Math.fround(Math.fround(alpha)*Math.fround(cover[1][i*4+3]/255)),expected=Math.fround(b+a*(1-b));alphaError=Math.max(alphaError,Math.abs(expected-full[i*4+3]));if(full[i*4+3]>maxAlpha){maxAlpha=full[i*4+3];rgb=[...full.slice(i*4,i*4+3)];}}
    for(let x=0;x<160;x+=53){const width=Math.min(53,160-x),part=await plan.renderGlyphs(glyphs,{...area,x,width},processor);for(let y=0;y<160;y++)parts.set(part.subarray(y*width*4,(y+1)*width*4),(y*160+x)*4);}
    results.push({alpha,alphaError,maxAlpha,rgb,partitions:new Uint32Array(full.buffer).every((v,i)=>v===new Uint32Array(parts.buffer)[i])});
   }
   return{status:match.status,evidence:match.evidence,results};
  }finally{plan.release();assets.dispose();}
 },bytes);await writeFile(info.outputPath('matched-float-glyphs.json'),JSON.stringify(result,null,2));expect(result.status).toBe('matched');for(const r of result.results){expect(r.alphaError).toBe(0);expect(r.maxAlpha).toBeGreaterThan(0);expect(r.rgb).toEqual([4,-.25,1.5]);expect(r.partitions).toBe(true);}
});

for(const fault of ['timeout','cancel','corrupt','release']as const)test('source shaping '+fault+' retires its worker/source lease and permits queued retry',async({page},info)=>{
 const bytes=[...await readFile('tests/fixtures/shaping-font/Shaping.ttf')];await page.goto('/');const result=await page.evaluate(async({bytes,fault})=>{
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts'))as typeof import('../src/engine/styled-text');
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'))as typeof import('../src/core/assets');
  const assets=new AssetStore(),doc=new window.luma.Document({assets}),file=await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),plan=await captureStyledTextPlan({width:160,height:160,style:{fontFamily:file.family},lines:[{spans:[{text:'AV'}]}]},doc.toJSON(),assets),font=await plan.captureGlyphFont(file.id),RealWorker=Worker,abort=new AbortController();let terminations=0,error='Unexpected success';
  try{
   globalThis.Worker=class extends RealWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(String(url).includes('font-shaping-worker')){const stop=this.terminate.bind(this);this.terminate=()=>{terminations++;stop();};this.postMessage=()=>{if(fault==='corrupt')setTimeout(()=>this.onmessage?.(new MessageEvent('message',{data:{version:1,engine:'HarfBuzz 15.0.0',unitsPerEm:1000,glyphCount:18,data:new Float64Array([999,0,0,0,0,0,0])}})),0);else if(fault==='cancel')setTimeout(()=>abort.abort(new Error('Expected shaping cancellation')),0);else if(fault==='release')setTimeout(()=>font.release(),0);};}}}as typeof Worker;
   try{await font.shapeRun({text:'AV'},{signal:abort.signal,timeoutMs:fault==='timeout'?40:60000});}catch(e){error=String(e);}finally{globalThis.Worker=RealWorker;}
   const retryFont=fault==='release'?await plan.captureGlyphFont(file.id):font,input={text:'AV',features:[{tag:'kern',value:1}]},pending=retryFont.shapeRun(input);input.text='fi';input.features[0].value=0;const retry=await pending;
   file.remove();for(let i=0;i<65;i++)doc.name='Retain source '+i;const retained=await retryFont.shapeRun({text:'ببلا',direction:'rtl'});plan.release();return{error,terminations,retryText:retry.request.text,advances:retry.glyphs.map(g=>g.xAdvance),retainedIds:retained.glyphs.map(g=>g.glyphId),remaining:assets.fonts.size,faces:[...document.fonts].filter(f=>f.family.startsWith('CanoliGlyph_')).length};
  }finally{globalThis.Worker=RealWorker;plan.release();assets.dispose();}
 },{bytes,fault});await writeFile(info.outputPath('shaping-'+fault+'.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({terminations:1,retryText:'AV',advances:[520,600],retainedIds:[11,14,13],remaining:0,faces:0});expect(result.error).toContain(fault==='timeout'?'time budget':fault==='cancel'?'Expected shaping cancellation':fault==='release'?'released':'outside');
});

test('native verification rejects changed poses, mixed bidi, missing glyphs and foreign plan resources',async({page},info)=>{
 const bytes=[...await readFile('tests/fixtures/shaping-font/Shaping.ttf')];await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts'))as typeof import('../src/engine/styled-text');
  const {matchNativeGlyphRun}=await import(/* @vite-ignore */String('/src/engine/native-glyph-match.ts'))as typeof import('../src/engine/native-glyph-match');
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'))as typeof import('../src/core/assets');
  const assets=new AssetStore(),doc=new window.luma.Document({assets}),file=await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),scene={width:320,height:220,style:{fontFamily:file.family},lines:[{spans:[{text:'AV'}]}]},plan=await captureStyledTextPlan(scene,doc.toJSON(),assets),other=await captureStyledTextPlan(scene,doc.toJSON(),assets);
  try{const font=await plan.captureGlyphFont(file.id),bad={...font,async shapeRun(...args:Parameters<typeof font.shapeRun>){const run=await font.shapeRun(...args);return{...run,glyphs:run.glyphs.map(g=>({...g,xOffset:g.xOffset+40}))};}},shift=await matchNativeGlyphRun(bad,{text:'AV',style:{fontSize:80,fontKerning:'normal'}}),missing=await plan.matchGlyphRun(font,{text:'😀'}),bidi=await plan.matchGlyphRun(font,{text:'A אב V'}),color=await matchNativeGlyphRun({...font,monochrome:false},{text:'AV'});let foreign='',retired='';try{await other.matchGlyphRun(font,{text:'AV'});}catch(e){foreign=String(e);}plan.release();try{await font.shapeRun({text:'AV'});}catch(e){retired=String(e);}return{shift,missing,bidi,color,foreign,retired};
  }finally{plan.release();other.release();assets.dispose();}
 },bytes);await writeFile(info.outputPath('native-match-rejections.json'),JSON.stringify(result,null,2));expect(result.shift.status).toBe('mismatch');expect(result.shift.evidence!.maxAlphaError).toBeGreaterThan(0);expect(result.missing.status).toBe('unavailable');expect(result.bidi.status).toBe('mismatch');expect(result.color.status).toBe('unavailable');expect(result.foreign).toContain('outside');expect(result.retired).toContain('released');for(const name of ['shift','missing','bidi','color']as const)expect('glyphs'in result[name]).toBe(false);
});
