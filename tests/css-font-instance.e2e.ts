import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
for(const [reference,source,settings,style]of [
 ['weight','Css.ttf','normal',{fontWeight:'600'}],['fraction','Css.ttf','normal',{fontWeight:'637.5'}],
 ['wide-italic','Css-italic.ttf','"ital" 1',{fontWeight:'bold',fontStretch:'expanded',fontStyle:'italic'}],
 ['wide-upright','Css-italic.ttf','normal',{fontWeight:'bold',fontStretch:'expanded',fontStyle:'italic'}],
 ['wide-slant','Css.ttf','normal',{fontWeight:'bold',fontStretch:'expanded',fontStyle:'italic'}],
 ['overridden','Css.ttf','"wght" 550,"wdth" 87.5,"ital" .5,"slnt" -7',{fontWeight:'700',fontStretch:'expanded',fontStyle:'italic'}],
]as const)test('native source CSS instance matches independent static outlines/advance and complete shaped paint: '+reference,async({page},info)=>{
 const bytes=[...await readFile('tests/fixtures/css-font/'+source)],staticBytes=[...await readFile('tests/fixtures/css-font/'+reference+'.ttf')];await page.goto('/');const result=await page.evaluate(async({bytes,staticBytes,settings,style})=>{
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts'))as typeof import('../src/engine/styled-text');
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'))as typeof import('../src/core/assets');
  const {applyTextStyle}=await import(/* @vite-ignore */String('/src/core/text-style.ts'))as typeof import('../src/core/text-style');
  const assets=new AssetStore(),doc=new window.luma.Document({assets}),file=await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),plan=await captureStyledTextPlan({width:512,height:256,style:{fontFamily:file.family,fontVariationSettings:settings},lines:[{spans:[{text:'AA A'}]}]},doc.toJSON(),assets),face=new FontFace('IndependentCssInstance',new Uint8Array(staticBytes).buffer),rows=[];await face.load();document.fonts.add(face);
  try{const font=await plan.captureGlyphFont(file.id,settings);for(const fontSize of [13,40,80])for(const affine of [false,true]){
    const text='AA A',transform: [number,number,number,number,number,number]=affine?[1.25,.125,-.25,.9,32,180]:[1,0,0,1,32,180],match=await plan.matchGlyphRun(font,{text,style:{...style,fontSize,fontKerning:'normal'},transform});
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d')!;c.fillStyle='#fff';const draw=(reference:boolean)=>{c.resetTransform();c.clearRect(0,0,1024,256);if(reference)c.font=fontSize+'px IndependentCssInstance';else applyTextStyle(c,{fontFamily:file.family,fontVariationSettings:settings,...style,fontSize});c.fontKerning='normal';c.setTransform(...transform);c.fillText(text,0,0);return{pixels:c.getImageData(0,0,1024,256).data,advance:c.measureText(text).width};};const a=draw(false),b=draw(true);let error=0;for(let i=0;i<a.pixels.length;i++)error=Math.max(error,Math.abs(a.pixels[i]-b.pixels[i]));rows.push({fontSize,affine,error,advance:a.advance,referenceAdvance:b.advance,status:match.status,evidence:match.evidence,...(match.status==='matched'?{settings:match.run.settings,css:match.run.request.css}: {reason:match.reason})});
   }return{rows};
  }finally{document.fonts.delete(face);plan.release();assets.dispose();}
 },{bytes,staticBytes,settings,style});await writeFile(info.outputPath('css-instance-reference.json'),JSON.stringify(result,null,2));for(const row of result.rows){expect(row.error).toBe(0);expect(row.advance).toBe(row.referenceAdvance);expect(row.status).toBe('matched');}
});

test('relative/fractional weights and descriptor clamps preserve actual native runs without retargeting authored sources',async({page},info)=>{
 const bytes=[...await readFile('tests/fixtures/css-font/Css.ttf')];await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts'))as typeof import('../src/engine/styled-text');
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'))as typeof import('../src/core/assets');
  const {parseFontVariations}=await import(/* @vite-ignore */String('/src/core/font-variations.ts'))as typeof import('../src/core/font-variations');
  const assets=new AssetStore(),doc=new window.luma.Document({assets}),file=await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),before=JSON.stringify(doc.toJSON()),plan=await captureStyledTextPlan({width:512,height:256,style:{fontFamily:file.family},lines:[{spans:[{text:'AA A'}]}]},doc.toJSON(),assets),rows=[];
  try{const font=await plan.captureGlyphFont(file.id),overridden=await plan.captureGlyphFont(file.id,'"wght" 550.25,"wdth" 87.5,"ital" .5,"slnt" -7');
   for(const [fontWeight,fontStretch,weight,width,selected]of [['bolder','normal',700,100,font],['lighter','normal',400,100,font],['639.75','normal',639.75,100,font],['1000','ultra-expanded',800,125,font],['100','ultra-condensed',400,75,font],['bold','expanded',550.25,87.5,overridden]]as const){
    const match=await plan.matchGlyphRun(selected,{text:'AA A',style:{fontSize:40,fontWeight,fontStretch,fontStyle:selected===overridden?'italic':'normal'},transform:[1.25,.125,-.25,.9,32,180]});rows.push({fontWeight,fontStretch,status:match.status,evidence:match.evidence,expected:{weight,width},...(match.status==='matched'?{settings:Object.fromEntries(parseFontVariations(match.run.settings).map(a=>[a.tag,a.value]))}:{reason:match.reason})});
   }
   const input={text:'AA',css:{weight:639.75,width:125,style:'italic'as const}},pending=font.shapeRun(input);input.css.weight=400;const raw=await pending;let invalid='';try{await plan.matchGlyphRun(font,{text:'AA',style:{fontWeight:'not-a-valid-weight'}});}catch(e){invalid=String(e);}return{rows,rawCss:raw.request.css,invalid,modelUnchanged:JSON.stringify(doc.toJSON())===before,immutableDescriptors:Object.isFrozen(font.descriptors[0])&&Object.isFrozen(font.axes[0])};
  }finally{plan.release();assets.dispose();}
 },bytes);await writeFile(info.outputPath('native-css-edge-cases.json'),JSON.stringify(result,null,2));for(const row of result.rows){expect(row).toMatchObject({status:'matched',settings:{wght:row.expected.weight,wdth:row.expected.width}});expect(row.evidence!.maxAlphaError).toBe(0);}expect(result).toMatchObject({rawCss:{weight:639.75,width:125,style:'italic'},modelUnchanged:true,immutableDescriptors:true});expect(result.invalid).toContain('Invalid native glyph font request');
});

test('CSS-selected native glyphs retain ordered Float32 alpha and HDR paint with exact work-window words',async({page},info)=>{
 const bytes=[...await readFile('tests/fixtures/css-font/Css.ttf')];await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts'))as typeof import('../src/engine/styled-text');
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'))as typeof import('../src/core/assets');
  const {FloatPixelProcessor}=await import(/* @vite-ignore */String('/src/engine/float-pixels.ts'))as typeof import('../src/engine/float-pixels');
  const {instantiateKernel}=await import(/* @vite-ignore */String('/src/engine/wasm.ts'))as typeof import('../src/engine/wasm');
  const assets=new AssetStore(),doc=new window.luma.Document({assets}),file=await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),plan=await captureStyledTextPlan({width:160,height:160,style:{fontFamily:file.family},lines:[{spans:[{text:'AA'}]}]},doc.toJSON(),assets),native=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await(await fetch('/wasm/pixels.wasm')).arrayBuffer()))),processor={floatComposite:async(...args:Parameters<typeof native.composite>)=>native.composite(...args)};
  try{const font=await plan.captureGlyphFont(file.id),match=await plan.matchGlyphRun(font,{text:'AA',style:{fontSize:40,fontWeight:'600',letterSpacing:-45,fontKerning:'none'},transform:[1,0,0,1,32,120]});if(match.status!=='matched')return{status:match.status,results:[]};
   const canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;const c=canvas.getContext('2d')!;c.font='600 40px '+file.family;c.fontKerning='none';c.fillStyle='#fff';const coverage=[32,43].map(x=>{c.clearRect(0,0,160,160);c.fillText('A',x,120);return c.getImageData(0,0,160,160).data;}),results=[];
   for(const alpha of [.5,.64123012345,1e-8]){const color=[4,-.25,1.5,alpha]as const,glyphs=match.glyphs.map(g=>({...g,color})),area={x:0,y:0,width:160,height:160},full=await plan.renderGlyphs(glyphs,area,processor),parts=new Float32Array(full.length);let alphaError=0,maxAlpha=0,rgb:number[]=[];
    for(let i=0;i<160*160;i++){const a=Math.fround(Math.fround(alpha)*Math.fround(coverage[0][i*4+3]/255)),b=Math.fround(Math.fround(alpha)*Math.fround(coverage[1][i*4+3]/255)),expected=Math.fround(b+a*(1-b));alphaError=Math.max(alphaError,Math.abs(expected-full[i*4+3]));if(full[i*4+3]>maxAlpha){maxAlpha=full[i*4+3];rgb=[...full.slice(i*4,i*4+3)];}}
    for(let x=0;x<160;x+=53){const width=Math.min(53,160-x),part=await plan.renderGlyphs(glyphs,{...area,x,width},processor);for(let y=0;y<160;y++)parts.set(part.subarray(y*width*4,(y+1)*width*4),(y*160+x)*4);}
    results.push({alpha,maxAlpha,alphaError,rgb,partitions:new Uint32Array(full.buffer).every((v,i)=>v===new Uint32Array(parts.buffer)[i])});
   }return{status:match.status,settings:match.run.settings,results};
  }finally{plan.release();assets.dispose();}
 },bytes);await writeFile(info.outputPath('css-native-float-paint.json'),JSON.stringify(result,null,2));expect(result.status).toBe('matched');for(const r of result.results){expect(r.alphaError).toBe(0);expect(r.maxAlpha).toBeGreaterThan(0);expect(r.rgb).toEqual([4,-.25,1.5]);expect(r.partitions).toBe(true);}
});
