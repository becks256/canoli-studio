import {test,expect} from '@playwright/test';
import{writeFile}from'node:fs/promises';
import type{AdaptiveRenderer}from'../src/engine/adaptive';

for(const nested of[false,true])test(`cold ${nested?'nested':'flat'} text composition admits input and preserves complete native pixels`,async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const result=await page.evaluate(async nested=>{
  const{editor,Document,TextLayer,LayerGroup}=window.luma,doc=new Document({width:800,height:600}),rows:{text:string;x:number;y:number}[]=[];
  doc.transaction('Dense native text',()=>{const owner=nested?doc.layers.add(new LayerGroup()).layers:doc.layers;for(let i=0;i<(nested?63:64);i++){const row={text:`${i} ${'Native font replacement '.repeat(40)}`,x:(i%8)*95,y:Math.floor(i/8)*60};rows.push(row);owner.add(new TextLayer({...row,fontFamily:'serif',fontSize:16,color:'#315b2a'}));}});
  await document.fonts.ready;const Renderer=editor.renderer.constructor as typeof AdaptiveRenderer,renderer=new Renderer(),snapshot=doc.getSnapshot().document,before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision;
  const reference=document.createElement('canvas');reference.width=800;reference.height=600;const expected=reference.getContext('2d')!;
  for(const row of rows){const plane=document.createElement('canvas');plane.width=800;plane.height=600;const c=plane.getContext('2d')!;c.font='16px serif';c.textBaseline='top';c.fillStyle='#315b2a';c.fillText(row.text,row.x,row.y);expected.drawImage(plane,0,0);plane.width=plane.height=0;}
  let complete=false,taskBeforeComplete=false;const timer=setTimeout(()=>{taskBeforeComplete=!complete;},0);let canvas:HTMLCanvasElement|undefined;
  try{canvas=await renderer.render(snapshot,editor.assetStore,{cache:false});complete=true;const a=canvas.getContext('2d')!.getImageData(0,0,800,600).data,b=expected.getImageData(0,0,800,600).data;let differentChannels=0,ink=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])differentChannels++;if(i%4===3)ink+=a[i];}return{taskBeforeComplete,differentChannels,channels:a.length,ink,modelExact:before===JSON.stringify(doc.toJSON()),revisionExact:revision===doc.getSnapshot().revision};}
  finally{clearTimeout(timer);if(canvas)canvas.width=canvas.height=0;reference.width=reference.height=0;renderer.dispose();}
 },nested);
 expect(result).toMatchObject({taskBeforeComplete:true,differentChannels:0,channels:1920000,modelExact:true,revisionExact:true});expect(result.ink).toBeGreaterThan(0);await writeFile(info.outputPath('native-layer-scheduling.json'),JSON.stringify(result,null,2));
});

test('dense text cancellation releases private canvases and a complete retry succeeds',async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const result=await page.evaluate(async()=>{
  const{editor,Document,TextLayer}=window.luma,doc=new Document({width:800,height:600});doc.transaction('Cold text',()=>{for(let i=0;i<64;i++)doc.layers.add(new TextLayer({text:`${i} ${'Native text '.repeat(80)}`,x:10,y:i*8,fontSize:16,color:'#315b2a'}));});await document.fonts.ready;
  const Renderer=editor.renderer.constructor as typeof AdaptiveRenderer,renderer=new Renderer(),created:HTMLCanvasElement[]=[],create=document.createElement.bind(document);let cancelled=false,aborted=false;
  document.createElement=((...args:Parameters<typeof create>)=>{const element=create(...args);if(element instanceof HTMLCanvasElement)created.push(element);return element;})as typeof document.createElement;const timer=setTimeout(()=>{cancelled=true;},0);
  try{try{const canvas=await renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:false,isCancelled:()=>cancelled});canvas.width=canvas.height=0;}catch(error){aborted=error instanceof DOMException&&error.name==='AbortError';}const released=created.every(c=>c.width<=1&&c.height<=1);document.createElement=create;const retry=await renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:false});try{return{aborted,released,created:created.length,retryInk:retry.getContext('2d')!.getImageData(0,0,800,600).data.some((v,i)=>i%4===3&&v>0)};}finally{retry.width=retry.height=0;}}
  finally{clearTimeout(timer);document.createElement=create;renderer.dispose();}
 });
 expect(result).toMatchObject({aborted:true,released:true,retryInk:true});expect(result.created).toBeGreaterThan(0);await writeFile(info.outputPath('cancelled-text-render.json'),JSON.stringify(result,null,2));
});

test('switching documents cancels obsolete cold text before a complete stale frame can publish',async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 await page.evaluate(async()=>{
  const{editor:e,TextLayer,PaintLayer,PaintFill}=window.luma;await document.fonts.ready;const state={started:0,changed:0,aborted:false,completed:false,presented:0,pixel:[]as number[]};(window as any).layerScheduling=state;const prepare=e.renderer.prepareViewport.bind(e.renderer);
  e.renderer.prepareViewport=async(doc,assets,options)=>{const heavy=doc.name==='Obsolete text'&&doc.children.length===64;if(heavy){state.started=performance.now();setTimeout(()=>{state.changed=performance.now();e.newDocument({name:'Latest solid',width:698,height:396});const layer=e.document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:698,height:396},color:'#207040'}));},0);}try{const frame=await prepare(doc,assets,options);if(heavy)state.completed=true;if(doc.name==='Latest solid'&&doc.children.length){const present=frame.present.bind(frame);frame.present=canvas=>{present(canvas);state.presented=performance.now();state.pixel=[...canvas.getContext('2d')!.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data];};}return frame;}catch(error){if(heavy)state.aborted=error instanceof DOMException&&error.name==='AbortError';throw error;}};
  e.newDocument({name:'Obsolete text',width:800,height:600});e.document.transaction('Dense text',()=>{for(let i=0;i<64;i++)e.document.layers.add(new TextLayer({text:`${i} ${'Cold text '.repeat(80)}`,x:(i%8)*95,y:Math.floor(i/8)*60,fontSize:16}));});
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).layerScheduling.presented)).toBeGreaterThan(0);const result=await page.evaluate(()=>(window as any).layerScheduling);expect(result).toMatchObject({aborted:true,completed:false,pixel:[32,112,64,255]});expect(result.changed).toBeGreaterThan(result.started);await expect(page.getByText('Render superseded.',{exact:true})).toHaveCount(0);await writeFile(info.outputPath('obsolete-text-frame.json'),JSON.stringify(result,null,2));
});
