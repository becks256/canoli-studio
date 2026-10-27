import {test,expect}from '@playwright/test';
import {readFile,writeFile}from 'node:fs/promises';
const base='tests/fixtures/icc-native/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8'));
test('real ICC workers preserve independent conversion/proof pixels, source ownership and document history',async({page},info)=>{
 const profiles=Object.fromEntries(await Promise.all([...new Set<string>(manifest.cases.map((r:{profile:string})=>r.profile))].map(async name=>[name,[...await readFile(base+name)]]))),source=[...await readFile(base+'source.rgba')],expected=Object.fromEntries(await Promise.all(manifest.cases.map(async(r:{pixels:string})=>[r.pixels,[...await readFile(base+r.pixels)]])));
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async({profiles,source,expected,cases})=>{
  const{IccSession}=await import(/* @vite-ignore */String('/src/core/color/icc-client.ts')),{iccIntents}=await import(/* @vite-ignore */String('/src/core/color/icc-types.ts')),editor=window.luma.editor,before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,rows=[];
  for(const row of cases){
   const blob=new Blob([new Uint8Array(profiles[row.profile])]),value={mode:row.mode,intent:iccIntents[row.intent],blackPointCompensation:row.blackPointCompensation,...(row.mode==='proof'?{proofIntent:iccIntents[row.proofIntent]}:{})},owner=await IccSession.prepare(blob,value),input=new Uint8ClampedArray(source);
   try{const actual=await owner.session.apply(input),reference=expected[row.pixels];let colorError=0,alphaError=0;for(let i=0;i<actual.length;i++){if(i%4===3)alphaError=Math.max(alphaError,Math.abs(actual[i]-reference[i]));else colorError=Math.max(colorError,Math.abs(actual[i]-reference[i]));}rows.push({profile:row.profile,mode:row.mode,intent:row.intent,reference:row.reference,colorError,alphaError,inputOwned:input.every((v,i)=>v===source[i]),prepared:owner.prepared});}finally{owner.session.dispose();}
  }
  const report=await IccSession.inspect(new Blob([new Uint8Array(profiles['synthetic-cmyk.icc'])]));return{rows,report,unchanged:before===JSON.stringify(editor.document.toJSON()),historyUnchanged:revision===editor.document.getSnapshot().revision};
 },{profiles,source,expected,cases:manifest.cases});
 await writeFile(info.outputPath('independent.json'),JSON.stringify(result,null,2));expect(result.unchanged).toBe(true);expect(result.historyUnchanged).toBe(true);expect(result.report.colorSpace).toBe('CMYK');expect(result.rows).toHaveLength(23);
 for(const row of result.rows){expect(row.alphaError).toBe(0);expect(row.inputOwned).toBe(true);expect(row.colorError).toBeLessThanOrEqual(row.profile==='synthetic-cmyk.icc'&&row.reference==='Pillow 10.3.0 / Little CMS 2.16'?1:0);}
});
test('real ICC queue cancellation, failed profiles and aborted owners release slots for subsequent work',async({page},info)=>{
 const bytes=[...await readFile(base+'narrow-rgb.icc')];await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async bytes=>{
  const{IccSession}=await import(/* @vite-ignore */String('/src/core/color/icc-client.ts')),blob=new Blob([new Uint8Array(bytes)]),a=await IccSession.prepare(blob,{mode:'proof'}),b=await IccSession.prepare(blob,{mode:'proof'}),abort=new AbortController(),queued=IccSession.prepare(blob,{mode:'proof'},{signal:abort.signal}).then(()=>false,(error:unknown)=>error instanceof Error&&error.name==='AbortError');abort.abort();const cancelled=await queued;a.session.dispose();b.session.dispose();
  let malformed=false;try{const bad=new Uint8Array(bytes);bad.fill(0,36,40);await IccSession.inspect(new Blob([bad]));}catch{malformed=true;}
  const active=new AbortController(),owner=await IccSession.prepare(blob,{mode:'proof'},{signal:active.signal}),pixels=owner.session.apply(new Uint8ClampedArray(4*1024*1024)).then(()=>false,(error:unknown)=>error instanceof Error&&error.name==='AbortError');active.abort();const aborted=await pixels;
  const recovered=await IccSession.prepare(blob,{mode:'proof',gamutWarning:true,warningColor:'#ff00ff'});let pixel:number[];try{pixel=[...await recovered.session.apply(new Uint8ClampedArray([255,0,0,87]))];}finally{recovered.session.dispose();}
  return{cancelled,malformed,aborted,pixel};
 },bytes);
 await writeFile(info.outputPath('lifecycle.json'),JSON.stringify(result,null,2));expect(result).toEqual({cancelled:true,malformed:true,aborted:true,pixel:[255,0,255,87]});
});
