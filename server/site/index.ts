import {resolve,sep} from 'node:path';
import {createSiteServer} from './app';
import {AccountStore} from '../auth/store';
import {OpenAiIdentityClient} from '../auth/oidc';

const port=Number(process.env.CANOLI_SITE_PORT??8788);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('CANOLI_SITE_PORT must be a valid TCP port.');
const origin=process.env.CANOLI_AUTH_ORIGIN??'http://127.0.0.1:'+port,directory=resolve('dist'),clientId=process.env.CANOLI_AUTH_CLIENT_ID,secret=process.env.CANOLI_AUTH_CLIENT_SECRET,method=process.env.CANOLI_AUTH_TOKEN_AUTH_METHOD??'none';
if(method!=='none'&&method!=='client_secret_basic')throw new Error('CANOLI_AUTH_TOKEN_AUTH_METHOD must match the registered client method.');
if(!clientId&&(secret||process.env.CANOLI_AUTH_REDIRECT_URI))throw new Error('Complete the registered OpenAI client configuration before starting sign-in.');
let store:AccountStore|undefined;
const auth=clientId?(()=>{if(!process.env.CANOLI_AUTH_ORIGIN||!process.env.CANOLI_AUTH_REDIRECT_URI)throw new Error('Configure the registered site origin and callback URL.');const path=resolve(process.env.CANOLI_AUTH_DATABASE??'.canoli/accounts.sqlite');if(path===directory||path.startsWith(directory+sep))throw new Error('Keep the private account database outside the served directory.');store=new AccountStore(path);return{origin,store,identity:new OpenAiIdentityClient({clientId,redirectUri:process.env.CANOLI_AUTH_REDIRECT_URI,tokenAuthMethod:method,clientSecret:secret}),allowInsecureLoopback:process.env.NODE_ENV!=='production'&&process.env.CANOLI_AUTH_ALLOW_INSECURE_LOOPBACK==='1'};})():undefined;
const server=createSiteServer({origin,directory,auth});server.listen(port,'127.0.0.1',()=>console.log('Canoli Studio site: '+origin+(auth?' (identity sign-in configured)':' (local editing; sign-in unconfigured)')));server.on('error',()=>{console.error('Canoli Studio site could not start.');store?.close();process.exitCode=1;});
const close=()=>{server.close(()=>{store?.close();});};process.once('SIGINT',close);process.once('SIGTERM',close);
