import {generateKeyPair,exportJWK,SignJWT,type CryptoKey} from 'jose';
import {randomUUID,createHash} from 'node:crypto';
import {OPENAI_ISSUER} from '../../server/auth/oidc';

export interface FixtureIdentity {subject:string;name?:string;email?:string}
/** Signed test issuer transport. It is not an OpenAI account or a live-provider acceptance test. */
export async function signedIdentityProvider(){
 let pair=await generateKeyPair('RS256'),kid=randomUUID(),signingKey:CryptoKey=pair.privateKey;const codes=new Map<string,{nonce:string;challenge:string;redirect:string;identity:FixtureIdentity}>(),requests:{path:string;method:string;authorization:string|null;form:Record<string,string>}[]=[];
 let corruption:Record<string,unknown>={},wrongSignature=false,hold:Promise<void>|undefined,entered:()=>void=()=>{},lastToken='',discoveryOverrides:Record<string,unknown>={};
 const grant=(authorization:URL,identity:FixtureIdentity={subject:'first-user',name:'Ada Artist',email:'ada@example.test'})=>{
  if(authorization.origin!==OPENAI_ISSUER||authorization.searchParams.get('code_challenge_method')!=='S256'||authorization.searchParams.get('scope')!=='openid profile email')throw new Error('Invalid fixture authorization.');
  const code=randomUUID();codes.set(code,{nonce:authorization.searchParams.get('nonce')!,challenge:authorization.searchParams.get('code_challenge')!,redirect:authorization.searchParams.get('redirect_uri')!,identity});const callback=new URL(authorization.searchParams.get('redirect_uri')!);callback.search=new URLSearchParams({code,state:authorization.searchParams.get('state')!}).toString();return callback;
 };
 const transport:typeof fetch=async(input,init={})=>{
  const url=new URL(String(input)),headers=new Headers(init.headers),form=Object.fromEntries(new URLSearchParams(String(init.body??'')));requests.push({path:url.pathname,method:init.method??'GET',authorization:headers.get('authorization'),form});
  if(url.origin!==OPENAI_ISSUER)throw new Error('Only the official issuer URL is expected by this fixture.');
  if(url.pathname==='/.well-known/openid-configuration')return Response.json({issuer:OPENAI_ISSUER,authorization_endpoint:OPENAI_ISSUER+'/api/accounts/authorize',token_endpoint:OPENAI_ISSUER+'/api/accounts/oauth/token',jwks_uri:OPENAI_ISSUER+'/.well-known/jwks.json',id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['none','client_secret_basic'],...discoveryOverrides});
  if(url.pathname==='/.well-known/jwks.json')return Response.json({keys:[{...await exportJWK(pair.publicKey),kid,alg:'RS256',use:'sig'}]});
  if(url.pathname==='/api/accounts/oauth/token'){
   const code=codes.get(form.code);codes.delete(form.code);if(!code||form.redirect_uri!==code.redirect||createHash('sha256').update(form.code_verifier??'').digest('base64url')!==code.challenge)return Response.json({error:'invalid_grant'},{status:400});entered();await hold;
   const now=Math.floor(Date.now()/1000);lastToken=await new SignJWT({sub:code.identity.subject,nonce:code.nonce,name:code.identity.name,email:code.identity.email,email_verified:true,...corruption}).setProtectedHeader({alg:'RS256',kid}).setIssuer(String(corruption.iss??OPENAI_ISSUER)).setAudience(corruption.aud as string??form.client_id).setIssuedAt(Number(corruption.iat??now)).setExpirationTime(Number(corruption.exp??now+300)).sign(wrongSignature?(await generateKeyPair('RS256')).privateKey:signingKey);return Response.json({id_token:lastToken});
  }
  throw new Error('Unexpected issuer endpoint.');
 };
 return{transport,grant,requests,get lastToken(){return lastToken;},set corruption(value:Record<string,unknown>){corruption=value;},set wrongSignature(value:boolean){wrongSignature=value;},set discoveryOverrides(value:Record<string,unknown>){discoveryOverrides=value;},holdToken(){let release!:()=>void,started!:()=>void;hold=new Promise<void>(resolve=>{release=resolve;});const entering=new Promise<void>(resolve=>{started=resolve;});entered=started;return{entering,release:()=>{release();hold=undefined;entered=()=>{};}};},async rotateKey(){pair=await generateKeyPair('RS256');signingKey=pair.privateKey;kid=randomUUID();}};
}
