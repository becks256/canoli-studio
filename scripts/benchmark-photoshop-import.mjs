import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cpus,platform} from 'node:os';
const output=process.env.CANOLI_PHOTOSHOP_IMPORT_OUTPUT,url=process.env.CANOLI_PHOTOSHOP_IMPORT_URL??'http://127.0.0.1:4173/',fixture=process.env.CANOLI_PHOTOSHOP_IMPORT_FIXTURE??'tests/fixtures/psd/native-50mp.psd',reference=process.env.CANOLI_PHOTOSHOP_IMPORT_REFERENCE??'tests/fixtures/psd/native-50mp.png',rounds=Number(process.env.CANOLI_PHOTOSHOP_IMPORT_ROUNDS??1);
if(!output||!Number.isSafeInteger(rounds)||rounds<1)throw new Error('Set a fresh output directory and positive rounds.');
const hash=data=>createHash('sha256').update(data).digest('hex'),save=(name,data)=>writeFile(join(output,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
await mkdir(output,{recursive:true});await save('identity.json',{url,fixture,reference,rounds,fixtureSha256:hash(await readFile(fixture)),referenceSha256:hash(await readFile(reference)),scriptSha256:hash(await readFile(new URL(import.meta.url))),cpu:cpus()[0]?.model,platform:platform(),node:process.version});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
try{
 const runs=[];
 for(let trial=0;trial<rounds;trial++){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(120000);page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.goto(url);if(await page.evaluate(()=>'luma'in window))throw new Error('Use a normal production release.');
   const arm=async phase=>{
    await page.evaluate(async phase=>{
     const tasks=[],observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask'});
     const controlStart=performance.now();await new Promise(resolve=>setTimeout(()=>{const start=performance.now();while(performance.now()-start<75){}resolve();},0));await new Promise(resolve=>setTimeout(resolve,100));const control=tasks.filter(t=>t.start>=controlStart&&t.duration>=50);if(!control.length)throw new Error('Native long-task control failed.');
     const state={phase,start:0,end:0,last:0,gaps:[],tasks,observer,control};window.photoshopImportTiming=state;
     const tick=()=>{if(!state.start||state.end)return;const now=performance.now();state.gaps.push(now-state.last);state.last=now;requestAnimationFrame(tick);};
     const begin=event=>{const match=phase==='inspect'?event.target?.getAttribute?.('data-testid')==='psd-input':['Import Layers','Import Flattened'].includes(event.target.closest?.('button')?.textContent?.trim());if(!match)return;document.removeEventListener(phase==='inspect'?'change':'click',begin,true);state.start=state.last=performance.now();requestAnimationFrame(tick);};document.addEventListener(phase==='inspect'?'change':'click',begin,true);
     const mutation=new MutationObserver(()=>{if(!state.start||state.end)return;const ready=phase==='inspect'?!!document.querySelector('.psd-meta-card'):!document.querySelector('.psd-import-dialog')&&document.querySelectorAll('.layer-row').length>0;if(ready){state.end=performance.now();state.gaps.push(state.end-state.last);}});mutation.observe(document.body,{childList:true,subtree:true});state.restore=()=>{document.removeEventListener(phase==='inspect'?'change':'click',begin,true);observer.disconnect();mutation.disconnect();};
    },phase);
   };
   const finish=async()=>{await page.waitForFunction(()=>window.photoshopImportTiming.end>0);await page.waitForTimeout(100);return page.evaluate(()=>{const s=window.photoshopImportTiming;for(const e of s.observer.takeRecords())s.tasks.push({start:e.startTime,duration:e.duration});s.restore();if(!(s.end>s.start&&s.start>0))throw new Error('Missing matching import DOM state');return{phase:s.phase,start:s.start,end:s.end,milliseconds:s.end-s.start,frames:Math.max(0,s.gaps.length-1),maxFrameGap:Math.max(...s.gaps),gaps:s.gaps,longTasks:s.tasks.filter(t=>t.start<s.end&&t.start+t.duration>s.start),positiveControl:s.control,browser:navigator.userAgent};});};
   await arm('inspect');await page.getByTestId('psd-input').setInputFiles(fixture);await page.locator('.psd-meta-card').waitFor();const inspection=await finish();
   const button=page.getByRole('button',{name:'Import Flattened',exact:true});await button.waitFor();await arm('import');await button.click();const importing=await finish();
   const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const png=join(output,`trial-${trial}.png`);await(await pending).saveAs(png);
   const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size;maximum=0\nfor y in range(0,a.height,64):\n box=(0,y,a.width,min(a.height,y+64));x=np.asarray(a.crop(box));z=np.asarray(b.crop(box));maximum=max(maximum,int(np.abs(x.astype(int)-z.astype(int)).max()))\nassert maximum==0,maximum;print(a.size,maximum)",png,reference],{encoding:'utf8',timeout:120000});if(checked.status!==0)throw new Error(checked.stderr||checked.stdout);if(errors.length)throw new Error(errors.join('\n'));
   const backend=await page.getByLabel('Rendering backend',{exact:true}).innerText();runs.push({inspection,importing,backend,pixels:checked.stdout,pngSha256:hash(await readFile(png))});
  }finally{await page.evaluate(()=>window.photoshopImportTiming?.restore?.()).catch(()=>{});await context.close();}
 }
 await save('report.json',{runs,limits:'Real input-change/click to matching preflight/committed-layer DOM proxies. Full native PNG pixels verified afterward. Not physical presentation, peak memory, sustained editor-wide latency or complete F14 acceptance.'});console.log(JSON.stringify({output,runs:runs.map(r=>({inspection:r.inspection,importing:r.importing}))}));
}finally{await browser.close();}
