import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
const directory='tests/fixtures/icc-precision/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'));
test('real workers convert explicit RGB sources across uint8/uint16/float formats with independent native samples',async({page},info)=>{
 const profiles=Object.fromEntries(await Promise.all(Object.keys(manifest.profileHashes).map(async name=>[name,[...await readFile('tests/fixtures/icc-native/'+name+'.icc')]]))),files=Object.fromEntries(await Promise.all(Object.keys(manifest.files).map(async name=>[name,[...await readFile(directory+name)]])));
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async({profiles,files,cases})=>{
  const{IccSession}=await import(/* @vite-ignore */String('/src/core/color/icc-client.ts')),{iccIntents}=await import(/* @vite-ignore */String('/src/core/color/icc-types.ts')),editor=window.luma.editor,before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;
  const samples=(bytes:number[],format:string)=>{const owned=new Uint8Array(bytes).buffer;return format==='rgba8'?new Uint8ClampedArray(owned):format==='rgba16'?new Uint16Array(owned):new Float32Array(owned);},rows=[];
  for(const row of cases){
   const owner=await IccSession.prepareRgb(new Blob([new Uint8Array(profiles[row.source])]),new Blob([new Uint8Array(profiles[row.destination])]),{inputFormat:row.inputFormat,outputFormat:row.outputFormat,intent:iccIntents[row.intent],blackPointCompensation:row.blackPointCompensation});
   try{
    const input=samples(files[row.input],row.inputFormat),copy=input.slice(),expected=samples(files[row.output],row.outputFormat),actual=await owner.session.applyWindow(input);let colorError=0,alphaError=0;
    for(let i=0;i<actual.length;i++){if(i%4===3)alphaError=Math.max(alphaError,Math.abs(actual[i]-expected[i]));else colorError=Math.max(colorError,Math.abs(actual[i]-expected[i]));}
    rows.push({source:row.source,destination:row.destination,inputFormat:row.inputFormat,outputFormat:row.outputFormat,pixels:actual.length/4,colorError,alphaError,owned:actual.buffer!==input.buffer,inputUnchanged:input.length===copy.length&&input.every((v,i)=>v===copy[i]),rightType:actual.constructor===expected.constructor,prepared:owner.prepared});
   }finally{owner.session.dispose();}
  }
  return{rows,modelUnchanged:before===JSON.stringify(editor.document.toJSON()),historyUnchanged:revision===editor.document.getSnapshot().revision};
 },{profiles,files,cases:manifest.cases});
 await writeFile(info.outputPath('native-precision.json'),JSON.stringify(result,null,2));expect(result.rows).toHaveLength(24);expect(result.modelUnchanged&&result.historyUnchanged).toBe(true);
 for(const row of result.rows){expect(row.owned&&row.inputUnchanged&&row.rightType).toBe(true);expect(row.alphaError).toBe(0);expect(row.colorError).toBeLessThanOrEqual(row.outputFormat==='rgba-float32'?2e-6:0);}
});
test('mixed legacy/precision queue, active cancellation, malformed sources and retry share worker ownership',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async()=>{
  const{IccSession}=await import(/* @vite-ignore */String('/src/core/color/icc-client.ts')),source=await(await fetch('/tests/fixtures/icc-native/linear-srgb.icc')).blob(),a=await IccSession.prepare(source,{mode:'convert'}),b=await IccSession.prepareRgb(source,source,{inputFormat:'rgba16'}),abort=new AbortController(),queued=IccSession.prepareRgb(source,source,{inputFormat:'rgba-float32'},{signal:abort.signal}).then(()=>false,(e:Error)=>e.name==='AbortError');abort.abort();const queuedCancelled=await queued;a.session.dispose();b.session.dispose();
  const active=new AbortController(),owner=await IccSession.prepareRgb(source,source,{inputFormat:'rgba-float32'},{signal:active.signal}),input=new Float32Array(4*1024*1024),pending=owner.session.applyWindow(input).then(()=>false,(e:Error)=>e.name==='AbortError');active.abort();const activeCancelled=await pending;
  let malformed=false;try{await IccSession.prepareRgb(new Blob([new Uint8Array(132)]),source);}catch{malformed=true;}
  const recovered=await IccSession.prepareRgb(source,source,{inputFormat:'rgba-float32'});let actual:number[];try{actual=[...await recovered.session.applyWindow(new Float32Array([-.125,2,.50001,.625]))];}finally{recovered.session.dispose();}
  return{queuedCancelled,activeCancelled,malformed,inputAttached:input.length===4*1024*1024,actual};
 });
 await writeFile(info.outputPath('precision-lifecycle.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({queuedCancelled:true,activeCancelled:true,malformed:true,inputAttached:true});expect(result.actual).toEqual([...new Float32Array([-.125,2,.50001,.625])]);
});
test('genuine 50 MP linear RGB16 source converts in bounded windows matching every independent native output byte',async({page},info)=>{
 test.setTimeout(480000);const reference=JSON.parse(await readFile(directory+'large-reference.json','utf8'));await page.route('**/__icc-precision-large-source',route=>route.fulfill({path:'tests/fixtures/raw/native-50mp.rgb16le.gz',contentType:'application/gzip'}));await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async reference=>{
  const{IccSession}=await import(/* @vite-ignore */String('/src/core/color/icc-client.ts')),editor=window.luma.editor,before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;
  const source=await(await fetch('/tests/fixtures/icc-native/linear-srgb.icc')).blob(),destination=await(await fetch('/tests/fixtures/icc-native/display-p3.icc')).blob(),owner=await IccSession.prepareRgb(source,destination,{inputFormat:'rgba16'}),response=await fetch('/__icc-precision-large-source');if(!response.ok||!response.body)throw new Error('Missing 50 MP reference');
  const reader=response.body.pipeThrough(new DecompressionStream('gzip')).getReader(),sampleWindow=new Uint8Array(reference.windowPixels*6),hashes:Uint8Array[]=[],hex=(bytes:Uint8Array)=>[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');let offset=0,pixels=0,inputOwned=true,exactAlpha=true;
  const process=async()=>{
   const rgb=new Uint16Array(sampleWindow.buffer,0,offset/2),input=new Uint16Array(rgb.length/3*4),base=pixels;
   for(let i=0;i<rgb.length/3;i++)input.set([rgb[i*3],rgb[i*3+1],rgb[i*3+2],((base+i)*53+11)&65535],i*4);
   const actual=await owner.session.applyWindow(input);if(!(actual instanceof Uint16Array))throw new Error('Wrong output precision');
   inputOwned&&=input.length===actual.length;for(let i=0;i<input.length;i+=4){if(input[i]!==rgb[i/4*3]||input[i+1]!==rgb[i/4*3+1]||input[i+2]!==rgb[i/4*3+2])inputOwned=false;if(actual[i+3]!==input[i+3])exactAlpha=false;}
   hashes.push(new Uint8Array(await crypto.subtle.digest('SHA-256',actual.buffer as ArrayBuffer)));pixels+=input.length/4;offset=0;
  };
  try{
   for(;;){const{done,value}=await reader.read();if(done)break;let at=0;while(at<value.length){const length=Math.min(sampleWindow.length-offset,value.length-at);sampleWindow.set(value.subarray(at,at+length),offset);offset+=length;at+=length;if(offset===sampleWindow.length)await process();}}
   if(offset){if(offset%6)throw new Error('Partial input sample');await process();}
   const joined=new Uint8Array(hashes.length*32);hashes.forEach((hash,i)=>joined.set(hash,i*32));return{pixels,windows:hashes.length,inputOwned,exactAlpha,windowPixels:reference.windowPixels,rootSha256:hex(new Uint8Array(await crypto.subtle.digest('SHA-256',joined))),modelUnchanged:before===JSON.stringify(editor.document.toJSON()),historyUnchanged:revision===editor.document.getSnapshot().revision};
  }finally{try{await reader.cancel();}finally{owner.session.dispose();}}
 },reference);
 await writeFile(info.outputPath('native-precision-50mp.json'),JSON.stringify({reference,actual:result},null,2));expect(result).toEqual({pixels:50000000,windows:reference.windows,inputOwned:true,exactAlpha:true,windowPixels:reference.windowPixels,rootSha256:reference.windowDigestRootSha256,modelUnchanged:true,historyUnchanged:true});
});
