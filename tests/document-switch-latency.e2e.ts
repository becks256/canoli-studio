import {test,expect} from '@playwright/test';

test('switching documents with accumulated paint records presentation latency',async({page},info)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(()=>{
    const {editor:e,PaintLayer,PaintFill,BrushStroke}=window.luma;
    const fixtures=[];
    for(const name of ['Switch A','Switch B']){
      e.newDocument({name,width:698,height:396});
      e.document.transaction('Fixture',()=>{
        for(let i=0;i<5;i++){
          const layer=e.document.layers.add(new PaintLayer({name:`Layer ${i}`}));
          layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:698,height:396},color:name==='Switch A'?'#c03020':'#2040c0'}));
          if(i===4)for(let j=0;j<40;j++)layer.strokes.add(new BrushStroke({points:Array.from({length:20},(_,k)=>({x:80+k*12,y:70+j*5,pressure:1})),size:24,hardness:.5,color:'#dddddd'}));
        }
      });
      fixtures.push({name,id:e.document.id,history:e.document.getSnapshot().past.length});
    }
    (window as any).switchFixtures=fixtures;
  });
  await page.waitForTimeout(300);
  await page.evaluate(()=>{
    const e=window.luma.editor,state={target:'',start:0,samples:[] as {id:string;ms:number;pixel:number[]}[],longTasks:[] as number[]};(window as any).switchTiming=state;
    window.addEventListener('click',event=>{if((event.target as Element).closest('[role="tab"]'))state.start=performance.now();},true);
    new PerformanceObserver(list=>list.getEntries().forEach(entry=>state.longTasks.push(entry.duration))).observe({entryTypes:['longtask']});
    const prepare=e.renderer.prepareViewport.bind(e.renderer);
    e.renderer.prepareViewport=async(...args)=>{
      const id=args[0].id,frame=await prepare(...args),present=frame.present.bind(frame);
      frame.present=canvas=>{present(canvas);if(state.start&&id===state.target){const ms=performance.now()-state.start;state.samples.push({id,ms,pixel:[...canvas.getContext('2d')!.getImageData(2,2,1,1).data]});state.start=0;}};
      return frame;
    };
  });
  const profiler=process.env.LUMA_PROFILE ? await page.context().newCDPSession(page) : null;
  if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
  for(let i=0;i<20;i++){
    await page.evaluate(index=>{(window as any).switchTiming.target=(window as any).switchFixtures[index].id;},i%2);
    await page.getByRole('tab',{name:new RegExp(i%2?'Switch B':'Switch A')}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).switchTiming.samples.length)).toBe(i+1);
    if(i===0 && profiler){
      const {profile}=await profiler.send('Profiler.stop');
      await info.attach('cold-switch-profile',{body:JSON.stringify(profile),contentType:'application/json'});
      const times=new Map<number,number>();
      profile.samples?.forEach((id:number,index:number)=>times.set(id,(times.get(id)??0)+(profile.timeDeltas?.[index]??0)/1000));
      console.log('cold-switch-profile',JSON.stringify(profile.nodes.map(n=>({...n.callFrame,ms:times.get(n.id)??0})).sort((a,b)=>b.ms-a.ms).slice(0,30)));
      await profiler.detach();
    }
  }
  const result=await page.evaluate(()=>({...(window as any).switchTiming,fixtures:(window as any).switchFixtures,histories:window.luma.editor.openDocuments.map(d=>({id:d.id,history:d.getSnapshot().past.length}))}));
  for(let i=0;i<20;i++){expect(result.samples[i].id).toBe(result.fixtures[i%2].id);expect(result.samples[i].pixel).toEqual(i%2?[32,64,192,255]:[192,48,32,255]);}
  for(const fixture of result.fixtures)expect(result.histories.find((d:{id:string})=>d.id===fixture.id)?.history).toBe(fixture.history);
  console.log('document-switch-latency',JSON.stringify(result));
  await info.attach('document-switch-latency',{body:JSON.stringify(result),contentType:'application/json'});
});
