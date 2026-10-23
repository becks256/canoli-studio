import {expect,it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {request as httpRequest} from 'node:http';
import {ChatGptHub} from '../server/chatgpt/hub';
import {startChatGptBridge} from '../server/chatgpt/http';
import {parseConnectionCode} from '../src/integrations/chatgpt/protocol';
const editorOrigin='http://127.0.0.1:5173',document={id:'native-document',name:'Explicit artwork',revision:0,width:10000,height:5000};

it('real loopback HTTP enforces Host, Origin, owner authorization and pairing cancellation without exposing credentials',async()=>{
 const hub=new ChatGptHub(),bridge=await startChatGptBridge(hub);try{
  const requested=hub.beginPairing(bridge.origin),code=parseConnectionCode(requested.connectionCode).code;
  const send=(path:string,value:unknown,headers:Record<string,string>={})=>fetch(bridge.origin+path,{method:'POST',headers:{Origin:editorOrigin,'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
  const rebound=await new Promise<number>((resolve,reject)=>{const request=httpRequest(bridge.origin+'/v1/pair',{method:'POST',headers:{Host:'evil.invalid',Origin:editorOrigin,'Content-Type':'application/json'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode!));});request.on('error',reject);request.end(JSON.stringify({code,document,permissions:{read:true,write:false}}));});expect(rebound).toBe(403);
  expect((await send('/v1/pair',{code,document,permissions:{read:true,write:false}},{Origin:'null'})).status).toBe(403);
  const response=await send('/v1/pair',{code,document,permissions:{read:true,write:false}}),paired=await response.json();expect(response.status).toBe(201);expect(paired.owner).toMatch(/^[a-f0-9]{64}$/);expect((await fetch(bridge.origin+'/v1/connections/'+paired.id+'/events',{headers:{Origin:editorOrigin}})).status).toBe(400);
  expect((await fetch(bridge.origin+'/v1/connections/'+paired.id+'/events',{headers:{Origin:'https://different.invalid',Authorization:'Bearer '+paired.owner}})).status).toBe(400);
  expect(JSON.stringify(hub.list())).not.toContain(paired.owner);expect((await send('/v1/cancel-pair',{code})).status).toBe(200);expect(hub.list()).toEqual([]);
 }finally{await bridge.close();}
});

it('the actual SDK stdio client discovers tools/resources and inspects only an explicitly paired browser owner',async()=>{
 const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','server/chatgpt/index.ts'],cwd:process.cwd(),stderr:'pipe'}),client=new Client({name:'canoli-independent-sdk-client',version:'1.0.0'});
 try{
  await client.connect(transport);const tools=await client.listTools();expect(tools.tools.map(tool=>tool.name)).toEqual(['canoli_begin_connection','canoli_list_documents','canoli_read_document','canoli_new_layer_template','canoli_apply_edits','canoli_undo','canoli_redo','canoli_disconnect_document']);expect(tools.tools.find(tool=>tool.name==='canoli_read_document')!.annotations!.readOnlyHint).toBe(true);expect(tools.tools.find(tool=>tool.name==='canoli_apply_edits')!.annotations!.destructiveHint).toBe(true);
  const resource=await client.readResource({uri:'canoli://commands'});expect(resource.contents[0].mimeType).toBe('application/json');const schema=JSON.parse((resource.contents[0]as{text:string}).text);expect(JSON.stringify(schema)).toContain('document.rename');expect(schema.commands.map((entry:{type:string})=>entry.type)).toEqual(expect.arrayContaining(['document.resize','document.resizeImage']));expect(Buffer.byteLength((resource.contents[0]as{text:string}).text)).toBeLessThan(20000);const focused=await client.readResource({uri:'canoli://layer-update-field/opacity'});expect(JSON.parse((focused.contents[0]as{text:string}).text).valueSchema).toMatchObject({type:'number',minimum:0,maximum:1});
  const empty=await client.callTool({name:'canoli_list_documents',arguments:{}});expect(empty.structuredContent).toEqual({connections:[]});
  const pairing=await client.callTool({name:'canoli_begin_connection',arguments:{}}),code=parseConnectionCode((pairing.structuredContent as{connectionCode:string}).connectionCode);
  const pair=await fetch(code.origin+'/v1/pair',{method:'POST',headers:{Origin:editorOrigin,'Content-Type':'application/json'},body:JSON.stringify({code:code.code,document,permissions:{read:true,write:false}})}),owner=await pair.json();expect(pair.status).toBe(201);
  const list=await client.callTool({name:'canoli_list_documents',arguments:{}});expect(list.structuredContent).toMatchObject({connections:[{connectionId:owner.id,document,permissions:{read:true,write:false}}]});expect(JSON.stringify(list)).not.toContain(owner.owner);
  const mutation=await client.callTool({name:'canoli_apply_edits',arguments:{connectionId:owner.id,expectedRevision:0,label:'Must reject',commands:[{type:'document.rename',name:'Wrong'}],idempotencyKey:'denied'}});expect(mutation.isError).toBe(true);expect(mutation.structuredContent).toMatchObject({ok:false,error:{code:'PERMISSION_DENIED'}});
  const reading=client.callTool({name:'canoli_read_document',arguments:{connectionId:owner.id}}),eventResponse=await fetch(code.origin+'/v1/connections/'+owner.id+'/events',{headers:{Origin:editorOrigin,Authorization:'Bearer '+owner.owner}}),event=await eventResponse.json();expect(event).toMatchObject({kind:'request',operation:{kind:'inspect'}});
  const accepted=await fetch(code.origin+'/v1/connections/'+owner.id+'/results/'+event.id,{method:'POST',headers:{Origin:editorOrigin,Authorization:'Bearer '+owner.owner,'Content-Type':'application/json'},body:JSON.stringify({document,result:{ok:true,value:{document,revision:0,canUndo:false,canRedo:false}}})});expect(accepted.status).toBe(200);expect((await reading).structuredContent).toMatchObject({ok:true,value:{revision:0,document}});
  await client.callTool({name:'canoli_disconnect_document',arguments:{connectionId:owner.id}});expect((await client.callTool({name:'canoli_list_documents',arguments:{}})).structuredContent).toEqual({connections:[]});
 }finally{await client.close();await transport.close();}
},15000);
