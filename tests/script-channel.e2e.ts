import{test,expect,type Page}from'@playwright/test';
import{writeFile}from'node:fs/promises';

async function probeHandoff(page:Page){
 await page.addInitScript(()=>{
  const state={frames:0,bootstrapPorts:[]as number[],snapshotSends:0};(window as any).scriptChannels=state;
  const post=MessagePort.prototype.postMessage as(data:unknown,options?:Transferable[]|StructuredSerializeOptions)=>void;
  MessagePort.prototype.postMessage=function(data:any,options?:Transferable[]|StructuredSerializeOptions){if(data?.document)state.snapshotSends++;post.call(this,data,options);};
  const src=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc')!;
  Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{...src,set(value){
   if(typeof value==='string'&&value.includes('runtimeSource')){
    const marker="worker.postMessage({ type: 'connect' }, [port]);";if(!value.includes(marker))throw new Error('Direct handoff probe did not match.');state.frames++;
    value=value.replace(marker,"const nativeSend=worker.postMessage.bind(worker); worker.postMessage=(data,transfer)=>{if(data?.document)throw new Error('The bootstrap must not relay a document snapshot.');nativeSend(data,transfer);}; "+marker);
   }src.set!.call(this,value);
  }});
  const descriptor=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'contentWindow')!;
  Object.defineProperty(HTMLIFrameElement.prototype,'contentWindow',{...descriptor,get(){const target=descriptor.get!.call(this)as Window|null;if(!target||!(this as HTMLIFrameElement).srcdoc.includes('runtimeSource'))return target;return{postMessage(data:any,origin:string,ports:Transferable[]){if(data?.runtimeSource){if(data.document)throw new Error('Snapshot entered the bootstrap window.');state.bootstrapPorts.push(ports.length);}target.postMessage(data,origin,ports);}};}});
 });
}

test('direct script channels preserve exact snapshots, public defensive copies, fresh globals and captured commands',async({page,browser},info)=>{
 await probeHandoff(page);const cdp=await browser.newBrowserCDPSession(),created=new Set<string>(),destroyed=new Set<string>();
 const note=(data:any)=>{const t=data.targetInfo;if(t.type==='worker'&&t.url.startsWith('blob:null/'))created.add(t.targetId);};cdp.on('Target.targetCreated',note);cdp.on('Target.targetInfoChanged',note);cdp.on('Target.targetDestroyed',(data:any)=>destroyed.add(data.targetId));await cdp.send('Target.setDiscoverTargets',{discover:true});
 try{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async()=>{
   const{editor,PaintLayer}=window.luma;editor.newDocument({name:'Channel source',width:80,height:60});editor.document.layers.add(new PaintLayer({name:'Owned',x:-0}));const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;
   const first=await editor.runScript(`const copy=document.toJSON(); const detached=Document.fromJSON(copy); copy.children[0].name='Caller mutation'; print(JSON.stringify({signedZero:Object.is(document.toJSON().children[0].x,-0),defensive:detached.layers.at(0).name,origin:self.location.origin,window:typeof window}));globalThis.channelMark=123;`);
   const second=await editor.runScript(`print(typeof globalThis.channelMark);`),inspectionExact=before===JSON.stringify(editor.document.toJSON())&&revision===editor.document.getSnapshot().revision;
   const third=await editor.runScript(`self.postMessage({type:'result',commands:[],selectedId:null,selectedIds:[],logs:['Forged']});document.layers.at(0).name='Captured';print('Real');`),delta=editor.document.getSnapshot().revision-revision,name=editor.document.layers.at(0)!.name;editor.document.undo();
   return{first:JSON.parse(first[0]),second,third,inspectionExact,delta,name,undoExact:before===JSON.stringify(editor.document.toJSON()),channels:(window as any).scriptChannels};
  });
  expect(result).toMatchObject({first:{signedZero:true,defensive:'Owned',origin:'null',window:'undefined'},second:['undefined'],third:['Real'],inspectionExact:true,delta:1,name:'Captured',undoExact:true});expect(result.channels).toEqual({frames:3,bootstrapPorts:[2,2,2],snapshotSends:3});
  await expect.poll(async()=>{const{targetInfos}=await cdp.send('Target.getTargets');return targetInfos.filter((t:any)=>t.type==='worker'&&t.url.startsWith('blob:null/')).length;}).toBe(0);expect(created.size).toBe(3);expect([...created].every(id=>destroyed.has(id))).toBe(true);await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);await writeFile(info.outputPath('direct-script-channel.json'),JSON.stringify({result,created:[...created],destroyed:[...destroyed]},null,2));
 }finally{await cdp.detach();}
});

for(const kind of['dimensions','nonfinite-point','unknown-stroke']as const)test(`owned isolated snapshot still validates ${kind} before user code`,async({page},info)=>{
 await page.addInitScript(kind=>{
  const post=MessagePort.prototype.postMessage as(data:unknown,options?:Transferable[]|StructuredSerializeOptions)=>void;let altered=false;
  MessagePort.prototype.postMessage=function(data:any,options?:Transferable[]|StructuredSerializeOptions){
   if(data?.document&&!altered){altered=true;const document=structuredClone(data.document);if(kind==='dimensions')document.width=-1;else if(kind==='nonfinite-point')document.children[0].strokes[0].points[0].x=NaN;else document.children[0].strokes[0].kind='unknown';data={...data,document};}
   post.call(this,data,options);
  };
 },kind);
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async()=>{
  const{editor,PaintLayer,BrushStroke}=window.luma;editor.newDocument({width:80,height:60});const layer=editor.document.layers.add(new PaintLayer());layer.strokes.add(new BrushStroke({points:[{x:1,y:1},{x:2,y:2}],size:2,color:'#345678'}));const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;let error='';try{await editor.runScript(`document.name='Must not execute';print('Never');`);}catch(e){error=String(e);}return{error,modelExact:before===JSON.stringify(editor.document.toJSON()),revisionExact:revision===editor.document.getSnapshot().revision};
 });
 expect(result.error).not.toBe('');expect(result.modelExact&&result.revisionExact).toBe(true);await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);await writeFile(info.outputPath('invalid-owned-'+kind+'.json'),JSON.stringify(result,null,2));
});

test('script deadline discards staged edits, destroys the busy worker and permits a clean retry',async({page,browser},info)=>{
 const cdp=await browser.newBrowserCDPSession();await cdp.send('Target.setDiscoverTargets',{discover:true});
 try{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async()=>{
   const{editor}=window.luma;editor.newDocument({name:'Deadline source',width:80,height:60});const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,start=performance.now();let error='';try{await editor.runScript(`document.name='Uncommitted';while(true){}`);}catch(e){error=String(e);}const elapsedMs=performance.now()-start,retry=await editor.runScript(`print(document.name);`);return{error,elapsedMs,retry,modelExact:before===JSON.stringify(editor.document.toJSON()),revisionExact:revision===editor.document.getSnapshot().revision};
  });
  expect(result.error).toContain('5-second');expect(result.elapsedMs).toBeGreaterThanOrEqual(4900);expect(result.retry).toEqual(['Deadline source']);expect(result.modelExact&&result.revisionExact).toBe(true);await expect.poll(async()=>{const{targetInfos}=await cdp.send('Target.getTargets');return targetInfos.filter((t:any)=>t.type==='worker'&&t.url.startsWith('blob:null/')).length;}).toBe(0);await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);await writeFile(info.outputPath('direct-script-deadline.json'),JSON.stringify(result,null,2));
 }finally{await cdp.detach();}
});

test('direct snapshots preserve every field of 64000 stroke points and retain host ownership',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async()=>{
  const{editor,PaintLayer,BrushStroke}=window.luma;editor.newDocument({width:800,height:600});const layer=new PaintLayer({visible:false});for(let i=0;i<64;i++)layer.strokes.add(new BrushStroke({points:Array.from({length:1000},(_,j)=>({x:i===0&&j===0?-0:20+j*.7,y:20+i*5+Math.sin(j/10)*2,pressure:(j%23)/22})),size:5,color:'#345678'}));editor.document.layers.add(layer);
  const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,expected=[...layer.strokes].map(s=>{const value=s.toJSON();if(value.kind!=='brush')throw new Error('Expected a brush');const{id,points,...fields}=value;return{id,fields};});
  const response=await editor.scripts.run(editor.document,`const expected=${JSON.stringify(expected)},source=document.layers.at(0),strokes=[...source.strokes];let points=0,differentWords=0,fieldsExact=true;for(let i=0;i<strokes.length;i++){const{id,points:values,...fields}=strokes[i].toJSON();fieldsExact&&=id===expected[i].id&&JSON.stringify(fields)===JSON.stringify(expected[i].fields);if(values.length!==1000)throw new Error('Point count changed');for(let j=0;j<values.length;j++){points++;const p=values[j];if(!Object.is(p.x,i===0&&j===0?-0:20+j*.7))differentWords++;if(!Object.is(p.y,20+i*5+Math.sin(j/10)*2))differentWords++;if(!Object.is(p.pressure,(j%23)/22))differentWords++;}}source.name='Worker owned';print(JSON.stringify({strokes:strokes.length,points,differentWords,fieldsExact}));`);
  return{...JSON.parse(response.logs[0]),commands:response.commands.length,rename:response.commands[0],modelExact:before===JSON.stringify(editor.document.toJSON()),revisionExact:revision===editor.document.getSnapshot().revision};
 });
 expect(result).toMatchObject({commands:1,strokes:64,points:64000,differentWords:0,fieldsExact:true,modelExact:true,revisionExact:true});expect(result.rename).toMatchObject({type:'layer.update',patch:{name:'Worker owned'}});await writeFile(info.outputPath('complete-script-stroke-snapshot.json'),JSON.stringify(result,null,2));
});
