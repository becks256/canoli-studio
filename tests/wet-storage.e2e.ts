import {test,expect} from '@playwright/test';

test('native wet write groups capture both planes and roll back a quota failure before another valid commit',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {createWetTileStore}=await import(/* @vite-ignore */ String('/src/engine/wet-store.ts'));
  const names=async()=>(await indexedDB.databases()).map(value=>value.name).filter(name=>name?.startsWith('canoli-wet-job-')).sort(),before=await names(),store=await createWetTileStore();
  const put=IDBObjectStore.prototype.put;
  try{
   await store.put('obsolete',new Uint8ClampedArray([9]));const pixels=new Uint8ClampedArray([1,2,3,4]),carried=new Float32Array([.25,0,0,.5]);
   const pending=store.batch!([{type:'put',key:'pixels',value:pixels},{type:'put',key:'carried',value:carried},{type:'remove',key:'obsolete'}]);pixels.fill(99);carried.fill(1);await pending;
   const captured=[Array.from((await store.get('pixels'))!),Array.from((await store.get('carried'))!)],removed=await store.get('obsolete')===undefined;
   let count=0,rejected=false;IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name.startsWith('canoli-wet-job-')&&++count===2)throw new DOMException('Injected quota failure','QuotaExceededError');return put.apply(this,args);};
   try{await store.batch!([{type:'put',key:'pixels',value:new Uint8ClampedArray([8])},{type:'put',key:'uncommitted',value:new Float32Array([.75])}]);}catch(error){rejected=error instanceof DOMException&&error.name==='QuotaExceededError';}finally{IDBObjectStore.prototype.put=put;}
   const rollback={pixels:Array.from((await store.get('pixels'))!),missing:await store.get('uncommitted')===undefined};
   await store.batch!([{type:'put',key:'recovered',value:new Uint8ClampedArray([7])},{type:'remove',key:'pixels'}]);const recovered=Array.from((await store.get('recovered'))!),deleted=await store.get('pixels')===undefined;
   await store.dispose();let closed=false;try{await store.batch!([]);}catch{closed=true;}
   return{captured,removed,rejected,rollback,recovered,deleted,closed,cleaned:JSON.stringify(before)===JSON.stringify(await names())};
  }finally{IDBObjectStore.prototype.put=put;await store.dispose();}
 });expect(result).toEqual({captured:[[1,2,3,4],[.25,0,0,.5]],removed:true,rejected:true,rollback:{pixels:[1,2,3,4],missing:true},recovered:[7],deleted:true,closed:true,cleaned:true});
});

test('failed native write groups leave resident and evicted cache reads at their prior complete epoch',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {createWetTileStore}=await import(/* @vite-ignore */ String('/src/engine/wet-store.ts')),{WetTileCache}=await import(/* @vite-ignore */ String('/src/engine/wet-state.ts'));
  const store=await createWetTileStore(),cache=new WetTileCache(store,64),put=IDBObjectStore.prototype.put;
  try{
   await cache.put('original',new Uint8ClampedArray([1,2,3,4]));let count=0,rejected=false;
   IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name.startsWith('canoli-wet-job-')&&++count===2)throw new DOMException('Injected write failure','QuotaExceededError');return put.apply(this,args);};
   try{await cache.batch([{type:'put',key:'original',value:new Uint8ClampedArray([9,9,9,9])},{type:'put',key:'new',value:new Float32Array([.5,0,0,1])}]);}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
   const resident=Array.from((await cache.get('original'))!),residentMissing=await cache.get('new')===undefined;cache.clear();const backing=Array.from((await cache.get('original'))!),backingMissing=await cache.get('new')===undefined;
   await cache.batch([{type:'put',key:'new',value:new Float32Array([.5,0,0,1])},{type:'remove',key:'original'}]);const next=Array.from((await cache.get('new'))!),deleted=await cache.get('original')===undefined;
   return{rejected,resident,residentMissing,backing,backingMissing,next,deleted,bytes:cache.bytes};
  }finally{IDBObjectStore.prototype.put=put;cache.clear();await store.dispose();}
 });expect(result).toEqual({rejected:true,resident:[1,2,3,4],residentMissing:true,backing:[1,2,3,4],backingMissing:true,next:[.5,0,0,1],deleted:true,bytes:16});
});
