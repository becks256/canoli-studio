import {test,expect} from '@playwright/test';

for (const [paths,anchors] of [[1,20000],[64,1000]]) test(`first restored path access with ${paths} paths and ${anchors} anchors`,async({page},info)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(({paths,anchors})=>{
    const {Document,VectorLayer,VectorPath}=window.luma;
    const document=new Document();document.layers.add(new VectorLayer());
    const data=document.toJSON(),layer=data.children[0];
    if(layer.kind!=='vector')throw Error('Expected vector');
    const template=new VectorPath({points:[{x:0,y:0}]}).toJSON();
    layer.paths=Array.from({length:paths},(_,i)=>({...template,id:`restored-path-${i}`,points:Array.from({length:anchors},(_,j)=>({x:j,y:i,in:{x:j,y:i},out:{x:j,y:i}}))}));
    const restored=Document.fromJSON(data);
    (window as any).restoredPathLayer=restored.layers.at(0);
  },{paths,anchors});
  const result=await page.evaluate(async()=>{
    const layer=(window as any).restoredPathLayer;
    const tasks:number[]=[],gaps:number[]=[];
    const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())tasks.push(e.duration);});observer.observe({type:'longtask'});
    let frame=0,last=performance.now();const tick=()=>{const now=performance.now();gaps.push(now-last);last=now;frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
    await new Promise(resolve=>setTimeout(resolve,100));tasks.length=0;gaps.length=0;
    const start=performance.now();const handles=Array.from({length:layer.paths.length},(_,i)=>layer.paths.at(i));const accessMs=performance.now()-start;
    await new Promise(resolve=>setTimeout(resolve,100));cancelAnimationFrame(frame);observer.disconnect();
    const first=handles[0],copy=first.points,original=copy[0].x;copy[0].x=99999;
    return {accessMs,maxFrameGapMs:Math.max(...gaps),longTasks:tasks,count:handles.length,identity:layer.paths.at(0)===first,owned: first.points[0].x===original};
  });
  expect(result.count).toBe(paths);expect(result.identity).toBe(true);expect(result.owned).toBe(true);
  console.log('path-handle-latency',JSON.stringify({paths,anchors,...result}));await info.attach('path-handle-latency',{body:JSON.stringify(result),contentType:'application/json'});
});
