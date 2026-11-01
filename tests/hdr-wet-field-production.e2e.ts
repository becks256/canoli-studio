import {test,expect} from '@playwright/test';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';

test('built HDR wet worker retains independent Float64 fields and final Float32 output without developer globals',async({page},info)=>{
  const workers=(await readdir('dist/assets')).filter(name=>/^pixels\.worker-.*\.js$/.test(name));expect(workers).toHaveLength(1);
  const base='tests/fixtures/hdr-wet-field/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8')),raw=Object.fromEntries(await Promise.all(['before','field','full-field','spatial-source'].map(async name=>[name,[...gunzipSync(await readFile(base+name+'.bin.gz'))]])));
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  const rows=await page.evaluate(async({workerPath,raw,manifest})=>{
    const worker=new Worker(workerPath,{type:'module'}),decode=(name:string)=>Uint8Array.from(raw[name]).buffer,rows:{name:string;bytes:number[]}[]=[];let sequence=0;
    try{
      await new Promise<void>((resolve,reject)=>{worker.onmessage=event=>{if(event.data.type==='ready')resolve();else if(event.data.type==='fatal')reject(new Error(event.data.error));};worker.onerror=event=>reject(new Error(event.message));});
      const request=(payload:Record<string,unknown>)=>new Promise<Float32Array|Float64Array>((resolve,reject)=>{const id=++sequence;worker.onmessage=event=>{if(event.data.id===id)event.data.error?reject(new Error(event.data.error)):resolve(event.data.pixels);};worker.onerror=event=>reject(new Error(event.message));worker.postMessage({id,pixels:new Uint8ClampedArray(0),...payload});});
      const save=(name:string,value:Float32Array|Float64Array)=>{if(value.byteOffset||value.byteLength!==value.buffer.byteLength)throw new Error('Incomplete HDR worker output.');rows.push({name,bytes:[...new Uint8Array(value.buffer)]});};
      for(const [name,opacity]of [['zero',0],['partial',.625],['covered',1],['full',1]] as const){const pixels=await request({floatCompositeHdrWet:{pixels:new Float32Array(decode('before')),field:new Float64Array(decode(name==='full'?'full-field':'field')),opacity}});if(!(pixels instanceof Float32Array))throw new Error('HDR replacement requires Float32 output.');save('composite-'+name,pixels);}
      for(let index=0;index<manifest.mappings.length;index++){const values=await request({floatMappedHdrWet:{field:new Float64Array(decode('spatial-source')),options:{mapping:manifest.mappings[index],field:manifest.bounds,source:manifest.bounds,output:manifest.window,background:0}}});if(!(values instanceof Float64Array))throw new Error('HDR field lost Float64 precision.');save('spatial-'+index,values);}
      const region={x:0,y:0,width:23,height:17},pixels=await request({floatProjectiveHdrWet:{field:new Float64Array(decode('spatial-source')),options:{sourceWidth:23,sourceHeight:17,corners:[{x:0,y:0},{x:23,y:0},{x:23,y:17},{x:0,y:17}],field:region,source:region,output:region,background:0}}});if(!(pixels instanceof Float64Array))throw new Error('HDR projective field lost Float64 precision.');save('spatial-source',pixels);
      return rows;
    }finally{worker.terminate();}
  },{workerPath:'/assets/'+workers[0],raw,manifest});
  for(const row of rows){const actual=Buffer.from(row.bytes);expect(actual.equals(gunzipSync(await readFile(base+row.name+'.bin.gz'))),row.name).toBe(true);await writeFile(info.outputPath(row.name+'.bin'),actual);}
  expect(await page.evaluate(()=>'luma' in window)).toBe(false);await writeFile(info.outputPath('hdr-production.json'),JSON.stringify({worker:workers[0],debugGlobals:false,rows:rows.map(row=>({name:row.name,bytes:row.bytes.length,exact:true}))},null,2));
});

test.describe('prepared HDR dependency guide',()=>{
  test.use({javaScriptEnabled:false,viewport:{width:390,height:844}});
  test('the built guide is readable without JavaScript and states its private integration boundary',async({page})=>{
    await page.goto('/developer/hdr-wet-fields.html');
    await expect(page.getByRole('heading',{name:'Prepared HDR wet assets and fields',exact:true})).toBeVisible();
    await expect(page.locator('main')).toContainText('not a public scripting service');
    await expect(page.locator('main')).toContainText('FloatScene replay');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  });
});
