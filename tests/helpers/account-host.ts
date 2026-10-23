import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {AccountStore} from '../../server/auth/store';
import {OpenAiIdentityClient} from '../../server/auth/oidc';
import {createSiteHandler} from '../../server/site/app';
import {signedIdentityProvider} from './identity-provider';
export async function accountHost(directory=resolve('dist'),options:{configured?:boolean;publicOrigin?:string}={}){
 const temporary=mkdtempSync(join(tmpdir(),'canoli-account-host-')),database=join(temporary,'accounts.sqlite'),provider=await signedIdentityProvider(),store=new AccountStore(database);let handler:(request:IncomingMessage,response:ServerResponse)=>Promise<void>=async(_request,response)=>{response.writeHead(503);response.end();};
 const server=createServer((request,response)=>{void handler(request,response);});await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw new Error('No account test address.');const origin='http://127.0.0.1:'+address.port,publicOrigin=options.publicOrigin??origin,identity=new OpenAiIdentityClient({clientId:'oaiapp_canoli_test',redirectUri:publicOrigin+'/auth/openai/callback',tokenAuthMethod:'none'},provider.transport);
 handler=createSiteHandler({origin:publicOrigin,directory,auth:options.configured===false?undefined:{origin:publicOrigin,store,identity,allowInsecureLoopback:true}});
 return{origin,publicOrigin,server,store,provider,identity,database,async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();rmSync(temporary,{recursive:true,force:true});}};
}
