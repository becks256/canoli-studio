import {test,expect} from '@playwright/test';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('production full pinned shaping worker retains complex glyphs and source vertical metrics on its first message',async({page},info)=>{
 const unexpectedRequests:string[]=[];page.on('request',request=>{if(/canoli_harfbuzz\.wasm|font-shaper-runtime/.test(request.url()))unexpectedRequests.push(request.url());});
 const bytes=[...await readFile('tests/fixtures/shaping-font/Shaping.ttf')],files=(await readdir('dist/assets')).filter(name=>/^font-shaping-worker-.*\.js$/.test(name));expect(files).toHaveLength(1);const workerBytes=await readFile('dist/assets/'+files[0]);await page.goto('/');const result=await page.evaluate(async({bytes,path})=>{
  const rows=[];
  for(const input of [{text:'fi'},{text:'a\u0301'},{text:'ببلا',direction:'rtl'},{text:'AV',direction:'ttb'}]){
   const value=await new Promise<{engine:string;unitsPerEm:number;glyphCount:number;data:Float64Array}>((resolve,reject)=>{const w=new Worker(path,{type:'module'}),timer=setTimeout(()=>{w.terminate();reject(new Error('Production shaping first-message timeout'));},10000),finish=()=>{clearTimeout(timer);w.terminate();};w.onerror=()=>{finish();reject(new Error('Production shaping worker failed'));};w.onmessage=event=>{finish();event.data?.error?reject(new Error(event.data.error)):resolve(event.data);};w.postMessage({bytes:new Uint8Array(bytes),input,settings:'normal',timeoutMs:10000});});
   const data=Array.from(value.data);rows.push({input,engine:value.engine,unitsPerEm:value.unitsPerEm,glyphCount:value.glyphCount,glyphs:Array.from({length:data.length/7},(_,i)=>data.slice(i*7,i*7+7))});
  }
  return rows;
 },{bytes,path:'/assets/'+files[0]});expect(result.map(r=>r.glyphs.map(g=>g[0]))).toEqual([[6],[7,8],[11,14,13],[2,3]]);expect(result[3].glyphs.map(g=>g[4])).toEqual([-1100,-1100]);for(const row of result)expect(row).toMatchObject({engine:'HarfBuzz 15.0.0',unitsPerEm:1000,glyphCount:18});expect(unexpectedRequests).toEqual([]);await writeFile(info.outputPath('production-full-shaping.json'),JSON.stringify({unexpectedRequests,worker:files[0],bytes:workerBytes.length,sha256:createHash('sha256').update(workerBytes).digest('hex'),result},null,2));
});
