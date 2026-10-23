import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {createReadStream} from 'node:fs';
import {realpath,stat} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {createAuthHandler,type AuthHostOptions} from '../auth/http';

const types:Record<string,string>={'.html':'text/html; charset=utf-8','.xml':'application/xml; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.wasm':'application/wasm','.woff':'font/woff','.woff2':'font/woff2','.zip':'application/zip','.webmanifest':'application/manifest+json'};
export interface SiteOptions {origin:string;directory:string;auth?:AuthHostOptions}
export function createSiteHandler(options:SiteOptions){
 const origin=new URL(options.origin);if(origin.origin!==options.origin||!['https:','http:'].includes(origin.protocol))throw new Error('Configure the exact Canoli site origin.');
 if(options.auth&&options.auth.origin!==options.origin)throw new Error('The site and account origins must match.');const auth=options.auth?createAuthHandler(options.auth):undefined,root=resolve(options.directory);
 const plain=(response:ServerResponse,status:number,text:string)=>{response.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});response.end(text);};
 return async(request:IncomingMessage,response:ServerResponse)=>{
  response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','same-origin');response.setHeader('X-Frame-Options','DENY');
  try{
   if(request.headers.host!==origin.host){plain(response,403,'Use the configured Canoli site origin.');return;}
   const url=new URL(request.url??'/',origin);
   if(auth&&await auth(request,response))return;
   if(url.pathname.startsWith('/auth')){response.writeHead(url.pathname==='/auth/session'&&request.method==='GET'?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(url.pathname==='/auth/session'?{configured:false,csrf:null,user:null,pending:null,signingIn:false,notice:null}:{error:'Account sign-in is not configured on this installation.'}));return;}
   if(request.method!=='GET'&&request.method!=='HEAD'){plain(response,405,'Only file reads are supported.');return;}
   const pathname=decodeURIComponent(url.pathname);if(pathname.includes('\\')||pathname.includes('\0')||pathname.split('/').some(part=>part.startsWith('.'))){plain(response,404,'Not found.');return;}
   const extension=extname(pathname),relative=pathname==='/'||!extension?'index.html':pathname.slice(1),type=types[extname(relative)];if(!type){plain(response,404,'Not found.');return;}
   const path=await realpath(resolve(root,relative)),realRoot=await realpath(root);if(!path.startsWith(realRoot+sep)){plain(response,404,'Not found.');return;}
   const file=await stat(path);if(!file.isFile()){plain(response,404,'Not found.');return;}
   response.writeHead(200,{'Content-Type':type,'Content-Length':file.size,'Cache-Control':relative.startsWith('assets/')?'public, max-age=31536000, immutable':'no-cache'});if(request.method==='HEAD'){response.end();return;}const stream=createReadStream(path);stream.on('error',()=>response.destroy());stream.pipe(response);
  }catch{if(!response.headersSent)plain(response,404,'Not found.');else response.destroy();}
 };
}
export const createSiteServer=(options:SiteOptions)=>{const server=createServer(createSiteHandler(options));server.requestTimeout=15_000;server.headersTimeout=10_000;server.maxHeadersCount=80;return server;};
