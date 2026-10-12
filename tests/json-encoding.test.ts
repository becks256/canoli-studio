import { expect, it } from 'vitest';
import { encodeJsonData } from '../src/core/json-encoding';

it('cooperative model encoding preserves exact native JSON UTF-8 bytes', async () => {
  const shared = {title:'Art 🌈',escaped:'"\\\n\r\t',lone:'\ud800',empty:''};
  const ordered = Object.assign(Object.create(null), {'10':'ten','2':'two',z:undefined,a:shared});
  const values = [null,true,false,0,-0,1e-20,Number.MAX_VALUE,NaN,Infinity,'🌈\ud800',
    [undefined,,null,Symbol(),()=>{}],{long:'🌈é'.repeat(30000)},Object.fromEntries(Array.from({length:20},(_,i)=>[String(i),{nested:[i,undefined,[i+1]]}])),ordered,{first:shared,second:shared},
    Array.from({length:10000},(_,i)=>({x:i/7,y:-i/13,pressure:(i%256)/255,label:i%97?'':'é🌈'}))];
  for(const value of values) expect(await encodeJsonData(value)).toEqual(new TextEncoder().encode(JSON.stringify(value)));
});

it('yields to queued tasks while encoding large stable models', async () => {
  let inputRan = false;
  const model=Array.from({length:20000},(_,i)=>({x:i,y:i*2}));
  const task=new Promise<void>(resolve=>setTimeout(()=>{inputRan=true;resolve();},0));
  const bytes=await encodeJsonData(model);
  expect(inputRan).toBe(true);expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(model);
  await task;
});

it('rejects cycles and non-data objects rather than producing a different checksum', async () => {
  const cycle:unknown[]=[];cycle.push(cycle);
  await expect(encodeJsonData(cycle)).rejects.toThrow('cyclic');
  await expect(encodeJsonData({big:1n})).rejects.toThrow();
  await expect(encodeJsonData(new Date())).rejects.toThrow('plain');
  await expect(encodeJsonData({toJSON:()=>({})})).rejects.toThrow('custom');
});
