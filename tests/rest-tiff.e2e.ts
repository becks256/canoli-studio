import {test,expect,type Page,type TestInfo} from '@playwright/test';
import type {LayerData} from '../src/core/model';
import {readProject} from '../src/core/project';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
import {withTiffOrientation} from './helpers/tiff-orientation';
import {historyProject} from './helpers/history-inspector';

const auth={authorization:'Bearer rest-native-browser'},json=(value:unknown)=>({method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(value)}),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function api(work:(base:string,tone:LayerData)=>Promise<void>){
  const cache=await mkdtemp(join(tmpdir(),'canoli-rest-native-')),child=spawn(process.execPath,['--import','tsx','tests/helpers/rest-tiff-server.mts'],{cwd:process.cwd(),env:{...process.env,CANOLI_TEST_TIFF_CACHE:cache},stdio:['ignore','pipe','pipe','ipc']});let stderr='';child.stderr!.on('data',chunk=>{stderr+=String(chunk);});child.stdout!.resume();
  const stopped=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  try{
    const ready=await new Promise<{port:number;tone:LayerData}>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>reject(new Error(`Native API test process closed (${code}): ${stderr}`)));child.once('message',value=>{const data=value as {port:number;tone:LayerData};if(!Number.isInteger(data?.port)||data.port<=0||data.port>65535||data.tone?.kind!=='adjustment')reject(new Error('Invalid native API test startup.'));else resolve(data);});});
    await work(`http://127.0.0.1:${ready.port}/api/v1`,ready.tone);
  }finally{if(child.exitCode===null&&child.signalCode===null){const deadline=setTimeout(()=>child.kill('SIGKILL'),5000);try{child.kill('SIGTERM');await stopped;}finally{clearTimeout(deadline);}}await rm(cache,{recursive:true,force:true});}
}
async function importTiff(base:string,bytes:Uint8Array,name:string,width:number,height:number){
  const created=await fetch(base+'/documents',json({name,width,height}));expect(created.status).toBe(201);const before=await created.json(),id=before.document.id;
  const response=await fetch(`${base}/documents/${id}/tiff-import?expectedRevision=0&name=${encodeURIComponent(name)}`,{method:'POST',headers:{...auth,'content-type':'image/tiff','x-tiff-options':JSON.stringify({editingPrecision:'float32'})},body:new Blob([new Uint8Array(bytes)])});expect(response.status,await response.clone().text()).toBe(201);return{before,...await response.json()};
}
async function openProject(page:Page,info:TestInfo,base:string,id:string,name:string){
  const response=await fetch(`${base}/documents/${id}/project?history=true`,{headers:auth});expect(response.status,response.status===200?undefined:await response.clone().text()).toBe(200);const bytes=new Uint8Array(await response.arrayBuffer()),path=info.outputPath(name);await writeFile(path,bytes);await page.goto('/');await page.getByTestId('project-input').setInputFiles(path);await expect(page.getByRole('button',{name:'Save project',exact:true})).toBeEnabled({timeout:300000});return{path,project:await readProject(new Blob([bytes]))};
}
async function exportFloat(page:Page,info:TestInfo,name:string){
  await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('tiff');await dialog.getByLabel('TIFF precision',{exact:true}).selectOption('float32');await dialog.getByLabel('Use output RGB profile for high-precision TIFF',{exact:true}).uncheck();const pending=page.waitForEvent('download',{timeout:600000});await dialog.getByRole('button',{name:'Export .tif',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);await expect(dialog).toHaveCount(0);return path;
}

test('native REST TIFF projects preserve all eight orientations, original bytes, browser pixels and independent Undo',async({page},info)=>{
  test.setTimeout(300000);const original=new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-raw.tif')),records:unknown[]=[];
  await api(async base=>{
    for(let orientation=1;orientation<=8;orientation++){
      const bytes=withTiffOrientation(original,orientation),width=orientation<5?131:79,height=orientation<5?79:131,name=`REST orientation ${orientation}`,result=await importTiff(base,bytes,name,width,height),id=result.document.id;
      const native=await openProject(page,info,base,id,`orientation-${orientation}.luma`);await expect(page.getByRole('button',{name:`Select ${name}`,exact:true})).toBeVisible({timeout:60000});expect(native.project.document).toEqual(result.document);expect(new Uint8Array(await native.project.entries[0].blob.arrayBuffer())).toEqual(bytes);
      const reopened=await historyProject(page,info,`orientation-${orientation}-reopened.luma`);expect(reopened.value.document).toEqual(result.document);expect(new Uint8Array(await reopened.value.entries[0].blob.arrayBuffer())).toEqual(bytes);
      const output=await exportFloat(page,info,`orientation-${orientation}.tif`),checked=spawnSync(process.env.CANOLI_PDF_PYTHON??'python3',['scripts/check-tiff-orientation.py',output,'--orientation',String(orientation)],{encoding:'utf8',timeout:60000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);records.push(JSON.parse(checked.stdout));
      await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyProject(page,info,`orientation-${orientation}-undo.luma`)).value.document).toEqual(result.before.document);
      expect((await(await fetch(`${base}/documents/${id}`,{headers:auth})).json()).document).toEqual(result.document);
    }
  });await writeFile(info.outputPath('rest-tiff-orientations.json'),JSON.stringify(records,null,2));
});

test('genuine 50 MP REST float originals retain every independent sample and produce native browser files after shared edits',async({page},info)=>{
  test.setTimeout(900000);const bytes=new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-native-50mp.tif')),manifest=JSON.parse(await readFile('tests/fixtures/uint16-float/manifest.json','utf8')),reference=manifest.cases.find((row:{file:string})=>row.file==='u16-native-50mp.tif');
  await api(async(base,tone)=>{
    const result=await importTiff(base,bytes,'REST native original',10000,5000),id=result.document.id,hash=createHash('sha256');let samples=0;
    for(let y=0;y<5000;y+=16){const height=Math.min(16,5000-y),response=await fetch(`${base}/documents/${id}/assets/${result.assetId}/float-window?expectedRevision=1&x=0&y=${y}&width=10000&height=${height}`,{headers:auth});expect(response.status,response.status===200?undefined:await response.clone().text()).toBe(200);expect(response.headers.get('x-canoli-pixel-format')).toBe('rgba-float32-le');const data=new Uint8Array(await response.arrayBuffer());expect(data.length).toBe(10000*height*16);hash.update(data);samples+=data.length/4;}
    const actual=hash.digest('hex');expect(samples).toBe(200000000);expect(actual).toBe(reference.floatSha256);
    const edit=await fetch(`${base}/documents/${id}/commands`,json({expectedRevision:1,commands:[{type:'layer.add',layer:tone}]}));expect(edit.status).toBe(200);const edited=await edit.json();
    const native=await openProject(page,info,base,id,'rest-50mp.luma');await expect(page.getByRole('button',{name:'Select REST linear exposure',exact:true})).toBeVisible({timeout:300000});expect(native.project.document).toEqual(edited.document);expect(new Uint8Array(await native.project.entries[0].blob.arrayBuffer())).toEqual(bytes);
    const output=await exportFloat(page,info,'rest-50mp-native.tif'),checked=spawnSync(process.env.CANOLI_PDF_PYTHON??'python3',['scripts/check-float-document.py',output,'--source-name','u16-native-50mp.tif','--native-lcms','/tmp/canoli-color-lcms2.19.1-native.so','--precision','float32','--profile','linear-srgb','--require-visible'],{encoding:'utf8',timeout:300000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
    const reopened=await historyProject(page,info,'rest-50mp-reopened.luma');expect(reopened.value.document).toEqual(edited.document);expect(sha(new Uint8Array(await reopened.value.entries[0].blob.arrayBuffer()))).toBe(sha(bytes));
    await writeFile(info.outputPath('rest-tiff-50mp.json'),JSON.stringify({samples,actualSampleSha256:actual,referenceSampleSha256:reference.floatSha256,originalBytes:bytes.length,originalSha256:sha(bytes),originalExact:true,document:edited.document,independent:JSON.parse(checked.stdout)},null,2));
  });
});


test('REST TIFF guide links from the API reference and stays readable at 390 px without JavaScript',async({browser,baseURL},info)=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  try{
    const page=await context.newPage();await page.goto(`${baseURL}/developer/api.html`);await page.getByRole('link',{name:'Options, response headers, defaults, cancellation, cache repair and limits',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Verified high-precision TIFF sources in the local REST API',exact:true})).toBeVisible();expect(new URL(page.url()).pathname).toBe('/developer/rest-tiff.html');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await expect(page.getByText('This source service does not render a headless layer composition or synchronize a browser document.',{exact:false})).toBeVisible();await page.screenshot({path:info.outputPath('rest-tiff-guide-390.png'),fullPage:true});
  }finally{await context.close();}
});
