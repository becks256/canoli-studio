import{expect,type Page,type TestInfo}from'@playwright/test';
import{readFile,readdir,writeFile}from'node:fs/promises';
export async function productionFloatSources(page:Page,info:TestInfo){
 const files=await readdir('dist/assets'),find=async(needle:string)=>{const matches=[];for(const file of files.filter(v=>v.endsWith('.js')))if((await readFile('dist/assets/'+file,'utf8')).includes(needle))matches.push('/assets/'+file);expect(matches).toHaveLength(1);return matches[0];},prepare=await find('Float source color identity differs'),read=await find('Float reader source identity is missing.');
 const references=JSON.parse(await readFile('tests/fixtures/float-source/manifest.json','utf8')),target=[...await readFile('tests/fixtures/icc-native/linear-srgb.icc')],results=[];
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 for(const fixture of references.cases.filter((r:any)=>r.width<10000)){
  const result=await page.evaluate(async({prepare,read,fixture,target,original})=>{
   const prep=new Worker(prepare,{type:'module'}),reader=new Worker(read,{type:'module'}),tiles:any[]=[];let descriptor:any,key='',prepared:any;
   try{
    await new Promise<void>((resolve,reject)=>{prep.onerror=event=>reject(new Error(event.message));prep.onmessage=event=>{const data=event.data;if(data.kind==='error'){reject(new Error(data.error));return;}if(data.kind==='descriptor'){descriptor=data.descriptor;key=data.key;prep.postMessage({kind:'continue'});}else if(data.kind==='prepared')prepared=data.prepared;else if(data.kind==='tile'||data.kind==='tiles'){const batch=data.kind==='tile'?[data.tile]:data.tiles;if(!Array.isArray(batch)||batch.length<1||batch.length>8){reject(new Error('Invalid native float tile packet size.'));return;}tiles.push(...batch);prep.postMessage({kind:'ack'});}else if(data.kind==='complete')resolve();};prep.postMessage({kind:'start',input:{original:new Blob([new Uint8Array(original)],{type:'image/tiff'}),target:new Blob([new Uint8Array(target)]),width:fixture.width,height:fixture.height,tiff:{page:0,allowPrecisionLoss:false,...(fixture.assumption?{floatColorSpace:fixture.assumption}:{})},expectedSource:fixture.assumption?{kind:'assumed',id:fixture.assumption,sha256:fixture.sourceProfileSha256}:{kind:'icc',sha256:fixture.sourceProfileSha256},intent:'relative-colorimetric',blackPointCompensation:false}});});
    const manifest={version:1,key,buildId:crypto.randomUUID(),descriptor,prepared,tiles:tiles.map(tile=>tile.meta)},pixels=await new Promise<Float32Array>((resolve,reject)=>{reader.onerror=event=>reject(new Error(event.message));reader.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data.pixels);reader.postMessage({id:1,manifest,bounds:{x:0,y:0,width:fixture.width,height:fixture.height},tiles});});
    const hash=async(bytes:BufferSource)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    return{file:fixture.file,floatSha256:await hash(pixels.buffer as ArrayBuffer),sourceSha256:descriptor.sourceSha256,targetProfileSha256:descriptor.targetProfileSha256,tiles:tiles.length,float:pixels instanceof Float32Array,length:pixels.length,globals:'luma'in window};
   }finally{prep.terminate();reader.terminate();}
  },{prepare,read,fixture,target,original:[...await readFile('tests/fixtures/tiff-float/'+fixture.file)]});
  expect(result).toMatchObject({floatSha256:fixture.floatSha256,sourceSha256:fixture.sourceSha256,targetProfileSha256:references.targetProfileSha256,float:true,length:fixture.samples,globals:false});results.push(result);
 }
 await writeFile(info.outputPath('production-float-sources.json'),JSON.stringify({prepare,read,results},null,2));
}
