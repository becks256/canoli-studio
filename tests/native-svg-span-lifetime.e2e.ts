import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

for(const fault of ['cancel','missing-spacing','nonfinite','partial']as const)test('source span assembly '+fault+' cannot publish partial fields and permits retry',async({page})=>{
 const sources=await Promise.all(['native-fallback/Latin-no-mark.ttf','shaping-font/Shaping.ttf'].map(async file=>[...await readFile('tests/fixtures/'+file)]));
 await page.goto('/');const result=await page.evaluate(async({sources,fault})=>{
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'))as typeof import('../src/core/assets');
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts'))as typeof import('../src/engine/styled-text');
  const {captureNativeSvgGlyphSource}=await import(/* @vite-ignore */String('/src/engine/native-svg-source.ts'))as typeof import('../src/engine/native-svg-source');
  const {nativeSvgGlyphCandidates}=await import(/* @vite-ignore */String('/src/engine/native-svg-glyph.ts'))as typeof import('../src/engine/native-svg-glyph');
  const {resolveNativeSvgSpanFrames}=await import(/* @vite-ignore */String('/src/engine/native-svg-span-frames.ts'))as typeof import('../src/engine/native-svg-span-frames');
  const assets=new AssetStore(),doc=new window.luma.Document({assets}),files:Awaited<ReturnType<typeof doc.fonts.embed>>[]=[];
  for(const bytes of sources)files.push(await doc.fonts.embed(new Blob([new Uint8Array(bytes)])));
  const before=JSON.stringify(doc.toJSON()),plan=await captureStyledTextPlan({width:512,height:512,transform:[1.25,.125,-.25,.9,15,14],style:{fontFamily:files.map(f=>f.family).join(', '),fontSize:40,letterSpacing:-30},lines:[{x:220,y:160,direction:'rtl',align:'center',writing:{mode:'vertical-rl',orientation:'mixed'},spans:[{text:'AV ',style:{color:'#f00'}},{text:'a\u0301',style:{color:'#0f0'}},{text:' fi',style:{color:'#f00'}}]}]},doc.toJSON(),assets,{captureLinearPaint:true});
  try{
   const original=captureNativeSvgGlyphSource(plan,0,0,3),selected:Readonly<import('../src/engine/native-svg-candidates').NativeSvgGlyphCandidate>[]=[],fonts:Awaited<ReturnType<typeof plan.captureGlyphFont>>[]=[];
   for(const [owner,start,end]of [[0,0,3],[1,3,5],[0,5,8]]){
    const font=await plan.captureGlyphFont(files[owner].id);fonts.push(font);
    const iterator=nativeSvgGlyphCandidates(plan,font,0,{}, {...original,start,end,style:{...original.style,fontFamily:font.sourceFamily,fontVariationSettings:font.settings}});
    for await(const value of iterator)if(value.projection==='vertical-native-inline-top'&&value.nativeMetrics){selected.push(value);break;}
   }
   if(selected.length!==3)throw new Error('Source span fixture did not prepare');plan.retireMeasurement();
   const first=selected[0],allocation=first.inlineAllocation!,fragment=allocation.fragments![0],abort=new AbortController(),check=()=>{abort.signal.throwIfAborted();plan.check();for(const font of fonts)font.check();};
   let input=selected;
   if(fault==='partial')input=selected.slice(1);
   if(fault==='missing-spacing'||fault==='nonfinite')input=[{...first,inlineAllocation:{...allocation,fragments:[{...fragment,...(fault==='missing-spacing'?{spacings:fragment.spacings.slice(1)}:{glyphs:[{...fragment.glyphs[0],advance:Infinity},...fragment.glyphs.slice(1)]})},...allocation.fragments!.slice(1)]}},...selected.slice(1)];
   let error='',published=false;
   try{const promise=resolveNativeSvgSpanFrames(plan.scene.lines[0],input,check);if(fault==='cancel')queueMicrotask(()=>abort.abort(new Error('Expected source span cancel')));published=!!await promise;}catch(e){error=String(e);}
   const retry=await resolveNativeSvgSpanFrames(plan.scene.lines[0],selected,()=>{plan.check();for(const font of fonts)font.check();});
   return{error,published,retry:retry?.glyphs.length,unchanged:JSON.stringify(doc.toJSON())===before};
  }finally{plan.release();assets.dispose();}
 },{sources,fault});
 expect(result).toMatchObject({published:false,retry:8,unchanged:true});
 expect(result.error).toContain(fault==='cancel'?'Expected source span cancel':fault==='missing-spacing'?'spacing':fault==='nonfinite'?'advance':'');
});
