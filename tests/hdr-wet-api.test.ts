import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {encodeFloatWetTile} from '../src/core/float-wet-tile';
import {WetPaintStroke,PencilStroke,PaintLayer} from '../src/dom';
import {readProject} from '../src/core/project';

const directory=await mkdtemp(join(tmpdir(),'canoli-hdr-wet-api-')),server=createApiServer({authToken:'hdr-wet-test',precisionCacheDirectory:directory}),auth={authorization:'Bearer hdr-wet-test'};let base:string;
beforeAll(async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});});
const json=(value:unknown)=>({method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(value)});

it.each(['raster','paint'] as const)('independent REST %s accepts complete native HDR pairs with atomic history, revisions and source-bearing projects',async targetKind=>{
 const response=await fetch(base+'/documents',json({name:'HDR wet session',width:131,height:79}));expect(response.status).toBe(201);const id=(await response.json()).document.id,endpoint=base+'/documents/'+id;
 const original=new Blob([new Uint8Array(await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif'))],{type:'image/tiff'}),pixels=await encodeFloatWetTile(new Float32Array([4,-2,8,.375,16,-8,4,.125]),2,1),coverage=await encodeFloatWetTile(new Float32Array([0,0,0,.5,0,0,0,.75]),2,1),invalid=await encodeFloatWetTile(new Float32Array([0,0,0,.125,0,0,0,.75]),2,1);
 let revision=0;const imported:{assetId:string;layerId:string;blob:Blob}[]=[];
 for(const blob of [original,pixels,coverage,invalid]){
  const reply=await fetch(endpoint+`/tiff-import?expectedRevision=${revision}&name=Prepared.tif`,{method:'POST',headers:{...auth,'content-type':'image/tiff','x-tiff-options':JSON.stringify({editingPrecision:'float32'})},body:blob});expect(reply.status,await reply.clone().text()).toBe(201);const value=await reply.json();revision=value.revision;imported.push({assetId:value.assetId,layerId:value.layerId,blob});
 }
 const paint=new PaintLayer({name:'REST HDR paint'});if(targetKind==='paint'){const reply=await fetch(endpoint+'/commands',json({expectedRevision:revision,commands:[{type:'layer.add',layer:paint.toJSON()}]}));expect(reply.status).toBe(200);revision=(await reply.json()).revision;}
 const read=async()=>{const reply=await fetch(endpoint,{headers:auth});expect(reply.status).toBe(200);return reply.json();},before=await read();
 const prepared=JSON.parse(JSON.stringify(new WetPaintStroke({precision:'float32',brush:new PencilStroke({points:[{x:3.5,y:4.5}]}),opacity:.625,load:{color:[4,-2,8,.375]},tiles:[{x:3,y:4,width:2,height:1,assetId:imported[1].assetId,coverage:{assetId:imported[2].assetId}}]}).toJSON()));
 const stroke=(assetId:string)=>({...prepared,tiles:[{...prepared.tiles[0],coverage:{assetId}}]});
 const patch=(assetId:string)=>targetKind==='paint'?{type:'paint.add',id:paint.id,stroke:stroke(assetId)}:{type:'layer.update',id:imported[0].layerId,patch:{erasures:[{width:131,height:79,stroke:stroke(assetId)}]}};
 const bad=await fetch(endpoint+'/commands',json({expectedRevision:revision,commands:[{type:'document.rename',name:'Must roll back'},patch(imported[3].assetId)]}));expect(bad.status).toBe(400);expect((await bad.json()).error).toMatch(/already be masked/);expect(await read()).toEqual(before);
 const changed=await fetch(endpoint+'/commands',json({expectedRevision:revision,label:'Prepared HDR',commands:[patch(imported[2].assetId)]}));expect(changed.status,await changed.clone().text()).toBe(200);const after=await changed.json();expect(after.revision).toBe(revision+1);expect(after.document.schemaVersion).toBe(57);const edited=after.document.children.find((layer:{id:string})=>layer.id===(targetKind==='paint'?paint.id:imported[0].layerId));expect(targetKind==='paint'?edited.strokes[0]:edited.erasures[0].stroke).toEqual(stroke(imported[2].assetId));
 expect((await fetch(endpoint+'/commands',json({expectedRevision:revision,commands:[patch(imported[2].assetId)]}))).status).toBe(409);
 const projectResponse=await fetch(endpoint+'/project?history=true',{headers:auth});expect(projectResponse.status).toBe(200);const project=await readProject(await projectResponse.blob());expect(project.document).toEqual(after.document);expect(project.history?.past.length).toBe(targetKind==='paint'?6:5);
 for(const row of imported){const entry=project.entries.find(entry=>entry.id===row.assetId);expect(entry?.tiff?.editingPrecision).toBe('float32');expect(Buffer.from(await entry!.blob.arrayBuffer())).toEqual(Buffer.from(await row.blob.arrayBuffer()));}
 const undone=await fetch(endpoint+'/undo',json({expectedRevision:after.revision}));expect(undone.status).toBe(200);const undo=await undone.json();expect(undo.document).toEqual(before.document);const redone=await fetch(endpoint+'/redo',json({expectedRevision:undo.revision}));expect(redone.status).toBe(200);expect((await redone.json()).document).toEqual(after.document);
},30000);
