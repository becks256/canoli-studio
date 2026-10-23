import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {z} from 'zod';
import {ChatGptHub} from './hub';
import {boundedJson,connectedDocumentSchema,connectionPermissionsSchema,MCP_METADATA_BYTES,MCP_BRIDGE_VERSION} from '../../src/integrations/chatgpt/protocol';

function validOrigin(value:string){try{const url=new URL(value);return url.origin===value&&(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname));}catch{return false;}}
async function body(request:IncomingMessage){const chunks:Buffer[]=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>MCP_METADATA_BYTES)throw new Error('Connection metadata exceeds its 2 MB budget.');chunks.push(Buffer.from(chunk));}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));boundedJson(value);return value;}
const pairSchema=z.object({code:z.string().regex(/^[a-f0-9]{64}$/),document:connectedDocumentSchema,permissions:connectionPermissionsSchema}).strict();
const resultSchema=z.object({result:z.unknown(),document:connectedDocumentSchema}).strict();
export async function startChatGptBridge(hub:ChatGptHub,port=0){
 let host='';
 const send=(response:ServerResponse,status:number,value:unknown)=>{const json=boundedJson(value);response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(json);};
 const server=createServer(async(request,response)=>{
  const origin=request.headers.origin;
  if(request.headers.host!==host||!origin||!validOrigin(origin)){send(response,403,{error:'Only an explicitly paired editor origin may use this loopback bridge.'});return;}
  response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin');
  if(request.method==='OPTIONS'){
   response.setHeader('Access-Control-Allow-Methods','POST, GET, DELETE, OPTIONS');response.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
   if(request.headers['access-control-request-private-network']==='true')response.setHeader('Access-Control-Allow-Private-Network','true');response.writeHead(204);response.end();return;
  }
  try{
   const url=new URL(request.url??'/','http://'+host);if(url.search)throw new Error('Connection credentials cannot be supplied in URLs.');
   if(url.pathname==='/v1/pair'&&request.method==='POST'){
    const value=pairSchema.parse(await body(request)),paired=hub.pair(value.code,origin,value.document,value.permissions);send(response,201,{version:MCP_BRIDGE_VERSION,...paired});return;
   }
   if(url.pathname==='/v1/cancel-pair'&&request.method==='POST'){const value=z.object({code:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(await body(request));hub.cancelPairing(value.code,origin);send(response,200,{cancelled:true});return;}
   const match=/^\/v1\/connections\/([a-f0-9-]+)(?:\/(events)|\/(authorize|results)\/([a-f0-9-]+))?$/.exec(url.pathname);
   if(!match){send(response,404,{error:'Unknown connection endpoint.'});return;}
   const [,id,eventAction,writeAction,requestId]=match,action=eventAction??writeAction,authorization=request.headers.authorization,owner=authorization?.startsWith('Bearer ')?authorization.slice(7):'';
   hub.authenticate(id,owner,origin);
   if(request.method==='DELETE'&&!action){hub.disconnectOwner(id,owner,origin);send(response,200,{disconnected:true});return;}
   if(request.method==='GET'&&action==='events'&&!requestId){
    const abort=new AbortController(),closed=()=>{if(!response.writableEnded)abort.abort(new Error('Owner poll disconnected.'));};response.on('close',closed);
    try{send(response,200,await hub.next(id,owner,origin,abort.signal));}finally{response.off('close',closed);}return;
   }
   if(request.method==='POST'&&action==='authorize'&&requestId){send(response,200,hub.authorize(id,owner,origin,requestId));return;}
   if(request.method==='POST'&&action==='results'&&requestId){const value=resultSchema.parse(await body(request));hub.complete(id,owner,origin,requestId,value.result,value.document);send(response,200,{accepted:true});return;}
   send(response,404,{error:'Unknown connection operation.'});
  }catch(error){if(!response.destroyed&&!response.writableEnded)send(response,400,{error:(error instanceof Error?error.message:String(error)).slice(0,2048)});}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string')throw new Error('The local bridge could not obtain a loopback address.');host='127.0.0.1:'+address.port;
 return{origin:'http://'+host,server,async close(){hub.dispose();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
