import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{spawnSync}from'node:child_process';

test('50 MP native shadow windows retain independent samples while exposing cold and retained work',async({page},info)=>{
 test.setTimeout(600000);await page.goto('/');const bytes=await readFile('tests/fixtures/uint16-float/u16-native-50mp.tif');
 const result=await page.evaluate(async bytes=>{
  const{editor,Document,LayerStyle,LayerMask,MarqueeSelection}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),phases:Record<string,number>={};let start=performance.now();
  await editor.openTiff(new File([new Uint8Array(bytes)],'50 MP native profile.tif',{type:'image/tiff'}),{editingPrecision:'float32'});phases.import=performance.now()-start;
  const hostBefore=JSON.stringify(editor.document.toJSON()),document=Document.fromJSON(editor.document.toJSON()),before=document.toJSON(),styles={dropShadow:{enabled:true,color:'#ad3f79',opacity:.625,x:200.25,y:100.75,blur:1.25}};
  document.transaction('Profile native shadow',()=>{const layer=document.layers.at(0)!;layer.fillOpacity=0;layer.styles=new LayerStyle(styles);layer.mask=new LayerMask({linked:false,selection:new MarqueeSelection({shape:'rectangle',x:3500,y:2000,width:1000,height:700})});});const edited=document.toJSON(),renderer=new CanvasRenderer(),metrics:Record<string,{calls:number;samples:number;milliseconds:number}>={},longTasks:number[]=[];
  const observer=new PerformanceObserver(list=>{for(const row of list.getEntries())longTasks.push(row.duration);});observer.observe({type:'longtask',buffered:false});
  const track=async(name:string,samples:number,run:()=>Promise<any>)=>{const row=metrics[name]??={calls:0,samples:0,milliseconds:0};row.calls++;row.samples+=samples;const at=performance.now();try{return await run();}finally{row.milliseconds+=performance.now()-at;}};
  const processor=renderer.processor as any;for(const name of['floatComposite','floatConvolveAlpha']){const original=processor[name].bind(processor);processor[name]=(...args:any[])=>track(name,args[0].length/(name==='floatComposite'?4:1),()=>original(...args));}
  const owner=(renderer as any).floatScene,originalSource=owner.source.bind(owner);owner.source=(...args:any[])=>{const source=originalSource(...args),read=source.readWindow.bind(source);source.readWindow=(b:any,c:any)=>track('sourceRead',b.width*b.height,()=>read(b,c));return source;};
  const originalMask=renderer.renderMaskCoverage.bind(renderer);renderer.renderMaskCoverage=(...args:any[])=>track('mask',args[1].width*args[1].height,()=>originalMask(...args as Parameters<typeof originalMask>));
  start=performance.now();const scene=await renderer.captureFloatScene(edited,editor.assetStore);phases.capture=performance.now()-start;const rounds=[];
  try{for(const name of['cold','retained']){const snapshot=structuredClone(metrics),windows=[];start=performance.now();let readMilliseconds=0;
   for(let row=0;row<16;row++)for(let col=0;col<16;col++){const bounds={x:3200+col*128,y:1850+row*64,width:128,height:64},at=performance.now(),pixels:Float32Array<ArrayBuffer>=await scene.read(bounds);readMilliseconds+=performance.now()-at;const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels.buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)visible++;windows.push({...bounds,sha256:digest,visible});}
   const work:typeof metrics={};for(const[key,value]of Object.entries(metrics)){const old=snapshot[key]??{calls:0,samples:0,milliseconds:0};work[key]={calls:value.calls-old.calls,samples:value.samples-old.samples,milliseconds:value.milliseconds-old.milliseconds};}rounds.push({name,milliseconds:performance.now()-start,readMilliseconds,work,windows});
  }}finally{scene.dispose();renderer.dispose();observer.disconnect();}
  document.undo();const undo=JSON.stringify(before)===JSON.stringify(document.toJSON());document.redo();return{phases,rounds,longTasks,undo,redo:JSON.stringify(edited)===JSON.stringify(document.toJSON()),hostExact:hostBefore===JSON.stringify(editor.document.toJSON()),dimensions:[editor.assetStore.values()[0].width,editor.assetStore.values()[0].height],sourceHash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await editor.assetStore.values()[0].blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('')};
 },[...bytes]);
 expect(result).toMatchObject({undo:true,redo:true,hostExact:true,dimensions:[10000,5000],sourceHash:createHash('sha256').update(bytes).digest('hex')});expect(result.rounds).toHaveLength(2);expect(result.rounds[0].windows).toEqual(result.rounds[1].windows);expect(result.rounds[0].windows.some(w=>w.visible>0)).toBe(true);expect(result.rounds[0].windows.some(w=>w.visible===0)).toBe(true);
 const file=info.outputPath('native-shadow-profile.json');await writeFile(file,JSON.stringify(result,null,2));const checked=spawnSync('python3',['scripts/check-float-shadow-profile.py',file],{encoding:'utf8',timeout:120000});await writeFile(info.outputPath('native-shadow-profile-reference.json'),checked.stdout);await writeFile(info.outputPath('native-shadow-profile-reference.stderr'),checked.stderr);expect(checked.status,checked.stderr||checked.stdout).toBe(0);
});
