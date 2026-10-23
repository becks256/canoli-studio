import {DatabaseSync} from 'node:sqlite';
import {chmodSync,closeSync,existsSync,lstatSync,mkdirSync,openSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {randomToken,tokenHash,type SignInProof,type VerifiedIdentity} from './oidc';

const ANON_MS=15*60_000,SESSION_MS=8*60*60_000,ATTEMPT_MS=10*60_000,PENDING_MS=5*60_000;
export interface BrowserSession {hash:string;csrf:string;userId:string|null;generation:number;expires:number;attemptExpires:number;notice:string|null}
export interface AuthTransaction extends SignInProof {browserHash:string;generation:number;intent:'signin'|'link';userId:string|null;expires:number}
export interface Account {id:string;name:string|null;email:string|null}
export interface AccountView {user:Account|null;pending:{id:string;kind:'create'|'link';name:string|null;email:string|null;expires:number}|null;signingIn:boolean;notice:string|null}
interface PendingRow {id:string;browser_hash:string;kind:'create'|'link';identity:string;user_id:string|null;expires:number}
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
/** Private durable identity/session storage; no artwork or OpenAI access/refresh/ID tokens. */
export class AccountStore {
 private db:DatabaseSync;private closed=false;
 constructor(path:string,private readonly now=()=>Date.now()){
  if(path!==':memory:'){
   mkdirSync(dirname(path),{recursive:true,mode:0o700});if(existsSync(path)){const info=lstatSync(path);if(info.isSymbolicLink()||!info.isFile())throw new Error('Use a private regular account database file.');}else closeSync(openSync(path,'wx',0o600));chmodSync(path,0o600);
  }
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');const version=this.db.prepare('PRAGMA user_version').get()as{user_version:number};if(version.user_version>1){this.db.close();throw new Error('The account database uses a newer schema.');}
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS identities(issuer TEXT NOT NULL,client_id TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),name TEXT,email TEXT,email_verified INTEGER NOT NULL,PRIMARY KEY(issuer,client_id,subject));
   CREATE TABLE IF NOT EXISTS browsers(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,user_id TEXT REFERENCES users(id),generation INTEGER NOT NULL,expires INTEGER NOT NULL,attempt_expires INTEGER NOT NULL DEFAULT 0,notice TEXT);
   CREATE TABLE IF NOT EXISTS transactions(browser_hash TEXT PRIMARY KEY REFERENCES browsers(hash) ON DELETE CASCADE,state_hash TEXT UNIQUE NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,generation INTEGER NOT NULL,intent TEXT NOT NULL,user_id TEXT,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY,browser_hash TEXT UNIQUE NOT NULL REFERENCES browsers(hash) ON DELETE CASCADE,kind TEXT NOT NULL,identity TEXT NOT NULL,user_id TEXT,expires INTEGER NOT NULL);
   PRAGMA user_version=1;`);
 }
 private atomic<T>(run:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=run();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 private row(hash:string):BrowserSession|null{
  const row=this.db.prepare('SELECT * FROM browsers WHERE hash=? AND expires>?').get(hash,this.now())as{hash:string;csrf:string;user_id:string|null;generation:number;expires:number;attempt_expires:number;notice:string|null}|undefined;
  return row?{hash:row.hash,csrf:row.csrf,userId:row.user_id,generation:row.generation,expires:row.expires,attemptExpires:row.attempt_expires,notice:row.notice}:null;
 }
 browser(token:string|undefined){return token&&/^[A-Za-z0-9_-]{43}$/.test(token)?this.row(tokenHash(token)):null;}
 createBrowser(userId:string|null=null){const token=randomToken(),csrf=randomToken(),hash=tokenHash(token),expires=this.now()+(userId?SESSION_MS:ANON_MS);this.db.prepare('INSERT INTO browsers(hash,csrf,user_id,generation,expires)VALUES(?,?,?,0,?)').run(hash,csrf,userId,expires);return{token,session:this.row(hash)!};}
 private current(session:BrowserSession,generation=session.generation){const current=this.row(session.hash);if(!current||current.generation!==generation||current.userId!==session.userId)throw new Error('The sign-in attempt expired or was cancelled.');return current;}
 assertCsrf(session:BrowserSession,value:unknown){const current=this.current(session);if(typeof value!=='string'||!equal(value,current.csrf))throw new Error('Refresh Account and try again.');}
 view(session:BrowserSession):AccountView{
  const current=this.current(session),user=current.userId?this.db.prepare('SELECT id,name,email FROM users WHERE id=?').get(current.userId)as unknown as Account:null,pending=this.db.prepare('SELECT * FROM pending WHERE browser_hash=? AND expires>?').get(session.hash,this.now())as unknown as PendingRow|undefined;
  return{user,pending:pending?{id:pending.id,kind:pending.kind,name:(JSON.parse(pending.identity)as VerifiedIdentity).name,email:(JSON.parse(pending.identity)as VerifiedIdentity).email,expires:pending.expires}:null,signingIn:current.attemptExpires>this.now(),notice:current.notice};
 }
 begin(session:BrowserSession,intent:'signin'|'link',proof:SignInProof):AuthTransaction{return this.atomic(()=>{
  const current=this.current(session);if((intent==='link')!==!!current.userId)throw new Error('Use the sign-in action for the current account state.');const generation=current.generation+1,expires=this.now()+ATTEMPT_MS;
  this.db.prepare('DELETE FROM transactions WHERE browser_hash=?').run(session.hash);this.db.prepare('DELETE FROM pending WHERE browser_hash=?').run(session.hash);
  this.db.prepare('UPDATE browsers SET generation=?,attempt_expires=?,notice=NULL WHERE hash=?').run(generation,expires,session.hash);
  this.db.prepare('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?)').run(session.hash,tokenHash(proof.state),proof.verifier,proof.nonce,generation,intent,current.userId,expires);
  return{...proof,browserHash:session.hash,generation,intent,userId:current.userId,expires};
 });}
 consume(session:BrowserSession,state:string):AuthTransaction{
  const row=this.atomic(()=>this.db.prepare('DELETE FROM transactions WHERE browser_hash=? AND state_hash=? RETURNING *').get(session.hash,tokenHash(state)))as{verifier:string;nonce:string;generation:number;intent:'signin'|'link';user_id:string|null;expires:number}|undefined;
  if(!row||row.expires<=this.now())throw new Error('The sign-in callback could not be verified.');this.current(session,row.generation);
  return{state,verifier:row.verifier,nonce:row.nonce,browserHash:session.hash,generation:row.generation,intent:row.intent,userId:row.user_id,expires:row.expires};
 }
 private rotate(session:BrowserSession,userId:string){const next=this.createBrowser(userId);this.db.prepare('DELETE FROM browsers WHERE hash=?').run(session.hash);return next;}
 accept(transaction:AuthTransaction,identity:VerifiedIdentity){return this.atomic(()=>{
  const session=this.row(transaction.browserHash);if(!session||session.generation!==transaction.generation||session.userId!==transaction.userId||transaction.expires<=this.now())throw new Error('The sign-in attempt expired or was cancelled.');
  const linked=this.db.prepare('SELECT user_id FROM identities WHERE issuer=? AND client_id=? AND subject=?').get(identity.issuer,identity.clientId,identity.subject)as{user_id:string}|undefined;
  if(linked){if(transaction.intent==='link'&&linked.user_id!==session.userId)throw new Error('This sign-in method cannot be linked to the current account.');return{rotated:this.rotate(session,linked.user_id)};}
  this.db.prepare('INSERT INTO pending VALUES(?,?,?,?,?,?)').run(randomToken(),session.hash,transaction.intent==='link'?'link':'create',JSON.stringify(identity),session.userId,this.now()+PENDING_MS);this.db.prepare('UPDATE browsers SET attempt_expires=0,notice=NULL WHERE hash=?').run(session.hash);return{rotated:null};
 });}
 confirm(session:BrowserSession,id:string){return this.atomic(()=>{
  const current=this.current(session),pending=this.db.prepare('SELECT * FROM pending WHERE id=? AND browser_hash=? AND expires>?').get(id,session.hash,this.now())as unknown as PendingRow|undefined;if(!pending||pending.user_id!==current.userId)throw new Error('The account confirmation expired. Sign in again.');
  const identity=JSON.parse(pending.identity)as VerifiedIdentity,existing=this.db.prepare('SELECT user_id FROM identities WHERE issuer=? AND client_id=? AND subject=?').get(identity.issuer,identity.clientId,identity.subject)as{user_id:string}|undefined;
  let userId=current.userId;
  if(existing){if(pending.kind==='link'&&existing.user_id!==userId)throw new Error('This sign-in method cannot be linked to the current account.');userId=existing.user_id;}
  else{
   if(pending.kind==='create'){if(userId)throw new Error('Refresh Account and try again.');userId=randomUUID();this.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(userId,identity.name,identity.email,this.now());}
   if(!userId)throw new Error('Sign in to the existing Canoli account before linking.');
   this.db.prepare('INSERT INTO identities VALUES(?,?,?,?,?,?,?)').run(identity.issuer,identity.clientId,identity.subject,userId,identity.name,identity.email,Number(identity.emailVerified));
  }
  return this.rotate(current,userId!);
 });}
 cancel(session:BrowserSession){this.atomic(()=>{this.current(session);this.db.prepare('DELETE FROM transactions WHERE browser_hash=?').run(session.hash);this.db.prepare('DELETE FROM pending WHERE browser_hash=?').run(session.hash);this.db.prepare('UPDATE browsers SET generation=generation+1,attempt_expires=0,notice=NULL WHERE hash=?').run(session.hash);});}
 fail(transaction:AuthTransaction){this.db.prepare("UPDATE browsers SET attempt_expires=0,notice='Sign-in could not be completed. Try again.' WHERE hash=? AND generation=?").run(transaction.browserHash,transaction.generation);}
 signOut(session:BrowserSession){this.db.prepare('DELETE FROM browsers WHERE hash=?').run(session.hash);}
 prune(){this.atomic(()=>{this.db.prepare('DELETE FROM browsers WHERE expires<=?').run(this.now());this.db.prepare('DELETE FROM transactions WHERE expires<=?').run(this.now());this.db.prepare('DELETE FROM pending WHERE expires<=?').run(this.now());});}
 close(){if(this.closed)return;this.closed=true;this.db.close();}
}
