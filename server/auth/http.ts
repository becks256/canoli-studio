import type {IncomingMessage,ServerResponse} from 'node:http';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {AccountStore,type BrowserSession,type AuthTransaction} from './store';
import {OpenAiIdentityClient,OPENAI_ISSUER,randomToken} from './oidc';

export interface AuthHostOptions {origin:string;store:AccountStore;identity:OpenAiIdentityClient;allowInsecureLoopback?:boolean}
const actionSchema=z.object({csrf:z.string(),intent:z.enum(['signin','link']).optional(),pendingId:z.string().max(128).optional()}).strict();
function cookie(request:IncomingMessage,name:string){const values=(request.headers.cookie??'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(name+'='));if(values.length!==1)return undefined;return values[0].slice(name.length+1);}
async function readAction(request:IncomingMessage){let body='';for await(const chunk of request){body+=chunk.toString('utf8');if(Buffer.byteLength(body)>8192)throw new Error('Invalid account request.');}if(request.headers['content-type']?.split(';')[0]==='application/x-www-form-urlencoded'){const form=new URLSearchParams(body);if([...form.keys()].some(key=>form.getAll(key).length!==1))throw new Error('Invalid account request.');return actionSchema.parse(Object.fromEntries(form));}if(request.headers['content-type']?.split(';')[0]!=='application/json')throw new Error('Invalid account request.');return actionSchema.parse(JSON.parse(body));}
export function createAuthHandler(options:AuthHostOptions){
 const origin=new URL(options.origin);if(origin.origin!==options.origin||origin.username||origin.password)throw new Error('Use the exact public Canoli origin.');
 const secure=origin.protocol==='https:';if(!secure&&!(options.allowInsecureLoopback&&origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))throw new Error('Account sessions require HTTPS; insecure loopback must be explicitly enabled for development.');
 if(options.identity.config.redirectUri!==origin.origin+'/auth/openai/callback')throw new Error('The registered callback must match this Canoli origin.');
 const name=secure?'__Host-canoli-session':'canoli_loopback_session';
 const setCookie=(response:ServerResponse,value:string,maxAge:number)=>response.setHeader('Set-Cookie',name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(secure?'; Secure':''));
 const issue=(response:ServerResponse,next:{token:string;session:BrowserSession})=>setCookie(response,next.token,Math.max(0,Math.floor((next.session.expires-Date.now())/1000)));
 const send=(response:ServerResponse,status:number,value:unknown)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
 const finish=(response:ServerResponse,ok:boolean)=>{
  const nonce=randomBytes(18).toString('base64url');response.writeHead(ok?200:400,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  response.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Canoli Studio account</title><style nonce="'+nonce+'">body{font:16px/1.6 system-ui;max-width:36rem;margin:12vh auto;padding:24px}button{font:inherit;padding:10px 20px}</style><h1>Canoli Studio</h1><p>'+(ok?'Return to your Canoli window to finish or review your account.':'Sign-in could not be completed. Return to Canoli and try again.')+'</p><button id="close">Close this window</button><script nonce="'+nonce+'">history.replaceState(null,"","/auth/complete");document.getElementById("close").onclick=()=>window.close();if(window.opener){window.opener.postMessage({type:"canoli:account-changed"},location.origin);window.close();}</script></html>');
 };
 return async(request:IncomingMessage,response:ServerResponse):Promise<boolean>=>{
  const url=new URL(request.url??'/',origin);if(!url.pathname.startsWith('/auth/'))return false;
  response.setHeader('Cache-Control','no-store');response.setHeader('Vary','Cookie');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Frame-Options','DENY');
  if(request.headers.host!==origin.host||((request.headers['sec-fetch-site']==='cross-site')&&url.pathname!=='/auth/openai/callback')){send(response,403,{error:'Account requests must use this Canoli origin.'});return true;}
  const token=cookie(request,name),session=options.store.browser(token);
  try{
   options.store.prune();
   if(url.pathname==='/auth/session'&&request.method==='GET'){
    if(token&&!session){send(response,401,{error:'Refresh the account session and try again.'});return true;}
    const current=session??(()=>{const next=options.store.createBrowser();issue(response,next);return next.session;})();send(response,200,{configured:true,csrf:current.csrf,...options.store.view(current)});return true;
   }
   if(url.pathname==='/auth/complete'&&request.method==='GET'){finish(response,true);return true;}
   if(url.pathname==='/auth/openai/callback'&&request.method==='GET'){
    let transaction:AuthTransaction|undefined;try{
     if(!session||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length>1)throw new Error('Invalid callback.');transaction=options.store.consume(session,url.searchParams.get('state')!);
     if(url.searchParams.has('error')||!url.searchParams.get('code')||(url.searchParams.has('iss')&&url.searchParams.get('iss')!==OPENAI_ISSUER))throw new Error('Sign-in was not completed.');
     const identity=await options.identity.redeem(url.searchParams.get('code')!,transaction),accepted=options.store.accept(transaction,identity);if(accepted.rotated)issue(response,accepted.rotated);finish(response,true);
    }catch{if(transaction)options.store.fail(transaction);finish(response,false);}return true;
   }
   if(request.method!=='POST'){send(response,404,{error:'Unknown account endpoint.'});return true;}
   if(request.headers.origin!==origin.origin){send(response,403,{error:'Account requests must use this Canoli origin.'});return true;}
   if(url.pathname==='/auth/reset'){
    const current=session??(()=>{const next=options.store.createBrowser();issue(response,next);return next.session;})();send(response,200,{configured:true,csrf:current.csrf,...options.store.view(current)});return true;
   }
   if(!session){send(response,401,{error:'Refresh Account and try again.'});return true;}
   const action=await readAction(request);options.store.assertCsrf(session,action.csrf);
   if(url.pathname==='/auth/openai'){
    if(!action.intent)throw new Error('Choose whether to sign in or link an account.');const transaction=options.store.begin(session,action.intent,{state:randomToken(),verifier:randomBytes(64).toString('base64url'),nonce:randomToken()});
    try{const location=await options.identity.authorization(transaction);response.writeHead(303,{Location:location});response.end();}catch{options.store.fail(transaction);finish(response,false);}return true;
   }
   if(url.pathname==='/auth/confirm'){if(!action.pendingId)throw new Error('Choose the pending account confirmation.');issue(response,options.store.confirm(session,action.pendingId));send(response,200,{ok:true});return true;}
   if(url.pathname==='/auth/cancel'){options.store.cancel(session);send(response,200,{ok:true});return true;}
   if(url.pathname==='/auth/signout'){options.store.signOut(session);setCookie(response,'',0);send(response,200,{ok:true});return true;}
   send(response,404,{error:'Unknown account endpoint.'});return true;
  }catch{send(response,400,{error:'The account request could not be completed. Refresh Account and try again.'});return true;}
 };
}
