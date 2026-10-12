import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';

test('fresh isolated script workers report initialization, document and command costs',async({page},info)=>{
 const built=await build({entryPoints:['src/scripting/runtime.ts'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',minify:true,
  banner:{js:'var __lumaBootStarted = performance.now();'},footer:{js:'var __lumaBootReady = performance.now();'},
  plugins:[{name:'benchmark-phases',setup(build){build.onLoad({filter:/scripting\/runtime\.ts$/},async({path})=>{
   let source=await readFile(path,'utf8');
   source=source.replace('const document = Document.fromJSON(event.data.document);','const __lumaDocumentStart=performance.now(); const document = Document.fromJSON(event.data.document); const __lumaDocumentReady=performance.now();');
   source=source.replace('    await run(', '    const __lumaExecuteStart=performance.now(); await run(');
   source=source.replace('    self.postMessage({\n      type: "result",','    logs.push(JSON.stringify({phase:"runtime",initializationMs:__lumaBootReady-__lumaBootStarted,documentMs:__lumaDocumentReady-__lumaDocumentStart,executeMs:performance.now()-__lumaExecuteStart}));\n    self.postMessage({\n      type: "result",');
   return {contents:source,loader:'ts'};
  });}}]});
 const runtimeSource=built.outputFiles[0].text;
 await page.addInitScript(runtimeSource=>{
  const descriptor=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'contentWindow')!;
  Object.defineProperty(HTMLIFrameElement.prototype,'contentWindow',{...descriptor,get(){
   const target=descriptor.get!.call(this) as Window|null;
   if(!target || !(this as HTMLIFrameElement).srcdoc.includes('runtimeSource'))return target;
   return {postMessage(data:any,origin:string,transfer:Transferable[]){
    target.postMessage(data?.runtimeSource?{...data,runtimeSource}:data,origin,transfer);
   }};
  }});
 },runtimeSource);
 await page.goto('/');
 const results=await page.evaluate(async()=>{
  const {editor:e,PaintLayer,PaintFill}=window.luma;
  const results=[];
  for(const layers of [5,64]){
   e.newDocument({width:800,height:600});
   e.document.transaction('Fixture',()=>{
    for(let i=0;i<layers;i++){const layer=e.document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:200,height:100},color:'#334455'}));}
   });
   for(const mutate of [false,true])for(let repeat=0;repeat<3;repeat++){
    const before=e.document.getSnapshot().revision,start=performance.now();
    const logs=await e.runScript(mutate?'document.transaction("Move all",()=>{for(const layer of document.layers)layer.x+=1;});':'print("Ready");');
    const phase=JSON.parse(logs.at(-1)!);
    results.push({layers,mutate,repeat,totalMs:performance.now()-start,...phase,revisionDelta:e.document.getSnapshot().revision-before});
    if(mutate)e.document.undo();
   }
  }
  return results;
 });
 console.log('script-runtime-phases',JSON.stringify(results));
 await info.attach('script-runtime-phases',{body:JSON.stringify(results),contentType:'application/json'});
 expect(results).toHaveLength(12);
 for(const row of results){expect(row.phase).toBe('runtime');expect(row.initializationMs).toBeGreaterThanOrEqual(0);expect(row.revisionDelta).toBe(row.mutate?1:0);}
});
