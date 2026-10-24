import {afterAll,beforeAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {readFile} from 'node:fs/promises';
import {createApiServer} from '../server/app';
import {prepareServerFont} from '../server/fonts';
import {TextLayer} from '../src/dom';
import {readProject} from '../src/core/project';
import {prepareFontBytes} from '../src/fonts/parser';

const server=createApiServer({authToken:'font-files-test-token'});let base:string;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1`;});
afterAll(async()=>{if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
const headers={Authorization:'Bearer font-files-test-token','Content-Type':'application/json'};
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined});return{status:response.status,body:await response.json()};}
async function upload(path:string,revision:number,options:unknown={},name='Collection.ttc',mime='application/octet-stream'){
  const response=await fetch(base+path+`/fonts?expectedRevision=${revision}`,{method:'POST',headers:{...headers,'Content-Type':mime,'X-Font-Options':JSON.stringify(options)},body:new Uint8Array(await readFile('tests/fixtures/fonts/'+name))});return{status:response.status,body:await response.json()};
}

it('admits a selected real font in one revisioned undoable edit and returns exact original/native bytes',async()=>{
  const created=await request('/documents',{width:300,height:100}),path='/documents/'+created.body.document.id,text=new TextLayer({text:'AAAA',fontFamily:'serif'});
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:text.toJSON()}]}),embedded=await upload(path,added.body.revision,{faceIndex:1,replace:'serif',name:'REST bold'});
  expect(embedded.status,JSON.stringify(embedded.body)).toBe(201);expect(embedded.body.metrics).toBe('estimated');expect(embedded.body.revision).toBe(added.body.revision+1);expect(embedded.body.file.name).toBe('REST bold');expect(embedded.body.document.children[0].fontFamily).toBe(embedded.body.file.resource.report.faces[0].cssFamily);
  const inventory=await request(path+'/fonts');expect(inventory.body.files).toEqual([embedded.body.file]);expect((await request(path+'/fonts/'+embedded.body.file.id)).body.file).toEqual(embedded.body.file);
  const original=await fetch(base+path+'/fonts/'+embedded.body.file.id+'?source=original',{headers}),render=await fetch(base+path+'/fonts/'+embedded.body.file.id+'?source=render',{headers});
  expect(Buffer.from(await original.arrayBuffer())).toEqual(await readFile('tests/fixtures/fonts/Collection.ttc'));
  const expected=await prepareFontBytes(new Uint8Array(await readFile('tests/fixtures/fonts/Collection.ttc')),{faceIndex:1});expect(render.headers.get('content-type')).toBe('font/ttf');expect(await render.arrayBuffer()).toEqual(await expected.renderBlob.arrayBuffer());
  const undone=await request(path+'/undo',{expectedRevision:embedded.body.revision});expect(undone.body.document).toEqual(added.body.document);expect((await request(path+'/fonts/'+embedded.body.file.id)).status).toBe(404);
  const redone=await request(path+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(embedded.body.document);
});

it('uses strict options, explicit collection selection, binary bodies and current revisions without partial edits',async()=>{
  const created=await request('/documents',{}),path='/documents/'+created.body.document.id;
  for(const options of [{},{faceIndex:99},{faceIndex:0,extra:true},{faceIndex:0,name:''}])expect((await upload(path,0,options)).status).toBe(400);
  expect((await upload(path,1,{faceIndex:0})).status).toBe(409);expect((await request(path)).body.document).toEqual(created.body.document);
  const corrupt=await fetch(base+path+'/fonts?expectedRevision=0',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:new Uint8Array([1,2,3,4])});expect(corrupt.status).toBe(400);
  const json=await fetch(base+path+'/fonts?expectedRevision=0',{method:'POST',headers,body:'{}'});expect(json.status).toBe(400);expect((await request(path+'/fonts')).body.files).toEqual([]);
});

it('rolls back locked replacements and never accepts another session’s unowned font declaration',async()=>{
  const created=await request('/documents',{}),path='/documents/'+created.body.document.id,text=new TextLayer({text:'ABC',fontFamily:'serif',locked:true}),added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:text.toJSON()}]});
  expect((await upload(path,added.body.revision,{replace:'serif'},'Regular.ttf')).status).toBe(400);expect((await request(path)).body.document).toEqual(added.body.document);expect((await request(path+'/fonts')).body.files).toEqual([]);
  const embedded=await upload(path,added.body.revision,{},'Regular.ttf');expect(embedded.status).toBe(201);
  const other=await request('/documents',{}),otherPath='/documents/'+other.body.document.id,forged=await request(otherPath+'/commands',{expectedRevision:0,commands:[{type:'font.file.add',file:embedded.body.file}]});expect(forged.status).toBe(400);expect((await request(otherPath+'/fonts')).body.files).toEqual([]);
  const unauthenticated=await fetch(base+path+'/fonts/'+embedded.body.file.id+'?source=original');expect(unauthenticated.status).toBe(401);
});

it('delivers native font payloads in independent REST projects without claiming browser-native metrics',async()=>{
  const created=await request('/documents',{}),path='/documents/'+created.body.document.id,embedded=await upload(path,0,{},'Regular.woff2');expect(embedded.status).toBe(201);
  const response=await fetch(base+path+'/project',{headers});expect(response.status).toBe(200);const decoded=await readProject(await response.blob());expect(decoded.fonts).toHaveLength(1);expect(decoded.document.fontFiles![0]).toEqual(embedded.body.file);expect(Buffer.from(await decoded.fonts[0].original.arrayBuffer())).toEqual(await readFile('tests/fixtures/fonts/Regular.woff2'));
});

it('cancels and times out actual Node parser workers, then admits a valid subsequent face',async()=>{
  const source=new Blob([new Uint8Array(await readFile('tests/fixtures/fonts/Regular.ttf'))]),abort=new AbortController();
  await expect(prepareServerFont(source,{}, {signal:abort.signal,onProgress(){abort.abort(new Error('Font cancelled by caller.'));}})).rejects.toThrow('Font cancelled by caller');
  await expect(prepareServerFont(source,{}, {timeoutMs:1})).rejects.toThrow('time budget');
  const value=await prepareServerFont(source,{},{});expect(value.report.faces[0].fullName).toBe('Canoli Source Regular');expect(value.fontFaces).toBeUndefined();
});

it('downloads original bytes as binary attachments without reflecting an uploaded HTML content type',async()=>{
  const created=await request('/documents',{}),path='/documents/'+created.body.document.id,embedded=await upload(path,0,{},'Regular.ttf','text/html');expect(embedded.status).toBe(201);
  const original=await fetch(base+path+'/fonts/'+embedded.body.file.id+'?source=original',{headers});expect(original.headers.get('content-type')).toBe('application/octet-stream');expect(original.headers.get('content-disposition')).toBe('attachment; filename="font-original.ttf"');expect(original.headers.get('x-content-type-options')).toBe('nosniff');expect(Buffer.from(await original.arrayBuffer())).toEqual(await readFile('tests/fixtures/fonts/Regular.ttf'));
});
