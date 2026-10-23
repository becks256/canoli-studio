import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {boundedJson,connectedDocumentSchema,connectionPermissionsSchema,operationResultSchema,operationSchema,isReadOperation,failure,type BridgeEvent,type ConnectedDocument,type ConnectionOperation,type ConnectionPermissions,type ConnectionResult} from '../../src/integrations/chatgpt/protocol';

interface Pending {
 id:string;operation:ConnectionOperation;state:'queued'|'delivered'|'committing'|'done'|'cancelled'|'unknown';result?:ConnectionResult;
 promise:Promise<ConnectionResult>;resolve(value:ConnectionResult):void;cleanup():void;
}
interface Connection {
 id:string;origin:string;ownerHash:Buffer;document:ConnectedDocument;permissions:ConnectionPermissions;seen:number;
 events:Exclude<BridgeEvent,{kind:'heartbeat'}>[];waiter?:{resolve(event:BridgeEvent):void;cleanup():void};pending:Map<string,Pending>;receipts:Map<string,{signature:string;pending:Pending}>;
}
const token=()=>randomBytes(32).toString('hex'),hash=(value:string)=>createHash('sha256').update(value).digest();
function signature(value:unknown):string{
 boundedJson(value);const canonical=(input:unknown):unknown=>Array.isArray(input)?input.map(canonical):input&&typeof input==='object'?Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,canonical(value)])):input;
 return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export class ChatGptHub {
 private pairings=new Map<string,{deadline:number;connectionId?:string}>();private connections=new Map<string,Connection>();private disposed=false;
 constructor(private readonly now=()=>Date.now()){}
 beginPairing(origin:string){
  this.assertOpen();this.prune();if(this.pairings.size>=16)throw new Error('Too many pending connection requests. Wait for an unused code to expire.');
  const code=token(),expiresAt=this.now()+120_000;this.pairings.set(code,{deadline:expiresAt});return{connectionCode:origin+'/#canoli='+code,expiresAt};
 }
 pair(code:string,origin:string,document:ConnectedDocument,permissions:ConnectionPermissions){
  this.assertOpen();this.prune();const pairing=this.pairings.get(code);if(!pairing||pairing.deadline<=this.now()||pairing.connectionId)throw new Error('The connection code expired or was already used. Request a new code in ChatGPT.');
  const parsedDocument=connectedDocumentSchema.parse(document),parsedPermissions=connectionPermissionsSchema.parse(permissions);
  if(this.connections.size>=32)throw new Error('Disconnect an existing document before adding another.');
  const id=randomUUID(),owner=token();pairing.connectionId=id;this.connections.set(id,{id,origin,ownerHash:hash(owner),document:parsedDocument,permissions:parsedPermissions,seen:this.now(),events:[],pending:new Map(),receipts:new Map()});
  return{id,owner,permissions:parsedPermissions};
 }
 cancelPairing(code:string,origin:string){const pairing=this.pairings.get(code);if(!pairing)return;if(pairing.connectionId){const connection=this.connections.get(pairing.connectionId);if(connection&&connection.origin!==origin)throw new Error('The pairing origin does not match.');this.disconnect(pairing.connectionId);}this.pairings.delete(code);}
 list(){this.assertOpen();this.prune();return [...this.connections.values()].map(({id,document,permissions})=>({connectionId:id,document:{...document},permissions:{...permissions}}));}
 authenticate(id:string,owner:string,origin:string){
  this.assertOpen();this.prune();const connection=this.connections.get(id),provided=hash(owner);
  if(!connection||connection.origin!==origin||!timingSafeEqual(provided,connection.ownerHash))throw new Error('The local document connection is unavailable or unauthorized.');return connection;
 }
 async next(id:string,owner:string,origin:string,signal?:AbortSignal):Promise<BridgeEvent>{
  const connection=this.authenticate(id,owner,origin);connection.seen=this.now();signal?.throwIfAborted();
  if(connection.waiter)throw new Error('A document connection can have only one pending poll.');
  const next=this.take(connection);if(next)return next;
  return new Promise<BridgeEvent>((resolve,reject)=>{
   const timeout=setTimeout(()=>finish({kind:'heartbeat'}),10_000),abort=()=>{cleanup();connection.waiter=undefined;reject(signal?.reason??new Error('Poll cancelled.'));};
   const cleanup=()=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);},finish=(event:BridgeEvent)=>{cleanup();connection.waiter=undefined;resolve(event);};
   connection.waiter={resolve:finish,cleanup};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
 }
 private take(connection:Connection):BridgeEvent|undefined{
  const index=connection.events.findIndex(event=>event.kind==='cancel'||event.kind==='request'&&![...connection.pending.values()].some(p=>p.state==='delivered'||p.state==='committing'));
  if(index<0)return;const event=connection.events.splice(index,1)[0];if(event.kind==='request'){const pending=connection.pending.get(event.id);if(!pending||pending.state!=='queued')return this.take(connection);pending.state='delivered';}return event;
 }
 private wake(connection:Connection){if(connection.waiter){const event=this.take(connection);if(event)connection.waiter.resolve(event);}}
 async call(id:string,input:unknown,signal?:AbortSignal):Promise<ConnectionResult>{
  this.assertOpen();this.prune();boundedJson(input);const operation=operationSchema.parse(input),connection=this.connections.get(id);
  if(!connection)return failure('DISCONNECTED','Choose a currently connected document.');
  if(!isReadOperation(operation)&&!connection.permissions.write)return failure('PERMISSION_DENIED','This document connection is read-only. Enable editing in Canoli through a new connection.');
  signal?.throwIfAborted();
  let key:string|undefined,bodySignature='';
  if(!isReadOperation(operation)){
   key=operation.idempotencyKey;bodySignature=signature(operation);const prior=connection.receipts.get(key);
   if(prior){if(prior.signature!==bodySignature)return failure('INVALID_REQUEST','An idempotency key cannot be reused for different edits.');return prior.pending.result??prior.pending.promise;}
   if(connection.receipts.size>=256)return failure('INVALID_REQUEST','This connection has retained 256 edit receipts. Reconnect before submitting new edits; previous edits will not be replayed.');
  }
  if([...connection.pending.values()].filter(p=>p.state==='queued'||p.state==='delivered'||p.state==='committing').length>=16)return failure('INVALID_REQUEST','The document connection queue is busy. Wait for current work to finish.');
  if(connection.pending.size>=512)return failure('INVALID_REQUEST','Too many requests have not been acknowledged. Reconnect explicitly before submitting new work.');
  const requestId=randomUUID();let resolve!:(value:ConnectionResult)=>void;const promise=new Promise<ConnectionResult>(done=>{resolve=done;});
  const pending:Pending={id:requestId,operation,state:'queued',promise,resolve,cleanup:()=>{}};
  const finish=(result:ConnectionResult,state:Pending['state'])=>{pending.state=state;pending.result=result;pending.cleanup();pending.resolve(result);this.wake(connection);};
  const cancel=()=>{
   // Commit authorization is the point after which cancellation cannot promise
   // rollback. Preserve the receipt so a retry can learn the accepted outcome.
   if(pending.state==='committing')return;
   if(pending.state!=='queued'&&pending.state!=='delivered')return;
   const delivered=pending.state==='delivered';finish(failure('CANCELLED','The request was cancelled before commit authorization.'),'cancelled');
   connection.events=connection.events.filter(event=>event.id!==requestId);if(delivered)connection.events.unshift({kind:'cancel',id:requestId});this.wake(connection);
   if(!key&&!delivered)connection.pending.delete(requestId);
  };
  const timeout=setTimeout(()=>{if(pending.state==='committing')finish(failure('OUTCOME_UNKNOWN','The commit acknowledgement was lost. Inspect the document and retry the same idempotency key; do not resubmit with a new key.'),'unknown');else cancel();},30_000);
  pending.cleanup=()=>{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);};signal?.addEventListener('abort',cancel,{once:true});
  connection.pending.set(requestId,pending);if(key)connection.receipts.set(key,{signature:bodySignature,pending});connection.events.push({kind:'request',id:requestId,operation});if(signal?.aborted)cancel();this.wake(connection);return promise;
 }
 authorize(id:string,owner:string,origin:string,requestId:string){
  const connection=this.authenticate(id,owner,origin),pending=connection.pending.get(requestId);
  if(!pending||pending.state!=='delivered')throw new Error('The request is no longer authorized.');
  if(isReadOperation(pending.operation)||!connection.permissions.write)throw new Error('This connection does not authorize the edit.');pending.state='committing';return{authorized:true};
 }
 complete(id:string,owner:string,origin:string,requestId:string,input:unknown,document:ConnectedDocument){
  const connection=this.authenticate(id,owner,origin),pending=connection.pending.get(requestId);boundedJson(input);const result=operationResultSchema.parse(input),summary=connectedDocumentSchema.parse(document);
  if(!pending)throw new Error('Unknown connection request.');
  if(pending.state==='cancelled'||pending.state==='done'){if(isReadOperation(pending.operation))connection.pending.delete(requestId);return;}
  if(result.ok&&!isReadOperation(pending.operation)&&pending.state!=='committing'&&pending.state!=='unknown')throw new Error('An edit requires commit authorization before acknowledgement.');
  if(summary.id!==connection.document.id)throw new Error('The document connection cannot change its target.');connection.document=summary;pending.state='done';pending.result=result;pending.cleanup();pending.resolve(result);if(isReadOperation(pending.operation))connection.pending.delete(requestId);this.wake(connection);
 }
 disconnectOwner(id:string,owner:string,origin:string){this.authenticate(id,owner,origin);this.disconnect(id);}
 disconnect(id:string){
  const connection=this.connections.get(id);if(!connection)return;this.connections.delete(id);connection.waiter?.resolve({kind:'heartbeat'});
  for(const pending of connection.pending.values()){pending.cleanup();pending.result=failure('DISCONNECTED','The document connection was closed. Inspect accepted artwork before retrying edits through a new connection.');pending.resolve(pending.result);}
 }
 prune(){const now=this.now();for(const[key,pairing]of this.pairings)if(pairing.deadline<=now)this.pairings.delete(key);for(const[id,connection]of this.connections)if(now-connection.seen>45_000)this.disconnect(id);}
 private assertOpen(){if(this.disposed)throw new Error('The local ChatGPT bridge is closed.');}
 dispose(){if(this.disposed)return;this.disposed=true;this.pairings.clear();for(const id of this.connections.keys())this.disconnect(id);}
}
