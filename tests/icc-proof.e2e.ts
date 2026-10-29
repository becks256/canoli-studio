import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';

test('actual proof workers match independent native formats, RGB/CMYK device intents and gamut alarms',async({page},info)=>{
 const manifest=JSON.parse(await readFile('tests/fixtures/icc-proof/manifest.json','utf8'));
 const profiles:Record<string,number[]>={},windows:Record<string,number[]>={};
 for(const name of Object.keys(manifest.profileHashes))profiles[name]=[...await readFile('tests/fixtures/icc-native/'+name+'.icc')];
 for(const row of manifest.cases)for(const name of[row.input,row.output])if(!windows[name])windows[name]=[...await readFile('tests/fixtures/icc-proof/'+name)];
 await page.goto('/');const result=await page.evaluate(async({cases,profiles,windows})=>{
  const{IccSession}=await import(/* @vite-ignore */String('/src/core/color/icc-client.ts')),{iccIntents}=await import(/* @vite-ignore */String('/src/core/color/icc-types.ts'));
  const blobs=Object.fromEntries(Object.entries(profiles).map(([name,bytes])=>[name,new Blob([new Uint8Array(bytes)])])),rows=[];
  const samples=(name:string,format:string)=>{const bytes=new Uint8Array(windows[name]);return format==='rgba8'?new Uint8ClampedArray(bytes.buffer):format==='rgba16'?new Uint16Array(bytes.buffer):new Float32Array(bytes.buffer);};
  for(const row of cases){
   const input=samples(row.input,row.inputFormat),before=new Uint8Array(input.buffer).slice(),expected=samples(row.output,row.outputFormat),{session,prepared}=await IccSession.prepareProof(blobs[row.source],blobs[row.destination],blobs[row.device],{inputFormat:row.inputFormat,outputFormat:row.outputFormat,intent:iccIntents[row.intent],proofIntent:iccIntents[row.proofIntent],blackPointCompensation:row.blackPointCompensation,gamutWarning:row.gamutWarning,warningColor:row.warningColor});
   try{const actual=await session.applyWindow(input);let colorError=0,alphaError=0;for(let i=0;i<actual.length;i++)if(i%4===3)alphaError=Math.max(alphaError,Math.abs(actual[i]-expected[i]));else colorError=Math.max(colorError,Math.abs(actual[i]-expected[i]));rows.push({device:row.device,input:row.inputFormat,output:row.outputFormat,proofChannels:prepared.proof.channels,colorError,alphaError,length:actual.length,owned:actual.byteOffset===0&&actual.byteLength===actual.buffer.byteLength,inputExact:before.every((v,i)=>v===new Uint8Array(input.buffer)[i])});}finally{session.dispose();}
  }
  return rows;
 },{cases:manifest.cases,profiles,windows});
 expect(result).toHaveLength(manifest.cases.length);for(let i=0;i<result.length;i++){const row=result[i];expect(row.inputExact&&row.owned).toBe(true);expect(row.length).toBe(manifest.cases[i].pixels*4);expect(row.alphaError).toBe(0);expect(row.colorError).toBeLessThanOrEqual(row.output==='rgba-float32'?2e-6:0);expect(row.proofChannels).toBe(row.device==='synthetic-cmyk'?4:3);}
 await writeFile(info.outputPath('actual-icc-proof-workers.json'),JSON.stringify(result,null,2));
});

test('native proof owners share the two-worker ceiling and queued cancellation leaves a usable next owner',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{IccSession}=await import(/* @vite-ignore */String('/src/core/color/icc-client.ts')),{iccTarget}=await import(/* @vite-ignore */String('/src/core/color/profile-source.ts'));
  const Original=window.Worker;let workers=0;window.Worker=class extends Original{constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(String(url).includes('icc.worker'))workers++;}};
  const source=iccTarget('linear-srgb').source,display=iccTarget('srgb').source;let a:InstanceType<typeof IccSession>|undefined,b:InstanceType<typeof IccSession>|undefined;
  try{a=(await IccSession.prepareProof(source,display,iccTarget('display-p3').source)).session;b=(await IccSession.prepareRgb(source,display,{inputFormat:'rgba-float32',outputFormat:'rgba8'})).session;const before=workers,abort=new AbortController(),pending=IccSession.prepareProof(source,display,display,{}, {signal:abort.signal});abort.abort();let error='';try{await pending;}catch(value){error=String(value);}const after=workers;a.dispose();b.dispose();const next=await IccSession.prepareProof(source,display,display);try{return{before,after,error,retry:[...await next.session.applyWindow(new Float32Array([.2,.3,.4,.5]))],workers};}finally{next.session.dispose();}}finally{a?.dispose();b?.dispose();window.Worker=Original;}
 });expect(result.before).toBe(2);expect(result.after).toBe(2);expect(result.workers).toBe(3);expect(result.error).toMatch(/abort/i);expect(result.retry).toHaveLength(4);expect(result.retry[3]).toBe(128);await writeFile(info.outputPath('actual-proof-queue.json'),JSON.stringify(result,null,2));
});
