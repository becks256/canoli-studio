import {afterEach,expect,it,vi} from 'vitest';
import {ChatGptHub} from '../server/chatgpt/hub';
import {boundedJson,parseConnectionCode} from '../src/integrations/chatgpt/protocol';
const origin='http://127.0.0.1:5173',document={id:'document-a',name:'Private artwork',revision:0,width:64,height:48};
const edit={kind:'apply' as const,expectedRevision:0,label:'Rename',commands:[{type:'document.rename',name:'Reviewed'}],idempotencyKey:'rename-once'};
const success={ok:true as const,value:{revision:1,canUndo:true,canRedo:false}};
afterEach(()=>vi.useRealTimers());
function pair(hub:ChatGptHub,write=true){const requested=hub.beginPairing('http://127.0.0.1:12345'),{code}=parseConnectionCode(requested.connectionCode);return{code,...hub.pair(code,origin,document,{read:true,write})};}
it('requires explicit one-use pairing and binds owner credentials to the chosen origin and immutable target',()=>{
 const hub=new ChatGptHub(),paired=pair(hub);try{
  expect(hub.list()).toEqual([{connectionId:paired.id,document,permissions:{read:true,write:true}}]);expect(JSON.stringify(hub.list())).not.toContain(paired.owner);
  expect(()=>hub.pair(paired.code,origin,document,{read:true,write:true})).toThrow(/already used/);expect(()=>hub.authenticate(paired.id,'0'.repeat(64),origin)).toThrow(/unauthorized/);expect(()=>hub.authenticate(paired.id,paired.owner,'https://other.invalid')).toThrow(/unauthorized/);
 }finally{hub.dispose();}
});
it('expires unused requests and disconnected browser owners without creating a new target implicitly',async()=>{
 let now=0;const hub=new ChatGptHub(()=>now),request=hub.beginPairing('http://127.0.0.1:12345');now=120001;expect(()=>hub.pair(parseConnectionCode(request.connectionCode).code,origin,document,{read:true,write:false})).toThrow(/expired/);
 const paired=pair(hub),pending=hub.call(paired.id,{kind:'inspect'});now+=45001;expect(hub.list()).toEqual([]);expect(await pending).toMatchObject({ok:false,error:{code:'DISCONNECTED'}});hub.dispose();
});
it('a read-only grant rejects edits before delivering any mutation',async()=>{
 const hub=new ChatGptHub(),paired=pair(hub,false);try{expect(await hub.call(paired.id,edit)).toMatchObject({ok:false,error:{code:'PERMISSION_DENIED'}});const pending=hub.call(paired.id,{kind:'inspect'}),event=await hub.next(paired.id,paired.owner,origin);expect(event.kind).toBe('request');if(event.kind!=='request')throw new Error('Expected inspection.');hub.complete(paired.id,paired.owner,origin,event.id,{ok:true,value:{document,revision:0}},document);expect(await pending).toMatchObject({ok:true});}finally{hub.dispose();}
});
it('read-only detached layer preparation is not treated as an authorized mutation',async()=>{
 const hub=new ChatGptHub(),paired=pair(hub,false);try{const pending=hub.call(paired.id,{kind:'template',layerKind:'text'}),event=await hub.next(paired.id,paired.owner,origin);if(event.kind!=='request')throw new Error('Expected detached preparation.');expect(()=>hub.authorize(paired.id,paired.owner,origin,event.id)).toThrow(/does not authorize/);hub.complete(paired.id,paired.owner,origin,event.id,{ok:true,value:{layer:{id:'detached'},revision:0,inserted:false}},document);expect(await pending).toMatchObject({ok:true,value:{inserted:false}});}finally{hub.dispose();}
});
it('retains a single receipt for concurrent and completed exact retries and rejects a different payload using its key',async()=>{
 const hub=new ChatGptHub(),paired=pair(hub);try{
  const first=hub.call(paired.id,edit),second=hub.call(paired.id,{...edit,commands:[{name:'Reviewed',type:'document.rename'}]}),event=await hub.next(paired.id,paired.owner,origin);if(event.kind!=='request')throw new Error('Expected edit.');
  expect(()=>hub.complete(paired.id,paired.owner,origin,event.id,success,{...document,revision:1})).toThrow(/authorization/);hub.authorize(paired.id,paired.owner,origin,event.id);hub.complete(paired.id,paired.owner,origin,event.id,success,{...document,revision:1});expect(await first).toEqual(success);expect(await second).toEqual(success);expect(await hub.call(paired.id,edit)).toEqual(success);expect(await hub.call(paired.id,{...edit,label:'Different transaction'})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
 }finally{hub.dispose();}
});
for(const delivered of [false,true])it('cancellation '+(delivered?'after delivery':'before delivery')+' prevents commit authorization and retains the cancelled retry receipt',async()=>{
 const hub=new ChatGptHub(),paired=pair(hub),abort=new AbortController();try{const pending=hub.call(paired.id,edit,abort.signal),event=delivered?await hub.next(paired.id,paired.owner,origin):undefined;abort.abort();expect(await pending).toMatchObject({ok:false,error:{code:'CANCELLED'}});expect(await hub.call(paired.id,edit)).toMatchObject({ok:false,error:{code:'CANCELLED'}});if(event?.kind==='request'){expect(()=>hub.authorize(paired.id,paired.owner,origin,event.id)).toThrow(/no longer/);expect(await hub.next(paired.id,paired.owner,origin)).toEqual({kind:'cancel',id:event.id});}}finally{hub.dispose();}
});
it('cancellation after commit authorization preserves the acknowledgement and the exact retry result',async()=>{
 const hub=new ChatGptHub(),paired=pair(hub),abort=new AbortController();try{const pending=hub.call(paired.id,edit,abort.signal),event=await hub.next(paired.id,paired.owner,origin);if(event.kind!=='request')throw new Error('Expected edit.');hub.authorize(paired.id,paired.owner,origin,event.id);abort.abort();hub.complete(paired.id,paired.owner,origin,event.id,success,{...document,revision:1});expect(await pending).toEqual(success);expect(await hub.call(paired.id,edit)).toEqual(success);}finally{hub.dispose();}
});
it('a late cancelled inspection acknowledgement does not revoke the remaining connection',async()=>{
 const hub=new ChatGptHub(),paired=pair(hub),abort=new AbortController();try{const pending=hub.call(paired.id,{kind:'inspect'},abort.signal),event=await hub.next(paired.id,paired.owner,origin);if(event.kind!=='request')throw new Error('Expected inspection.');abort.abort();expect(await pending).toMatchObject({ok:false,error:{code:'CANCELLED'}});expect(()=>hub.complete(paired.id,paired.owner,origin,event.id,{ok:true,value:{document}},document)).not.toThrow();expect(hub.list()).toHaveLength(1);}finally{hub.dispose();}
});
it('an unknown acknowledgement never replays the edit, and a late receipt can resolve the same key',async()=>{
 vi.useFakeTimers();const hub=new ChatGptHub(()=>0),paired=pair(hub);try{const pending=hub.call(paired.id,edit),event=await hub.next(paired.id,paired.owner,origin);if(event.kind!=='request')throw new Error('Expected edit.');hub.authorize(paired.id,paired.owner,origin,event.id);await vi.advanceTimersByTimeAsync(30001);expect(await pending).toMatchObject({ok:false,error:{code:'OUTCOME_UNKNOWN'}});expect(await hub.call(paired.id,edit)).toMatchObject({ok:false,error:{code:'OUTCOME_UNKNOWN'}});hub.complete(paired.id,paired.owner,origin,event.id,success,{...document,revision:1});expect(await hub.call(paired.id,edit)).toEqual(success);}finally{hub.dispose();}
});
it('cancelled pairing cannot arrive late or retain a half-acknowledged grant',()=>{
 const hub=new ChatGptHub();try{const pending=hub.beginPairing('http://127.0.0.1:12345'),code=parseConnectionCode(pending.connectionCode).code;hub.cancelPairing(code,origin);expect(()=>hub.pair(code,origin,document,{read:true,write:true})).toThrow(/expired/);const paired=pair(hub);expect(()=>hub.cancelPairing(paired.code,'https://other.invalid')).toThrow(/origin/);hub.cancelPairing(paired.code,origin);expect(hub.list()).toEqual([]);}finally{hub.dispose();}
});
it('rejects a switched document target and malformed results without acknowledging a mutation',async()=>{
 const hub=new ChatGptHub(),paired=pair(hub);try{const pending=hub.call(paired.id,edit),event=await hub.next(paired.id,paired.owner,origin);if(event.kind!=='request')throw new Error('Expected edit.');hub.authorize(paired.id,paired.owner,origin,event.id);expect(()=>hub.complete(paired.id,paired.owner,origin,event.id,success,{...document,id:'other'})).toThrow(/target/);expect(()=>hub.complete(paired.id,paired.owner,origin,event.id,{ok:true,value:null},document)).toThrow();hub.disconnect(paired.id);expect(await pending).toMatchObject({ok:false,error:{code:'DISCONNECTED'}});}finally{hub.dispose();}
});
it('never evicts old edit receipts to make a reused key execute twice',async()=>{
 const hub=new ChatGptHub(),paired=pair(hub);try{for(let i=0;i<256;i++){const operation={...edit,idempotencyKey:String(i)},pending=hub.call(paired.id,operation),event=await hub.next(paired.id,paired.owner,origin);if(event.kind!=='request')throw new Error('Expected edit.');hub.authorize(paired.id,paired.owner,origin,event.id);hub.complete(paired.id,paired.owner,origin,event.id,success,{...document,revision:1});expect((await pending).ok).toBe(true);}expect(await hub.call(paired.id,{...edit,idempotencyKey:'new'})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(await hub.call(paired.id,{...edit,idempotencyKey:'0'})).toEqual(success);}finally{hub.dispose();}
});
it('bounds only connection metadata and accepts exclusively literal loopback connection codes',()=>{
 expect(parseConnectionCode('http://127.0.0.1:1234/#canoli='+'a'.repeat(64))).toEqual({origin:'http://127.0.0.1:1234',code:'a'.repeat(64)});
 for(const url of ['https://127.0.0.1:1234/','http://localhost:1234/','http://127.0.0.1.evil.invalid:1234/','http://user@127.0.0.1:1234/','http://127.0.0.1:1234/other','http://127.0.0.1:1234/?secret=1'])expect(()=>parseConnectionCode(url+'#canoli='+'a'.repeat(64))).toThrow();
 expect(()=>boundedJson({width:10000,height:5000,originalByteLength:100000672})).not.toThrow();expect(()=>boundedJson({metadata:'x'.repeat(2000001)})).toThrow(/metadata/);
 let deep:unknown=null;for(let i=0;i<50;i++)deep={nested:deep};expect(()=>boundedJson(deep)).toThrow(/complexity/);
});
