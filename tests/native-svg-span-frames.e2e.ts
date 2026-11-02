import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';

test('original colored spans retain native ink, font priority and ownership in all straight mixed controls',async({page},info)=>{
 const sources=await Promise.all(['native-fallback/Latin-no-mark.ttf','shaping-font/Shaping.ttf'].map(async file=>[...await readFile('tests/fixtures/'+file)]));
 await page.goto('/');const result=await page.evaluate(async sources=>{
  const {AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'))as typeof import('../src/core/assets');
  const {captureStyledTextPlan}=await import(/* @vite-ignore */String('/src/engine/styled-text.ts'))as typeof import('../src/engine/styled-text');
  const assets=new AssetStore(),doc=new window.luma.Document({assets}),files:Awaited<ReturnType<typeof doc.fonts.embed>>[]=[];
  for(const bytes of sources)files.push(await doc.fonts.embed(new Blob([new Uint8Array(bytes)])));
  const before=JSON.stringify(doc.toJSON()),rows=[];
  try{
   for(const stack of [false,true])for(const direction of ['ltr','rtl']as const)for(const affine of [false,true]){
    const plan=await captureStyledTextPlan({width:512,height:512,transform:affine?[1.25,.125,-.25,.9,15,14]:[1,0,0,1,0,0],style:{fontFamily:stack?files.map(file=>file.family).join(', '):files[1].family,fontSize:40,letterSpacing:-30},lines:[{x:220,y:160,direction,align:'center',writing:{mode:'vertical-rl',orientation:'mixed'},spans:[{text:'AV ',style:{color:'color(srgb-linear 4 -.25 1.5 / .5)'}},{text:'a\u0301',style:{color:'color(srgb-linear -.5 3 .125 / .25)'}},{text:' fi',style:{color:'color(srgb-linear 4 -.25 1.5 / .5)'}}]}]},doc.toJSON(),assets,{captureLinearPaint:true});
    try{
     plan.retireMeasurement();const match=await plan.matchStyledGlyphLine(0);
     rows.push({stack,direction,affine,status:match.status,evidence:match.evidence,...(match.status==='matched'?{glyphs:match.glyphs.map(g=>({cluster:g.sourceCluster,family:g.font.sourceFamily,expected:files[!stack||g.sourceCluster!>=3&&g.sourceCluster!<5?1:0].family,color:g.color})),texts:match.runs!.map(run=>run.request.text)}:{reason:match.reason})});
    }finally{plan.release();}
   }
   return{rows,unchanged:JSON.stringify(doc.toJSON())===before,probes:document.querySelectorAll('[data-canoli-styled-text-probe],[data-canoli-svg-glyph-probe]').length,faces:[...document.fonts].filter(f=>/Canoli(Glyph|Variation|Size)_/.test(f.family)).length};
  }finally{assets.dispose();}
 },sources);
 await writeFile(info.outputPath('native-source-span-frames.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({unchanged:true,probes:0,faces:0});expect(result.rows).toHaveLength(8);
 for(const row of result.rows){
  expect(row.status,JSON.stringify(row)).toBe('matched');expect(row.evidence).toMatchObject({svgMaxAlphaError:0,paintOwnership:{error:0,colors:2}});
  if('glyphs'in row){for(const glyph of row.glyphs){expect(glyph.family).toBe(glyph.expected);expect(glyph.color).toEqual(glyph.cluster!>=3&&glyph.cluster!<5?[-.5,3,.125,.25]:[4,-.25,1.5,.5]);}for(const text of row.texts)expect(text).toBe('AV a\u0301 fi');}
 }
});
