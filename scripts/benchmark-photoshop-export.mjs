import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {cpus,platform,arch} from 'node:os';
import {spawnSync} from 'node:child_process';

const output=process.env.CANOLI_PHOTOSHOP_OUTPUT;
if(!output)throw new Error('Set a fresh CANOLI_PHOTOSHOP_OUTPUT directory.');
const url=process.env.CANOLI_PHOTOSHOP_URL??'http://127.0.0.1:4173/';
const format=process.env.CANOLI_PHOTOSHOP_FORMAT??'psb';
if(!['psd','psb'].includes(format))throw new Error('Choose psd or psb.');
const profiled=process.env.CANOLI_PHOTOSHOP_PROFILE==='1';
const rounds=Number(process.env.CANOLI_PHOTOSHOP_ROUNDS??3);
if(!Number.isSafeInteger(rounds)||rounds<1)throw new Error('Invalid rounds.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
await mkdir(output,{recursive:true});
await save('identity.json',{url,format,profiled,rounds,scriptSha256:sha(await readFile(new URL(import.meta.url))),platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(url);if(await page.evaluate(()=>'luma'in window))throw new Error('Use a normal production release.');
  let fixture=process.env.CANOLI_PHOTOSHOP_FIXTURE;
  const download=async(action,name)=>{const pending=page.waitForEvent('download');await action();const path=join(output,name);await(await pending).saveAs(path);return path;};
  if(fixture)await page.getByTestId('project-input').setInputFiles(fixture);
  else{
   await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
   await page.getByLabel('Script code',{exact:true}).fill(`document.resize(4096,4096);const paint=document.layers.add(new PaintLayer({name:'Export paint'}));paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:4096,height:4096},color:'#804020',opacity:.5}));document.layers.add(new TextLayer({name:'Export caption',text:'Native TIFF output',fontFamily:'monospace',fontSize:64,x:2000,y:60}));print('Export fixture ready');`);
   await page.getByRole('button',{name:'Run script',exact:true}).click();await page.getByLabel('Script output').filter({hasText:'Export fixture ready'}).waitFor();await page.getByRole('button',{name:'Close scripts',exact:true}).click();
   fixture=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'fixture.luma');
  }
  await page.locator('.layer-row').nth(1).waitFor();await page.evaluate(()=>document.fonts.ready);
  const reference=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reference.png');
  const fixtureSha256=sha(await readFile(fixture)),referenceSha256=sha(await readFile(reference)),entries=await page.evaluate(()=>[...document.scripts].map(s=>s.src).filter(Boolean)),entryHashes={};
  for(const entry of entries)entryHashes[entry]=sha(await(await page.request.get(entry)).body());
  const backend=await page.getByLabel('Rendering backend',{exact:true}).innerText();
  const session=await context.newCDPSession(page);if(profiled){await session.send('Profiler.enable');await session.send('Debugger.enable');}
  const samples=[],cases=[];
  for(let trial=0;trial<rounds;trial++){
   await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption(format);
   await page.evaluate(format=>{
    const tasks=[],observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask'});
    const s={start:0,end:0,last:0,gaps:[],tasks,observer,controlStart:performance.now()};window.photoshopTiming=s;
    const tick=()=>{if(!s.start||s.end)return;const now=performance.now();s.gaps.push(now-s.last);s.last=now;requestAnimationFrame(tick);};
    const click=e=>{if(e.target.closest?.('button')?.textContent?.trim()!=='Export .'+format)return;document.removeEventListener('click',click,true);s.start=s.last=performance.now();requestAnimationFrame(tick);};document.addEventListener('click',click,true);
    const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('.'+format)&&this.href.startsWith('blob:'))s.end=performance.now();return original.call(this);};
    s.restore=()=>{HTMLAnchorElement.prototype.click=original;document.removeEventListener('click',click,true);observer.disconnect();};
   },format);
   await page.evaluate(async()=>{await new Promise(resolve=>setTimeout(()=>{const t=performance.now();while(performance.now()-t<75){}resolve();},0));await new Promise(resolve=>setTimeout(resolve,100));const s=window.photoshopTiming;s.control=s.tasks.filter(e=>e.start>=s.controlStart&&e.duration>=50);if(!s.control.length)throw new Error('Native long-task positive control failed.');});
   if(profiled)await session.send('Profiler.start');
   const path=await download(()=>dialog.getByRole('button',{name:'Export .'+format,exact:true}).click(),`trial-${trial}.${format}`);
   if(profiled){const {profile}=await session.send('Profiler.stop');await save(`profile-${trial}.json`,profile);
    const counts=new Map();for(let i=0;i<(profile.samples??[]).length;i++){const id=profile.samples[i];counts.set(id,(counts.get(id)??0)+(profile.timeDeltas?.[i]??0));}
    const top=profile.nodes.map(n=>({frame:n.callFrame,selfMs:(counts.get(n.id)??0)/1000})).sort((a,b)=>b.selfMs-a.selfMs).slice(0,25);
    const sources=new Map();for(const item of top){const frame=item.frame;if(!frame.url||!frame.scriptId)continue;try{let code=sources.get(frame.scriptId);if(!code){code=(await session.send('Debugger.getScriptSource',{scriptId:frame.scriptId})).scriptSource;sources.set(frame.scriptId,code);}const lines=code.split('\n'),line=lines[frame.lineNumber]??'';item.source=line.slice(Math.max(0,frame.columnNumber-120),frame.columnNumber+500);}catch{}}
    await save(`profile-top-${trial}.json`,top);
   }
   await page.waitForTimeout(100);
   const result=await page.evaluate(()=>{const s=window.photoshopTiming;for(const e of s.observer.takeRecords())s.tasks.push({start:e.startTime,duration:e.duration});s.restore();return{start:s.start,end:s.end,milliseconds:s.end-s.start,gaps:s.gaps,frames:s.gaps.length,maxFrameGap:Math.max(0,...s.gaps),longTasks:s.tasks.filter(e=>e.start<s.end&&e.start+e.duration>s.start),positiveControl:s.control,browser:navigator.userAgent};});
   if(!(result.end>result.start&&result.start>0&&result.frames>0))throw new Error('Missing real export timing/frame observation.');samples.push(result);cases.push({path,reference,format,names:['Export paint','Export caption'],visibility:[true,true]});
  }
  await session.detach();if(errors.length)throw new Error(errors.join('\n'));
  await save('cases.json',cases);
  const checked=spawnSync(process.env.CANOLI_PSB_PYTHON??'python3',['scripts/check-photoshop-export.py',join(output,'cases.json')],{encoding:'utf8',timeout:120000});if(checked.status!==0)throw new Error(checked.stderr||checked.stdout);
  await save('report.json',{fixture,fixtureSha256,referenceSha256,backend,entries:entryHashes,profiled,samples,independent:JSON.parse(checked.stdout),limits:'Local native click-to-download and animation scheduling, not physical display, sustained editor-wide latency or peak memory. Profiled runs add overhead and are diagnostic only.'});
  console.log(JSON.stringify({output,profiled,samples:samples.map(({milliseconds,maxFrameGap,longTasks})=>({milliseconds,maxFrameGap,longTasks}))}));
 }finally{await page.evaluate(()=>window.photoshopTiming?.restore?.()).catch(()=>{});await context.close();}
}finally{await browser.close();}
