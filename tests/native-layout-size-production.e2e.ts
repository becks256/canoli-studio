import {test,expect} from '@playwright/test';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileGlyphSelectors} from '../src/fonts/glyph-sfnt';

test('emitted native SVG metrics and shaping worker retain independently observed fractional mark placement',async({page},info)=>{
 const source=new Uint8Array(await readFile('tests/fixtures/shaping-font/Shaping.ttf')),reference=[...await readFile('tests/fixtures/native-layout/Mark-only.ttf')],prepared=compileGlyphSelectors(source),files=await readdir('dist/assets'),modules=files.filter(f=>/^native-svg-metrics-.*\.js$/.test(f)),workers=files.filter(f=>/^font-shaping-worker-.*\.js$/.test(f));
 expect(modules).toHaveLength(1);expect(workers).toHaveLength(1);
 const module=modules[0],worker=workers[0],bytes=await readFile('dist/assets/'+module);
 await page.goto('/');const result=await page.evaluate(async({source,reference,prepared,selectors,glyphCount,module,worker})=>{
  const emitted=await import(/* @vite-ignore */('/assets/'+module))as Record<string,unknown>,api=(typeof emitted.captureNativeSvgMetrics==='function'?emitted:Object.values(emitted).find(v=>v&&typeof v==='object'&&'captureNativeSvgMetrics'in v))as typeof import('../src/engine/native-svg-metrics');
  if(!api)throw new Error('Emitted SVG metrics namespace missing');
  const privateFace=new FontFace('PreparedLayoutProduction',new Uint8Array(prepared).buffer),referenceFace=new FontFace('IndependentLayoutProduction',new Uint8Array(reference).buffer);
  await Promise.all([privateFace.load(),referenceFace.load()]);document.fonts.add(privateFace);document.fonts.add(referenceFace);
  let alive=true,leases=0;
  const check=()=>{if(!alive||!document.fonts.has(privateFace)||!document.fonts.has(referenceFace))throw new Error('Production metric sources retired');};
  const assets={captureLifetime:()=>check,fonts:{retain(id:string){check();if(id!=='prepared-source')throw new Error('Unknown metric source');leases++;return{check,resource:{renderBlob:new Blob([new Uint8Array(source)]),descriptor:{report:{faces:[{axes:[],unitsPerEm:1000,glyphCount}]}}},release(){leases--;}};}}}as unknown as import('../src/core/assets').AssetStore;
  const rows=[],context=document.createElement('canvas').getContext('2d')!,css={weight:400,width:100,style:'normal'as const,opticalSize:40};
  try{
   for(const size of [40,44.27753448486328,33.333,64.5]){
    const metrics=await api.captureNativeSvgMetrics(assets,'prepared-source',new Uint8Array(prepared),privateFace.family,'normal',[7,8],[String.fromCodePoint(selectors[7]),String.fromCodePoint(selectors[8])],{fontSize:40,fontWeight:'400',fontStyle:'normal'},css,size,{}, {native:true});
    const glyphs=await new Promise<{xAdvance:number;xOffset:number;yOffset:number}[]>((resolve,reject)=>{
     const w=new Worker('/assets/'+worker,{type:'module'}),timer=setTimeout(()=>{w.terminate();reject(new Error('Production layout shaping timed out'));},10000);
     w.onerror=()=>{clearTimeout(timer);w.terminate();reject(new Error('Production layout shaping failed'));};
     w.onmessage=e=>{clearTimeout(timer);w.terminate();if(e.data?.error)return reject(new Error(String(e.data.error)));const data=e.data?.data;if(!(data instanceof Float64Array)||data.length!==14||data[0]!==7||data[7]!==8)return reject(new Error('Invalid production mark glyphs'));resolve([0,7].map(p=>({xAdvance:data[p+3],xOffset:data[p+5],yOffset:data[p+6]})));};
     w.postMessage({bytes:new Uint8Array(source),input:{text:'a\u0301',css,nativeMetrics:metrics.nativeMetrics},settings:'normal',timeoutMs:10000});
    });
    context.font=`${size}px ${referenceFace.family}`;context.fontKerning='none';const native=context.measureText('a\u0301');
    context.font=`${size}px ${privateFace.family}`;const mark=context.measureText(String.fromCodePoint(selectors[8]));
    rows.push({size,em:metrics.em,observedX:native.actualBoundingBoxRight-mark.actualBoundingBoxRight,observedY:native.actualBoundingBoxAscent-mark.actualBoundingBoxAscent,predictedX:(glyphs[0].xAdvance+glyphs[1].xOffset)*metrics.em/1000,predictedY:glyphs[1].yOffset*metrics.em/1000});
   }
   return{rows,leases,developmentGlobal:'luma'in window,calibrationFaces:[...document.fonts].filter(f=>f.family.startsWith('CanoliSize_')).length};
  }finally{alive=false;document.fonts.delete(privateFace);document.fonts.delete(referenceFace);}
 },{source:[...source],reference,prepared:[...prepared.bytes],selectors:[...prepared.selectors],glyphCount:prepared.glyphCount,module,worker});
 expect(result).toMatchObject({leases:0,developmentGlobal:false,calibrationFaces:0});expect(result.rows).toHaveLength(4);
 for(const row of result.rows){expect(row.predictedX).toBeCloseTo(row.observedX,5);expect(row.predictedY).toBeCloseTo(row.observedY,5);}
 await writeFile(info.outputPath('production-layout-scale.json'),JSON.stringify({module,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),worker,scope:'Actual emitted SVG metric capture, calibration font and shaping worker; prepared source leases and independent original FontTools mark-only native reference. Full captured-plan placement is covered in source browser tests.',result},null,2));
});
