import{expect,type Page,type TestInfo}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
const base='tests/fixtures/float-pixels/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8'));
async function numbers(name:string){return[...new Float32Array(new Uint8Array(gunzipSync(await readFile(base+name+'.f32le.gz'))).buffer)];}
export async function floatWorkerWorkflow(page:Page,info:TestInfo,production=false,workerPath?:string){
 await page.goto('/');const result=await page.evaluate(async({source,backdrop,mask,expected,matrix,reference,manifest,production,workerPath})=>{
  const original=new Float32Array(source),back=new Float32Array(backdrop),coverage=new Float32Array(mask);let worker:Worker|undefined,sequence=0,processor:any;
  if(production){worker=new Worker(workerPath!,{type:'module'});await new Promise<void>((resolve,reject)=>{worker!.onmessage=event=>event.data.type==='ready'?resolve():event.data.type==='fatal'?reject(new Error(event.data.error)):null;worker!.onerror=()=>reject(new Error('Float worker failed.'));});}
  else processor=window.luma.editor.renderer.processor;
  const request=async(payload:Record<string,unknown>)=>{if(!worker)throw new Error('Missing worker');const id=++sequence;return new Promise<Float32Array>((resolve,reject)=>{worker!.onmessage=event=>{if(event.data.id===id)event.data.error?reject(new Error(event.data.error)):resolve(event.data.pixels);};worker!.postMessage({id,pixels:new Uint8ClampedArray(0),...payload});});};
  const rows=[];try{for(let mode=0;mode<manifest.modes.length;mode++){
   const options={mode:manifest.modes[mode],opacity:manifest.opacity,mask:coverage},actual:Float32Array=production?await request({floatComposite:{source:original,backdrop:back,options}}):await processor.floatComposite(original,back,options);if(!(actual instanceof Float32Array)||actual.length!==original.length)throw new Error('Float worker returned byte/wrong pixels');let maximum=0,alpha=0;for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[mode*original.length+i]);if(i%4===3)alpha=Math.max(alpha,d);else maximum=Math.max(maximum,d);}rows.push({mode:manifest.modes[mode],maximum,alpha});if(mode===5&&!production)await processor.process(new Uint8ClampedArray([71,88,99,255]),[]);}
   const actual:Float32Array=production?await request({floatAffine:{pixels:original,matrix}}):await processor.floatAffine(original,matrix);let affineMaximum=0;for(let i=0;i<actual.length;i++)affineMaximum=Math.max(affineMaximum,Math.abs(actual[i]-reference[i]));
   let rejected=false;try{const bad=new Float32Array([Infinity,0,0,1]);if(production)await request({floatComposite:{source:bad,backdrop:bad,options:{}}});else await processor.floatComposite(bad,bad);}catch{rejected=true;}
   const retry:Float32Array=production?await request({floatComposite:{source:original,backdrop:back,options:{opacity:0}}}):await processor.floatComposite(original,back,{opacity:0});
   return{production,globals:'luma'in window,rows,affineMaximum,rejected,retryExact:retry.every((v,i)=>v===back[i]),sourceUnchanged:original.every((v,i)=>v===source[i])&&back.every((v,i)=>v===backdrop[i])&&coverage.every((v,i)=>v===mask[i])};
  }finally{worker?.terminate();}
 },{source:await numbers('source'),backdrop:await numbers('backdrop'),mask:await numbers('mask'),expected:await numbers('composites'),reference:await numbers('affine'),matrix:manifest.matrix,manifest,production,workerPath});
 expect(result.globals).toBe(!production);expect(result.rows).toHaveLength(18);for(const row of result.rows){expect(row.maximum).toBeLessThanOrEqual(manifest.tolerance);expect(row.alpha).toBe(0);}expect(result.affineMaximum).toBeLessThanOrEqual(manifest.tolerance);expect(result.rejected).toBe(true);expect(result.retryExact).toBe(true);expect(result.sourceUnchanged).toBe(true);await writeFile(info.outputPath('float-workers.json'),JSON.stringify(result,null,2));
}
