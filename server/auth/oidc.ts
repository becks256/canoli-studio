import {createHash,randomBytes} from 'node:crypto';
import {createRemoteJWKSet,customFetch,jwtVerify,type RemoteJWKSet} from 'jose';
import {z} from 'zod';

export const OPENAI_ISSUER='https://auth.openai.com';
export const randomToken=()=>randomBytes(32).toString('base64url');
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export const pkceChallenge=(verifier:string)=>createHash('sha256').update(verifier).digest('base64url');
export interface OpenAiClientConfig {clientId:string;redirectUri:string;tokenAuthMethod:'none'|'client_secret_basic';clientSecret?:string}
export interface VerifiedIdentity {issuer:string;clientId:string;subject:string;name:string|null;email:string|null;emailVerified:boolean}
export interface SignInProof {state:string;verifier:string;nonce:string}
const discoverySchema=z.object({issuer:z.literal(OPENAI_ISSUER),authorization_endpoint:z.string().url(),token_endpoint:z.string().url(),jwks_uri:z.string().url(),token_endpoint_auth_methods_supported:z.array(z.string()).optional(),id_token_signing_alg_values_supported:z.array(z.string()).min(1)});
const identitySchema=z.object({sub:z.string().min(1).max(512),nonce:z.string(),name:z.string().max(1024).optional(),email:z.string().max(320).optional(),email_verified:z.boolean().optional()});
async function limitedJson(response:Response,limit=128_000):Promise<unknown>{
 if(!response.ok||!/^application\/(?:json|[\w.-]+\+json)(?:;|$)/i.test(response.headers.get('content-type')??'')||!response.body)throw new Error('OpenAI sign-in could not be completed.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw new Error('OpenAI sign-in returned invalid metadata.');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
/** Identity-only OpenAI contract. A trusted transport override exists for signed provider fixtures. */
export class OpenAiIdentityClient {
 private discovery?:Promise<z.infer<typeof discoverySchema>>;private expires=0;private keys?:RemoteJWKSet;private keysUrl?:string;
 constructor(readonly config:OpenAiClientConfig,private readonly transport:typeof fetch=fetch){
  if(!/^[A-Za-z0-9_-]{8,256}$/.test(config.clientId))throw new Error('Configure the registered OpenAI client ID.');
  const uri=new URL(config.redirectUri);if(uri.pathname!=='/auth/openai/callback'||uri.search||uri.hash||uri.username||uri.password)throw new Error('Use the exact registered /auth/openai/callback URL.');
  if(config.tokenAuthMethod==='client_secret_basic'&&!config.clientSecret)throw new Error('The confidential OpenAI client requires its server-side client secret.');
  if(config.tokenAuthMethod==='none'&&config.clientSecret)throw new Error('A public OpenAI client must not be configured with a client secret.');
 }
 private async json(url:string,init:RequestInit={}){const response=await this.transport(url,{...init,redirect:'error',signal:AbortSignal.timeout(10_000)});return limitedJson(response);}
 private async metadata(){
  if(!this.discovery||Date.now()>=this.expires){this.expires=Date.now()+3_600_000;this.discovery=this.json(OPENAI_ISSUER+'/.well-known/openid-configuration').then(value=>{const data=discoverySchema.parse(value);for(const key of ['authorization_endpoint','token_endpoint','jwks_uri']as const){const url=new URL(data[key]);if(url.origin!==OPENAI_ISSUER||url.search||url.hash||url.username||url.password)throw new Error('OpenAI identity discovery was invalid.');}if(!data.id_token_signing_alg_values_supported.some(alg=>alg==='RS256'||alg==='ES256'))throw new Error('OpenAI identity signing algorithms were invalid.');if(data.token_endpoint_auth_methods_supported&&!data.token_endpoint_auth_methods_supported.includes(this.config.tokenAuthMethod))throw new Error('The registered OpenAI token authentication method is unavailable.');return data;}).catch(error=>{this.discovery=undefined;throw error;});}
  return this.discovery;
 }
 async authorization(proof:SignInProof){const data=await this.metadata(),url=new URL(data.authorization_endpoint);url.search=new URLSearchParams({client_id:this.config.clientId,redirect_uri:this.config.redirectUri,response_type:'code',scope:'openid profile email',state:proof.state,code_challenge:pkceChallenge(proof.verifier),code_challenge_method:'S256',nonce:proof.nonce}).toString();return url.href;}
 async redeem(code:string,proof:SignInProof):Promise<VerifiedIdentity>{
  const data=await this.metadata(),headers:Record<string,string>={accept:'application/json','content-type':'application/x-www-form-urlencoded'};
  if(this.config.tokenAuthMethod==='client_secret_basic'){const encode=(value:string)=>new URLSearchParams({value}).toString().slice(6);headers.authorization='Basic '+Buffer.from(encode(this.config.clientId)+':'+encode(this.config.clientSecret!)).toString('base64');}
  const tokens=z.object({id_token:z.string().min(1).max(128_000)}).parse(await this.json(data.token_endpoint,{method:'POST',headers,body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:this.config.redirectUri,client_id:this.config.clientId,code_verifier:proof.verifier})}));
  if(this.keysUrl!==data.jwks_uri){this.keys=undefined;this.keysUrl=data.jwks_uri;}
  this.keys??=createRemoteJWKSet(new URL(data.jwks_uri),{timeoutDuration:10_000,cacheMaxAge:600_000,cooldownDuration:30_000,[customFetch]:async(url,options)=>{const value=await limitedJson(await this.transport(url,{...options,redirect:'error'}));return Response.json(value);}});
  const verify=()=>jwtVerify(tokens.id_token,this.keys!,{issuer:OPENAI_ISSUER,audience:this.config.clientId,algorithms:data.id_token_signing_alg_values_supported.filter(alg=>alg==='RS256'||alg==='ES256'),requiredClaims:['sub','exp','iat','nonce'],clockTolerance:5,maxTokenAge:'10m'});
  let verified;try{verified=await verify();}catch(error){if((error as{code?:string}).code!=='ERR_JWKS_NO_MATCHING_KEY')throw error;await this.keys.reload();verified=await verify();}
  const payload=verified.payload,identity=identitySchema.parse(payload);if(identity.nonce!==proof.nonce||(payload.azp!==undefined&&payload.azp!==this.config.clientId)||(Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==this.config.clientId))throw new Error('OpenAI sign-in identity could not be verified.');
  return{issuer:OPENAI_ISSUER,clientId:this.config.clientId,subject:identity.sub,name:identity.name??null,email:identity.email??null,emailVerified:identity.email_verified===true};
 }
}
