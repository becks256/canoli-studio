import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {wasmMattingIterations} from '../src/engine/matting-iterations';
import {ClosedFormMatting} from '../src/intelligence/matting/closed-form';
import {refineEdgeOptionsSchema} from '../src/core/matting';
import {prepareMattingTile,refineMattingTile} from '../src/engine/matting-tile';
import {runMattingJob} from '../src/engine/matting-workflow';
import {encodeMattingOutput,type MattingRegion} from '../src/engine/matting-output';
import {instantiateKernel} from '../src/engine/wasm';
import {openPngRows} from '../server/png-rows';

const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const split=arg.indexOf('=');if(!arg.startsWith('--')||split<0)throw new Error('Use --name=value arguments.');return[arg.slice(2,split),arg.slice(split+1)];}));
for(const key of Object.keys(args))if(!['dataset','output','split','ids','resume','preconditioner','coarse','iterations'].includes(key))throw new Error(`Unknown option ${key}`);
if(!args.dataset||!args.output)throw new Error('Use --dataset=/outside/repo/cache --output=/tmp/report.json [--split=development|holdout|all] [--ids=GT01,GT04] [--resume=true]');
const conditioning=args.preconditioner??'ic0';if(!['ic0','jacobi'].includes(conditioning))throw new Error('Invalid preconditioner.');
if(args.coarse!==undefined&&!['true','false'].includes(args.coarse))throw new Error('Invalid coarse correction option.');const coarse=args.coarse!=='false';
if(args.iterations!==undefined&&!['wasm','javascript'].includes(args.iterations))throw new Error('Invalid iteration backend.');const iterations=args.iterations??'wasm';
const root=resolve(args.dataset),output=resolve(args.output),split=args.split??'development';if(!['development','holdout','all'].includes(split))throw new Error('Invalid split.');
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const sourcePaths=['src/intelligence/matting/closed-form.ts','src/intelligence/matting/coarse.ts','src/intelligence/matting/iterations.ts','src/engine/matting-iterations.ts','src/engine/wasm.ts','assembly/matting.ts','src/engine/pixels.worker.ts','server/matting-runtime.ts','server/matting-worker.mjs','src/intelligence/matting/engine.ts','src/engine/matting-tile.ts','src/engine/matting-workflow.ts','src/core/matting.ts','server/png-rows.ts','public/wasm/pixels.wasm'];
const hashes=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,sha(await readFile(path))])));
const selectedIds=args.ids?.split(','),cases=manifest.cases.filter((item:any)=>(split==='all'||item.split===split)&&(!selectedIds||selectedIds.includes(item.imageId)));
if(!cases.length||selectedIds?.some((id:string)=>!cases.some((item:any)=>item.imageId===id)))throw new Error('Requested image IDs are missing or outside the selected split.');
let report:any={date:new Date().toISOString(),source:manifest.source,citation:manifest.citation,splitRule:manifest.splitRule,split,selectedIds,archives:manifest.archives,manifestSha256:sha(await readFile(join(root,'manifest.json'))),sourceHashes:hashes,runtime:process.version,cpu:cpus()[0]?.model,measurement:'Actual native global workflow and PNG bytes in Node; not browser/input-to-photon timing or official hidden-test ranking',options:{preconditioner:conditioning,coarse,iterations,solver:'closed-form',radius:10,smoothness:[0,10],edgeFeather:0,contrast:0,shiftEdge:0,decontaminate:false},cases:[]};
if(args.resume==='true'){report=JSON.parse(await readFile(output,'utf8'));if(JSON.stringify(report.sourceHashes)!==JSON.stringify(hashes)||report.manifestSha256!==sha(await readFile(join(root,'manifest.json')))||report.split!==split||JSON.stringify(report.selectedIds)!==JSON.stringify(selectedIds)||report.options.preconditioner!==conditioning||report.options.coarse!==coarse||report.options.iterations!==iterations)throw new Error('Resume inputs/code differ; choose a new report.');}
await mkdir(resolve(output,'..'),{recursive:true});const outputRoot=output.replace(/\.json$/,'')+'-outputs';await mkdir(outputRoot,{recursive:true});
const kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));
async function alphaBytes(blob:Blob){const image=openPngRows(new Uint8Array(await blob.arrayBuffer())),alpha=new Uint8Array(image.width*image.height);for await(const strip of image.strips)for(let i=0;i<strip.pixels.length/4;i++)alpha[strip.y*image.width+i]=strip.pixels[i*4+3];return alpha;}
function metrics(alpha:Uint8Array,truth:Uint8Array,labels:Uint8Array){let abs=0,squared=0,unknown=0,maxError=0,knownLabelViolations=0;for(let i=0;i<alpha.length;i++){if(labels[i]!==128){knownLabelViolations+=alpha[i]!==labels[i]?1:0;continue;}unknown++;const error=Math.abs(alpha[i]-truth[i])/255;abs+=error;squared+=error*error;maxError=Math.max(maxError,error);}return{unknownPixels:unknown,unknownMAE:abs/unknown,unknownMSE:squared/unknown,unknownSADDiv1000:abs/1000,unknownMaximumError:maxError,knownLabelViolations};}
for(const item of cases){
 if(report.cases.some((entry:any)=>entry.id===item.id))continue;
 console.log(JSON.stringify({event:'start',id:item.id,unknownPixels:item.unknownPixels}));const began=performance.now();let solver:ClosedFormMatting|undefined,lastProgress:any;
 const result:any={id:item.id,imageId:item.imageId,variant:item.variant,split:item.split,width:item.width,height:item.height,unknownPixels:item.unknownPixels,sourceSha256:item.sha256};
 try{
  const png=await readFile(join(root,item.input));if(sha(png)!==item.sha256.originalPng)throw new Error('Original input PNG changed.');const image=openPngRows(new Uint8Array(png)),rgba=new Uint8ClampedArray(item.width*item.height*4);if(image.width!==item.width||image.height!==item.height)throw new Error('Source geometry changed.');for await(const strip of image.strips)rgba.set(strip.pixels,strip.y*item.width*4);
  const external=new Uint8Array(await readFile(join(root,item.rgba)));if(external.length!==rgba.length||!external.every((value,i)=>value===rgba[i]))throw new Error('Actual native PNG decode differs from independent Pillow input bytes.');
  const labels=new Uint8Array(await readFile(join(root,item.trimap))),truth=new Uint8Array(await readFile(join(root,item.truth)));if(labels.length!==item.width*item.height||truth.length!==labels.length||sha(truth)!==item.sha256.groundTruthBytes||labels.some(value=>![0,128,255].includes(value)))throw new Error('Reference/trimap bytes changed.');
  let options=refineEdgeOptionsSchema.parse({solver:'closed-form',radius:10,smoothness:0,trimapAssetId:'benchmark-labels'});
  const capture=async(region:MattingRegion)=>{
   const pixels=new Uint8ClampedArray(region.width*region.height*4),local=new Uint8Array(region.width*region.height);
   for(let y=0;y<region.height;y++){const yy=region.y+y;if(yy<0||yy>=item.height)continue;const left=Math.max(0,region.x),right=Math.min(item.width,region.x+region.width);if(right<=left)continue;const from=yy*item.width+left,to=y*region.width+left-region.x;pixels.set(rgba.subarray(from*4,(from+right-left)*4),to*4);local.set(labels.subarray(from,from+right-left),to);}
   return{pixels,request:{...region,sourceWidth:item.width,sourceHeight:item.height,labels:local,options:{...options,trimapAssetId:undefined}}};
  };
  let logIteration=-1;
  const native=await runMattingJob(item.width,item.height,options,capture,{async begin(width,height){solver=new ClosedFormMatting(width,height);},async accumulate(pixels,request){solver!.add({...request,...prepareMattingTile(pixels,request)});},async solve(progress){return solver!.solve(progress,2000,conditioning as 'ic0'|'jacobi',coarse,iterations==='wasm'?wasmMattingIterations(kernel):undefined);},async tile(pixels,request){return refineMattingTile(kernel,pixels,request,solver);}}, {onProgress:progress=>{lastProgress=progress;if(progress.phase==='solve'&&(progress.iteration??0)>=logIteration+500){logIteration=progress.iteration!;console.log(JSON.stringify({event:'solve',id:item.id,iteration:logIteration,residual:progress.relativeResidual}));}}});
  result.diagnostics=native.diagnostics;result.outputs=[];
  for(const smoothness of [0,10]){
   options=refineEdgeOptionsSchema.parse({...options,smoothness});let blob=native.maskBlob;
   if(smoothness){blob=(await encodeMattingOutput(item.width,item.height,options,async region=>{const tile=await capture(region);return refineMattingTile(kernel,tile.pixels,tile.request,solver);})).maskBlob;}
   const bytes=await alphaBytes(blob),path=join(outputRoot,item.id+'-smooth'+smoothness+'.alpha');await writeFile(path,bytes);result.outputs.push({smoothness,path,sha256:sha(bytes),metrics:metrics(bytes,truth,labels)});
  }
  result.status='success';
 }catch(error){result.status='error';result.error=error instanceof Error?error.message:String(error);result.lastProgress=lastProgress;}
 finally{solver?.dispose();}
 result.elapsedMs=performance.now()-began;report.cases.push(result);report.complete=report.cases.length===cases.length;report.expectedCases=cases.length;await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({event:'finish',...result,outputs:result.outputs?.map((entry:any)=>({smoothness:entry.smoothness,metrics:entry.metrics}))}));
}
