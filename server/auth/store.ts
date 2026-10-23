import {DatabaseSync} from 'node:sqlite';
import {chmodSync,closeSync,existsSync,lstatSync,mkdirSync,openSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {randomToken,tokenHash,type SignInProof,type VerifiedIdentity} from './oidc';
import {accountExportSchema,type AccountExport} from '../../src/account/protocol';

const ANON_MS=15*60_000,SESSION_MS=8*60*60_000,ATTEMPT_MS=10*60_000,PENDING_MS=5*60_000,VERIFICATION_MS=5*60_000;
export type AccountIntent='signin'|'link'|'reauthenticate';
export interface BrowserSession {hash:string;csrf:string;userId:string|null;generation:number;expires:number;attemptExpires:number;notice:string|null;authenticatedAt:number}
export interface AuthTransaction extends SignInProof {browserHash:string;generation:number;intent:AccountIntent;userId:string|null;expires:number;sequence:number}
export interface Account {id:string;name:string|null;email:string|null}
export interface AccountView {user:Account|null;pending:{id:string;kind:'create'|'link';name:string|null;email:string|null;expires:number}|null;signingIn:boolean;notice:string|null;verificationExpiresIn:number}
interface PendingRow {id:string;browser_hash:string;kind:'create'|'link';identity:string;user_id:string|null;expires:number;attempt_seq:number;identity_hash:string}
export class AccountVerificationRequired extends Error {constructor(){super('Verify your current ChatGPT sign-in before continuing.');}}
const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const identityHash=(identity:VerifiedIdentity)=>tokenHash(JSON.stringify([identity.issuer,identity.clientId,identity.subject]));
/** Private durable identity/session storage; no artwork or OpenAI access/refresh/ID tokens. */
export class AccountStore {
 private db:DatabaseSync;private closed=false;
 constructor(path:string,private readonly now=()=>Date.now()){
  if(path!==':memory:'){
   mkdirSync(dirname(path),{recursive:true,mode:0o700});if(existsSync(path)){const info=lstatSync(path);if(info.isSymbolicLink()||!info.isFile())throw new Error('Use a private regular account database file.');}else closeSync(openSync(path,'wx',0o600));chmodSync(path,0o600);
  }
  this.db=new DatabaseSync(path);
  try{
   this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
   if((this.db.prepare('PRAGMA user_version').get()as{user_version:number}).user_version>2)throw new Error('The account database uses a newer schema.');
   this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
   this.atomic(()=>{
    const version=this.db.prepare('PRAGMA user_version').get()as{user_version:number};if(version.user_version>2)throw new Error('The account database uses a newer schema.');
    this.db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT,created INTEGER NOT NULL);
     CREATE TABLE IF NOT EXISTS identities(issuer TEXT NOT NULL,client_id TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),name TEXT,email TEXT,email_verified INTEGER NOT NULL,PRIMARY KEY(issuer,client_id,subject));
     CREATE TABLE IF NOT EXISTS browsers(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,user_id TEXT REFERENCES users(id),generation INTEGER NOT NULL,expires INTEGER NOT NULL,attempt_expires INTEGER NOT NULL DEFAULT 0,notice TEXT,auth_at INTEGER NOT NULL DEFAULT 0);
     CREATE TABLE IF NOT EXISTS transactions(browser_hash TEXT PRIMARY KEY REFERENCES browsers(hash) ON DELETE CASCADE,state_hash TEXT UNIQUE NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,generation INTEGER NOT NULL,intent TEXT NOT NULL,user_id TEXT,expires INTEGER NOT NULL,attempt_seq INTEGER NOT NULL DEFAULT 0);
     CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY,browser_hash TEXT UNIQUE NOT NULL REFERENCES browsers(hash) ON DELETE CASCADE,kind TEXT NOT NULL,identity TEXT NOT NULL,user_id TEXT,expires INTEGER NOT NULL,attempt_seq INTEGER NOT NULL DEFAULT 0,identity_hash TEXT NOT NULL DEFAULT '');
     CREATE TABLE IF NOT EXISTS authority_clock(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL);
     INSERT OR IGNORE INTO authority_clock VALUES(1,0);
     CREATE TABLE IF NOT EXISTS deleted_identities(identity_hash TEXT PRIMARY KEY,deleted_epoch INTEGER NOT NULL,expires INTEGER NOT NULL);`);
    for(const[table,column,definition]of[['browsers','auth_at','INTEGER NOT NULL DEFAULT 0'],['transactions','attempt_seq','INTEGER NOT NULL DEFAULT 0'],['pending','attempt_seq','INTEGER NOT NULL DEFAULT 0'],['pending','identity_hash',"TEXT NOT NULL DEFAULT ''"]]){
     const fields=this.db.prepare('PRAGMA table_info('+table+')').all()as{name:string}[];if(!fields.some(field=>field.name===column))this.db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+definition);
    }
    const pending=this.db.prepare("SELECT id,identity FROM pending WHERE identity_hash=''").all()as{id:string;identity:string}[];for(const row of pending)this.db.prepare('UPDATE pending SET identity_hash=? WHERE id=?').run(identityHash(JSON.parse(row.identity)as VerifiedIdentity),row.id);
    this.db.exec('PRAGMA user_version=2;');
   });
  }catch(error){this.db.close();throw error;}
 }
 private atomic<T>(run:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=run();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 private epoch(){return(this.db.prepare('UPDATE authority_clock SET sequence=sequence+1 WHERE id=1 RETURNING sequence').get()as{sequence:number}).sequence;}
 private row(hash:string):BrowserSession|null{
  const row=this.db.prepare('SELECT * FROM browsers WHERE hash=? AND expires>?').get(hash,this.now())as{hash:string;csrf:string;user_id:string|null;generation:number;expires:number;attempt_expires:number;notice:string|null;auth_at:number}|undefined;
  return row?{hash:row.hash,csrf:row.csrf,userId:row.user_id,generation:row.generation,expires:row.expires,attemptExpires:row.attempt_expires,notice:row.notice,authenticatedAt:row.auth_at}:null;
 }
 browser(token:string|undefined){return token&&/^[A-Za-z0-9_-]{43}$/.test(token)?this.row(tokenHash(token)):null;}
 createBrowser(userId:string|null=null,authenticatedAt=userId?this.now():0){const token=randomToken(),csrf=randomToken(),hash=tokenHash(token),expires=this.now()+(userId?SESSION_MS:ANON_MS);this.db.prepare('INSERT INTO browsers(hash,csrf,user_id,generation,expires,auth_at)VALUES(?,?,?,0,?,?)').run(hash,csrf,userId,expires,authenticatedAt);return{token,session:this.row(hash)!};}
 private current(session:BrowserSession,generation=session.generation){const current=this.row(session.hash);if(!current||current.generation!==generation||current.userId!==session.userId)throw new Error('The sign-in attempt expired or was cancelled.');return current;}
 private requireRecent(session:BrowserSession){if(!session.userId||session.authenticatedAt<=0||session.authenticatedAt>this.now()||this.now()>=session.authenticatedAt+VERIFICATION_MS)throw new AccountVerificationRequired();}
 private admitIdentity(identity:VerifiedIdentity,sequence:number){const marker=this.db.prepare('SELECT deleted_epoch FROM deleted_identities WHERE identity_hash=? AND expires>?').get(identityHash(identity),this.now())as{deleted_epoch:number}|undefined;if(marker&&sequence<=marker.deleted_epoch)throw new Error('This identity attempt predates account deletion. Sign in again.');}
 assertCsrf(session:BrowserSession,value:unknown){const current=this.current(session);if(typeof value!=='string'||!equal(value,current.csrf))throw new Error('Refresh Account and try again.');}
 view(session:BrowserSession):AccountView{
  const current=this.current(session),user=current.userId?this.db.prepare('SELECT id,name,email FROM users WHERE id=?').get(current.userId)as unknown as Account:null,pending=this.db.prepare('SELECT * FROM pending WHERE browser_hash=? AND expires>?').get(session.hash,this.now())as unknown as PendingRow|undefined;
  return{user,pending:pending?{id:pending.id,kind:pending.kind,name:(JSON.parse(pending.identity)as VerifiedIdentity).name,email:(JSON.parse(pending.identity)as VerifiedIdentity).email,expires:pending.expires}:null,signingIn:current.attemptExpires>this.now(),notice:current.notice,verificationExpiresIn:current.userId&&current.authenticatedAt>0&&current.authenticatedAt<=this.now()?Math.max(0,Math.min(VERIFICATION_MS,current.authenticatedAt+VERIFICATION_MS-this.now())):0};
 }
 begin(session:BrowserSession,intent:AccountIntent,proof:SignInProof):AuthTransaction{return this.atomic(()=>{
  const current=this.current(session);if((intent!=='signin')!==!!current.userId)throw new Error('Use the sign-in action for the current account state.');if(intent==='link')this.requireRecent(current);const generation=current.generation+1,expires=this.now()+ATTEMPT_MS,sequence=this.epoch();
  this.db.prepare('DELETE FROM transactions WHERE browser_hash=?').run(session.hash);this.db.prepare('DELETE FROM pending WHERE browser_hash=?').run(session.hash);
  this.db.prepare('UPDATE browsers SET generation=?,attempt_expires=?,notice=NULL WHERE hash=?').run(generation,expires,session.hash);
  this.db.prepare('INSERT INTO transactions(browser_hash,state_hash,verifier,nonce,generation,intent,user_id,expires,attempt_seq)VALUES(?,?,?,?,?,?,?,?,?)').run(session.hash,tokenHash(proof.state),proof.verifier,proof.nonce,generation,intent,current.userId,expires,sequence);
  return{...proof,browserHash:session.hash,generation,intent,userId:current.userId,expires,sequence};
 });}
 consume(session:BrowserSession,state:string):AuthTransaction{
  const row=this.atomic(()=>this.db.prepare('DELETE FROM transactions WHERE browser_hash=? AND state_hash=? RETURNING *').get(session.hash,tokenHash(state)))as{verifier:string;nonce:string;generation:number;intent:AccountIntent;user_id:string|null;expires:number;attempt_seq:number}|undefined;
  if(!row||row.expires<=this.now())throw new Error('The sign-in callback could not be verified.');this.current(session,row.generation);
  return{state,verifier:row.verifier,nonce:row.nonce,browserHash:session.hash,generation:row.generation,intent:row.intent,userId:row.user_id,expires:row.expires,sequence:row.attempt_seq};
 }
 private rotate(session:BrowserSession,userId:string,authenticatedAt=this.now()){const next=this.createBrowser(userId,authenticatedAt);this.db.prepare('DELETE FROM browsers WHERE hash=?').run(session.hash);return next;}
 accept(transaction:AuthTransaction,identity:VerifiedIdentity){return this.atomic(()=>{
  const session=this.row(transaction.browserHash);if(!session||session.generation!==transaction.generation||session.userId!==transaction.userId||transaction.expires<=this.now())throw new Error('The sign-in attempt expired or was cancelled.');this.admitIdentity(identity,transaction.sequence);
  const linked=this.db.prepare('SELECT user_id FROM identities WHERE issuer=? AND client_id=? AND subject=?').get(identity.issuer,identity.clientId,identity.subject)as{user_id:string}|undefined;
  if(transaction.intent==='reauthenticate'){if(!linked||linked.user_id!==session.userId)throw new Error('Verify an existing sign-in method of the current account.');return{rotated:this.rotate(session,linked.user_id)};}
  if(transaction.intent==='link')this.requireRecent(session);
  if(linked){if(transaction.intent==='link'&&linked.user_id!==session.userId)throw new Error('This sign-in method cannot be linked to the current account.');return{rotated:this.rotate(session,linked.user_id)};}
  this.db.prepare('INSERT INTO pending(id,browser_hash,kind,identity,user_id,expires,attempt_seq,identity_hash)VALUES(?,?,?,?,?,?,?,?)').run(randomToken(),session.hash,transaction.intent==='link'?'link':'create',JSON.stringify(identity),session.userId,this.now()+PENDING_MS,transaction.sequence,identityHash(identity));this.db.prepare('UPDATE browsers SET attempt_expires=0,notice=NULL WHERE hash=?').run(session.hash);return{rotated:null};
 });}
 confirm(session:BrowserSession,id:string){return this.atomic(()=>{
  const current=this.current(session),pending=this.db.prepare('SELECT * FROM pending WHERE id=? AND browser_hash=? AND expires>?').get(id,session.hash,this.now())as unknown as PendingRow|undefined;if(!pending||pending.user_id!==current.userId)throw new Error('The account confirmation expired. Sign in again.');
  const identity=JSON.parse(pending.identity)as VerifiedIdentity;this.admitIdentity(identity,pending.attempt_seq);if(pending.kind==='link')this.requireRecent(current);
  const existing=this.db.prepare('SELECT user_id FROM identities WHERE issuer=? AND client_id=? AND subject=?').get(identity.issuer,identity.clientId,identity.subject)as{user_id:string}|undefined;let userId=current.userId;
  if(existing){if(pending.kind==='link'&&existing.user_id!==userId)throw new Error('This sign-in method cannot be linked to the current account.');userId=existing.user_id;}
  else{
   if(pending.kind==='create'){if(userId)throw new Error('Refresh Account and try again.');userId=randomUUID();this.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(userId,identity.name,identity.email,this.now());}
   if(!userId)throw new Error('Sign in to the existing Canoli account before linking.');this.db.prepare('INSERT INTO identities VALUES(?,?,?,?,?,?,?)').run(identity.issuer,identity.clientId,identity.subject,userId,identity.name,identity.email,Number(identity.emailVerified));
  }
  return this.rotate(current,userId!,pending.kind==='create'?pending.expires-PENDING_MS:current.authenticatedAt);
 });}
 exportAccount(session:BrowserSession):AccountExport{return this.atomic(()=>{
  const current=this.current(session);if(!current.userId)throw new Error('Sign in before exporting account data.');const user=this.db.prepare('SELECT id,name,email,created FROM users WHERE id=?').get(current.userId)as unknown as Account&{created:number};
  const identities=this.db.prepare('SELECT issuer,client_id,subject,name,email,email_verified FROM identities WHERE user_id=? ORDER BY issuer,client_id,subject').all(current.userId)as{issuer:string;client_id:string;subject:string;name:string|null;email:string|null;email_verified:number}[];
  const count=this.db.prepare('SELECT count(*) AS count FROM browsers WHERE user_id=? AND expires>?').get(current.userId,this.now())as{count:number};
  return accountExportSchema.parse({format:'canoli-account',schemaVersion:1,exportedAt:new Date(this.now()).toISOString(),account:{id:user.id,name:user.name,email:user.email,createdAt:new Date(user.created).toISOString()},identities:identities.map(row=>({provider:'openai',issuer:row.issuer,clientId:row.client_id,subject:row.subject,name:row.name,email:row.email,emailVerified:row.email_verified===1})),activeSessionCount:count.count});
 });}
 deleteAccount(session:BrowserSession,confirmation:unknown){return this.atomic(()=>{
  const current=this.current(session);this.requireRecent(current);if(confirmation!=='DELETE')throw new Error('Type DELETE to confirm account deletion.');const identities=this.db.prepare('SELECT issuer,client_id,subject FROM identities WHERE user_id=?').all(current.userId)as{issuer:string;client_id:string;subject:string}[],epoch=this.epoch();
  for(const row of identities){const hash=identityHash({issuer:row.issuer,clientId:row.client_id,subject:row.subject,name:null,email:null,emailVerified:false});this.db.prepare('INSERT INTO deleted_identities VALUES(?,?,?) ON CONFLICT(identity_hash) DO UPDATE SET deleted_epoch=excluded.deleted_epoch,expires=excluded.expires').run(hash,epoch,this.now()+ATTEMPT_MS);this.db.prepare('DELETE FROM pending WHERE identity_hash=?').run(hash);}
  this.db.prepare('DELETE FROM browsers WHERE user_id=?').run(current.userId);this.db.prepare('DELETE FROM identities WHERE user_id=?').run(current.userId);this.db.prepare('DELETE FROM users WHERE id=?').run(current.userId);
 });}
 cancel(session:BrowserSession){this.atomic(()=>{this.current(session);this.db.prepare('DELETE FROM transactions WHERE browser_hash=?').run(session.hash);this.db.prepare('DELETE FROM pending WHERE browser_hash=?').run(session.hash);this.db.prepare('UPDATE browsers SET generation=generation+1,attempt_expires=0,notice=NULL WHERE hash=?').run(session.hash);});}
 fail(transaction:AuthTransaction){this.db.prepare("UPDATE browsers SET attempt_expires=0,notice='Sign-in could not be completed. Try again.' WHERE hash=? AND generation=?").run(transaction.browserHash,transaction.generation);}
 signOut(session:BrowserSession){this.db.prepare('DELETE FROM browsers WHERE hash=?').run(session.hash);}
 prune(){this.atomic(()=>{this.db.prepare('DELETE FROM browsers WHERE expires<=?').run(this.now());this.db.prepare('DELETE FROM transactions WHERE expires<=?').run(this.now());this.db.prepare('DELETE FROM pending WHERE expires<=?').run(this.now());this.db.prepare('DELETE FROM deleted_identities WHERE expires<=?').run(this.now());});}
 close(){if(this.closed)return;this.closed=true;this.db.close();}
}
