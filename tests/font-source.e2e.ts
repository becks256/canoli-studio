import {expect,test} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {fontSourceWorkflow} from './helpers/font-sources';

test('font files inspect and preview in a private font set without changing document pixels or history',async({page},info)=>{await fontSourceWorkflow(page,info);});

test('trusted font preparation retains exact originals, validates native faces and leaves global fonts unregistered',async({page},info)=>{
  const bytes=(await readFile('tests/fixtures/fonts/Collection.ttc')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async encoded=>{
    await document.fonts.ready;
    const{editor}=window.luma,original=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))],{type:'application/octet-stream'});
    const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,faces=[...document.fonts];
    const report=await editor.inspectFont(original,{offset:1,limit:1}),prepared=await editor.prepareFontSource(original,{faceIndex:1});
    const native=await prepared.renderBlob.arrayBuffer(),snapshot={report,faceIndex:prepared.faceIndex,originalSame:prepared.original===original,loaded:prepared.fontFaces.map(face=>face.status),notRegistered:prepared.fontFaces.every(face=>!document.fonts.has(face)),parentFacesSame:[...document.fonts].every((face,i)=>face===faces[i])&&document.fonts.size===faces.length,readOnly:before===JSON.stringify(editor.document.toJSON())&&revision===editor.document.getSnapshot().revision,frozen:Object.isFrozen(prepared)&&Object.isFrozen(prepared.report.faces)&&Object.isFrozen(prepared.report.faces[0].descriptors),nativeBytes:native.byteLength,nativeSha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',native))].map(v=>v.toString(16).padStart(2,'0')).join('')};
    return {...snapshot,nativeBase64:btoa(String.fromCharCode(...new Uint8Array(native)))};
  },bytes);
  expect(result).toMatchObject({faceIndex:1,originalSame:true,loaded:['loaded'],notRegistered:true,parentFacesSame:true,readOnly:true,frozen:true});expect(result.report).toMatchObject({format:'ttc',faceCount:2,offset:1});expect(result.report.faces[0].fullName).toBe('Canoli Source Bold');
  await writeFile(info.outputPath('extracted-bold.ttf'),Buffer.from(result.nativeBase64,'base64'));
  const {nativeBase64,...metadata}=result;void nativeBase64;await info.attach('native-font-source',{body:JSON.stringify(metadata),contentType:'application/json'});
});

test('native preparation loads all containers and variable ranges, with explicit collection selection and recoverable invalid fonts',async({page},info)=>{
  const sources=await Promise.all(['Regular.ttf','CFF.otf','Regular.woff','Regular.woff2','Collection.dfont'].map(async name=>({name,data:(await readFile(`tests/fixtures/fonts/${name}`)).toString('base64')})));
  sources.push({name:'Manrope.woff2',data:(await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2')).toString('base64')});
  await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async inputs=>{
    const editor=window.luma.editor,rows=[];
    for(const input of inputs){const original=new Blob([Uint8Array.from(atob(input.data),v=>v.charCodeAt(0))]);const prepared=await editor.prepareFontSource(original,input.name.endsWith('.dfont')?{faceIndex:1}:{});rows.push({name:input.name,format:prepared.report.format,loaded:prepared.fontFaces.every(f=>f.status==='loaded'),unregistered:prepared.fontFaces.every(f=>!document.fonts.has(f)),axes:prepared.report.faces[0].axes,descriptors:prepared.report.faces[0].descriptors});}
    const invalid=Uint8Array.from(atob(inputs[0].data),v=>v.charCodeAt(0)),view=new DataView(invalid.buffer);
    for(let i=0;i<view.getUint16(4);i++){const at=12+i*16;if(view.getUint32(at)===0x676c7966)view.setUint32(at,0x5a5a5a5a);}
    const errors=[];for(const [blob,options]of [[new Blob([invalid]),{}],[new Blob([Uint8Array.from(atob(inputs[4].data),v=>v.charCodeAt(0))]),{}]]as const){try{await editor.prepareFontSource(blob,options);errors.push('unexpected success');}catch(error){errors.push(String(error));}}
    return{rows,errors,recovered:(await editor.inspectFont(new Blob([Uint8Array.from(atob(inputs[0].data),v=>v.charCodeAt(0))]))).format};
  },sources);
  expect(result.rows.every(row=>row.loaded&&row.unregistered)).toBe(true);expect(result.rows.map(row=>row.format)).toEqual(['ttf','otf','woff','woff2','dfont','woff2']);expect(result.rows[5].descriptors[0].weight).toBe('200 800');expect(result.errors[0]).toContain('could not validate');expect(result.errors[1]).toContain('explicit face index');expect(result.recovered).toBe('ttf');await info.attach('native-font-containers',{body:JSON.stringify(result),contentType:'application/json'});
});

test('font host rejects response corruption, worker timeout and throwing observers, then recovers',async({page})=>{
  const bytes=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async encoded=>{
    const editor=window.luma.editor,blob=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),report=await editor.inspectFont(blob),Native=window.Worker,errors=[];let ended=0;
    try{
      for(const mode of ['corrupt','timeout']){
        window.Worker=class{onmessage:((event:MessageEvent)=>void)|null=null;onerror=null;onmessageerror=null;postMessage(){if(mode==='corrupt')queueMicrotask(()=>this.onmessage?.({data:{report:{...report,sha256:'0'.repeat(64)}}}as MessageEvent));}terminate(){ended++;}}as unknown as typeof Worker;
        try{await editor.inspectFont(blob,{},mode==='timeout'?{timeoutMs:25}:{});errors.push('unexpected success');}catch(error){errors.push(String(error));}
      }
    }finally{window.Worker=Native;}
    try{await editor.inspectFont(blob,{}, {onProgress(){throw new Error('Font observer rejected.');}});}catch(error){errors.push(String(error));}
    return{ended,errors,recovered:(await editor.inspectFont(blob)).format};
  },bytes);
  expect(result.ended).toBe(2);expect(result.errors[0]).toContain('fingerprint');expect(result.errors[1]).toContain('time budget');expect(result.errors[2]).toContain('Font observer rejected');expect(result.recovered).toBe('ttf');
});

test('closing the font inspector cancels blocked parsing and a later source can be inspected',async({page})=>{
  let blocked=0,hold=false,release=()=>{};await page.route('**/src/generated/font-source-worker.js*',async route=>{blocked++;if(hold)await new Promise<void>(resolve=>{release=resolve;});await route.abort('aborted').catch(()=>{});});
  await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const {openFontManager}=await import('./helpers/font-management');const dialog=await openFontManager(page);await dialog.locator('summary').filter({hasText:'Inspect font files'}).click();await dialog.getByTestId('font-source-input').setInputFiles('tests/fixtures/fonts/Regular.ttf');
  await expect(dialog.getByRole('alert')).toContainText('Font parser worker failed');expect(blocked).toBe(1);
  hold=true;await dialog.getByRole('button',{name:'Inspect again',exact:true}).click();await expect.poll(()=>blocked).toBe(2);
  await dialog.locator('summary').filter({hasText:'Inspect font files'}).click();await expect(dialog.getByTestId('font-source-input')).toHaveCount(0);release();await page.unroute('**/src/generated/font-source-worker.js*');
  await dialog.locator('summary').filter({hasText:'Inspect font files'}).click();await dialog.getByTestId('font-source-input').setInputFiles('tests/fixtures/fonts/Regular.woff2');await expect(dialog.getByText('WOFF2 · 1 face · Showing 1–1',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Done',exact:true}).click();
});

test('late native font completion cannot publish after cancellation or editor disposal',async({page})=>{
  const bytes=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async encoded=>{
    const editor=window.luma.editor,blob=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),Native=window.FontFace,abort=new AbortController();let nativeFinished=false;
    window.FontFace=class extends Native{override async load(){abort.abort(new Error('Native font cancelled.'));await new Promise(resolve=>setTimeout(resolve,30));const face=await super.load();nativeFinished=true;return face;}};
    const errors=[];try{await editor.prepareFontSource(blob,{}, {signal:abort.signal});}catch(error){errors.push(String(error));}finally{window.FontFace=Native;}
    const recovered=(await editor.inspectFont(blob)).format;
    const Disposable=editor.constructor as new()=>typeof editor,disposable=new Disposable();
    const disposed=disposable.inspectFont(blob,{}, {onProgress:()=>disposable.dispose()});try{await disposed;}catch(error){errors.push(String(error));}
    try{await disposable.inspectFont(blob);}catch(error){errors.push(String(error));}
    await new Promise(resolve=>setTimeout(resolve,60));return{nativeFinished,recovered,errors,registered:[...document.fonts].filter(face=>face.family.startsWith('CanoliFont_')).length};
  },bytes);
  expect(result).toMatchObject({nativeFinished:true,recovered:'ttf',registered:0});expect(result.errors[0]).toContain('Native font cancelled');expect(result.errors[1]).toContain('disposed');expect(result.errors[2]).toContain('disposed');
});

test('font jobs serialize parser workers, cancel queued and running work, then recover',async({page},info)=>{
  const bytes=(await readFile('tests/fixtures/fonts/Regular.woff2')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async encoded=>{
    const{editor}=window.luma,blob=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),Native=window.Worker;
    let active=0,max=0,created=0,terminated=0;
    window.Worker=class extends Native{private ended=false;constructor(url:string|URL,options?:WorkerOptions){super(url,options);active++;created++;max=Math.max(max,active);}override terminate(){if(!this.ended){this.ended=true;active--;terminated++;}super.terminate();}};
    const firstAbort=new AbortController(),queuedAbort=new AbortController();
    try{
      const first=editor.inspectFont(blob,{}, {signal:firstAbort.signal,onProgress:()=>firstAbort.abort(new Error('Running font cancelled.'))});
      const second=editor.inspectFont(blob,{}, {signal:queuedAbort.signal});queuedAbort.abort(new Error('Queued font cancelled.'));
      const third=editor.inspectFont(blob),results=await Promise.allSettled([first,second,third]);
      return {statuses:results.map(value=>value.status),errors:results.map(value=>value.status==='rejected'?String(value.reason):null),last:results[2].status==='fulfilled'?results[2].value.format:null,active,max,created,terminated};
    }finally{window.Worker=Native;}
  },bytes);
  expect(result).toMatchObject({statuses:['rejected','rejected','fulfilled'],last:'woff2',active:0,max:1,created:2,terminated:2});expect(result.errors[0]).toContain('Running font cancelled');expect(result.errors[1]).toContain('Queued font cancelled');
  await info.attach('font-worker-lifecycle',{body:JSON.stringify(result),contentType:'application/json'});
});
