import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {PngRowEncoder} from '../src/core/png-stream';
import {historyScript,historyProject,historyPng} from './helpers/history-inspector';

type Target='layer'|'mask'|'filter-mask';
interface FeedbackSample {
 milliseconds:number;pixel:number[];events:number;rgbaSha256:string;width:number;height:number;
}
const cpuProfile=process.env.CANOLI_WET_PROFILE==='1';

async function matchingForeground(page:Page,x:number,y:number,target:Target):Promise<FeedbackSample>{
 return page.evaluate(({x,y,target})=>new Promise<FeedbackSample>((resolve,reject)=>{
  const started=performance.now();
  const probe=()=>{
   const state=(window as any).__wetProductionLatency;
   const source=document.querySelector<HTMLCanvasElement>('[data-testid="artwork"]')!;
   const canvas=new OffscreenCanvas(1,1),context=canvas.getContext('2d')!;
   context.drawImage(source,Math.floor(x*source.width/320),Math.floor(y*source.height/96),1,1,0,0,1,1);
   const pixel=[...context.getImageData(0,0,1,1).data];
   const matches=target==='layer'?pixel[0]===0&&pixel[1]===255&&pixel[2]===0&&pixel[3]>0
    :target==='mask'?pixel[3]===0:pixel[0]===240&&pixel[1]===64&&pixel[2]===32&&pixel[3]===255;
   if(matches&&state.event){
    const matchedAt=performance.now(),full=new OffscreenCanvas(source.width,source.height),copy=full.getContext('2d')!;
    copy.drawImage(source,0,0);
    const data=copy.getImageData(0,0,source.width,source.height).data;
    void crypto.subtle.digest('SHA-256',data).then(hash=>resolve({
     milliseconds:matchedAt-state.event,pixel,events:state.events,width:source.width,height:source.height,
     rgbaSha256:[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join(''),
    }),reject);
   }else if(performance.now()-started>30000)reject(Error('The new endpoint did not reach the foreground canvas'));
   else requestAnimationFrame(probe);
  };
  probe();
 }),{x,y,target});
}

for(const projected of[false,true])for(const target of['layer','mask','filter-mask']as const){
 test(`normal production ${projected?'projected':'affine'} ${target} wet feedback retains every prefix and one Undo`,async({page,context},info)=>{
  const encoder=new PngRowEncoder(300,80),rgba=new Uint8Array(300*80*4);
  for(let i=0;i<rgba.length;i+=4)rgba.set([240,64,32,255],i);
  await encoder.append(rgba,80);
  const original=new Uint8Array(await(await encoder.finish()).arrayBuffer());
  await page.goto('/');
  expect(await page.evaluate(()=>'luma'in window)).toBe(false);
  await page.getByTestId('import-input').setInputFiles({name:'Feedback original.png',mimeType:'image/png',buffer:Buffer.from(original)});
  await historyScript(page,`
   document.resize(320,96);
   let layer=document.selectedLayer;
   ${target==='filter-mask'?'layer=layer.convertToSmartObject();':''}
   layer.x=8;layer.y=8;
   ${projected?'layer.perspective=new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:0},{x:.9,y:1},{x:.05,y:1}]});':''}
   ${target==='mask'?'layer.mask=new LayerMask({base:1});':target==='filter-mask'?'layer.addFilter(new SmartToneFilter({saturation:-100}));layer.filterMask=new LayerMask({base:1});':''}
  `,'Feedback scene ready');
  await page.getByRole('button',{name:'Mixer brush',exact:true}).click();
  await page.keyboard.press('Control+1');
  await page.getByRole('combobox',{name:'Paint target',exact:true}).selectOption(target==='layer'?'layer':target==='mask'?'mask-hide':'filter-mask-hide');
  for(const[label,value]of[['Size value','6'],['Hardness value','100'],['Wetness value','0'],['Pickup value','0']]as const){
   const field=page.getByRole('spinbutton',{name:label,exact:true});
   await field.fill(value);await field.press('Enter');
  }
  await page.getByRole('checkbox',{name:'Pressure controls size',exact:true}).uncheck();
  if(target==='layer')await page.getByLabel('Foreground color',{exact:true}).fill('#00ff00');
  const before=await historyProject(page,info,'before.luma');
  const box=(await page.getByTestId('artwork').boundingBox())!;
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const cdp=cpuProfile?await context.newCDPSession(page):null;
  if(cdp){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  await page.evaluate(()=>{
   const state={event:0,events:0,longTasks:[]as {start:number;duration:number}[],listener:(_event:PointerEvent)=>{},observer:new PerformanceObserver(()=>{})};
   state.listener=e=>{if(e.buttons===1){state.event=e.timeStamp;state.events++;}};
   window.addEventListener('pointerdown',state.listener,true);
   window.addEventListener('pointermove',state.listener,true);
   state.observer=new PerformanceObserver(list=>{for(const item of list.getEntries())state.longTasks.push({start:item.startTime,duration:item.duration});});
   state.observer.observe({type:'longtask'});
   (window as any).__wetProductionLatency=state;
  });
  const rows:(FeedbackSample&{x:number;y:number})[]=[];
  for(let i=0;i<12;i++){
   const x=24+i*20,y=40,at={x:box.x+x*box.width/320,y:box.y+y*box.height/96};
   // New endpoints are more than three brush diameters from prior visible ink.
   const prior=await page.getByTestId('artwork').evaluate((node,{x,y})=>{
    const source=node as HTMLCanvasElement,canvas=new OffscreenCanvas(1,1),context=canvas.getContext('2d')!;
    context.drawImage(source,Math.floor(x*source.width/320),Math.floor(y*source.height/96),1,1,0,0,1,1);
    return[...context.getImageData(0,0,1,1).data];
   },{x,y});
   if(target==='layer')expect(prior.slice(0,3)).not.toEqual([0,255,0]);
   else if(target==='mask')expect(prior[3]).toBe(255);
   else expect(prior.slice(0,3)).not.toEqual([240,64,32]);
   await page.mouse.move(at.x,at.y);if(i===0)await page.mouse.down();
   rows.push({...await matchingForeground(page,x,y,target),x,y});
  }
  await page.mouse.up();
  await expect(page.getByRole('button',{name:'Save project',exact:true})).toBeEnabled();
  if(cdp)await writeFile(info.outputPath('cpu-profile.json'),JSON.stringify(await cdp.send('Profiler.stop')));
  const observed=await page.evaluate(()=>{
   const state=(window as any).__wetProductionLatency;
   state.longTasks.push(...state.observer.takeRecords().map((v:PerformanceEntry)=>({start:v.startTime,duration:v.duration})));
   state.observer.disconnect();window.removeEventListener('pointerdown',state.listener,true);window.removeEventListener('pointermove',state.listener,true);
   return{longTasks:state.longTasks,events:state.events};
  });
  const saved=await historyProject(page,info,'final.luma'),layer=saved.value.document.children[0];
  const operation=target==='layer'&&layer.kind==='raster'?layer.erasures?.at(-1)?.stroke
   :target==='mask'?layer.mask?.strokes?.at(-1)?.stroke
   :layer.kind==='smart-object'?layer.filterMask?.strokes?.at(-1)?.stroke:undefined;
  expect(operation?.kind).toBe('wet');
  if(operation?.kind!=='wet')throw Error('Missing prepared wet result');
  expect(operation.brush.points).toHaveLength(12);
  expect(!!operation.placement).toBe(projected);
  const definition=layer.kind==='smart-object'?saved.value.document.components?.find(v=>v.id===layer.componentId):null;
  const sourceId=layer.kind==='raster'?layer.assetId:definition?.source.kind==='asset'?definition.source.assetId:null;
  const source=saved.value.entries.find(v=>v.id===sourceId);
  expect(source).toBeTruthy();expect(new Uint8Array(await source!.blob.arrayBuffer())).toEqual(original);
  const png=await historyPng(page,info,'final.png');
  await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();
  expect((await historyProject(page,info,'undo.luma')).value.document).toEqual(before.value.document);
  await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();
  expect((await historyProject(page,info,'redo.luma')).value.document).toEqual(saved.value.document);
  expect((await historyPng(page,info,'redo.png')).bytes).toEqual(png.bytes);
  const sorted=rows.map(v=>v.milliseconds).sort((a,b)=>a-b);
  await writeFile(info.outputPath('production-latency.json'),JSON.stringify({
   projected,target,rows,median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.ceil(sorted.length*.95)-1],maximum:sorted.at(-1),...observed,
   cpuProfile,sourceExact:true,oneUndo:true,redoExact:true,
   method:'Normal production without developer globals; actual pointer timestamps to new matching foreground canvas pixels on animation frames. Includes pixel readback; complete prefix hashes are captured after timing. CPU sampling is optional and explicitly recorded.',
  },null,2));
 });
}
