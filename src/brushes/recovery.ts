import { z } from 'zod';
import {encodeBrushContainer,readBrushContainer} from './container';
const recoverySchema = z.object({format:z.literal('canoli-brush-library-recovery'),version:z.literal(1),records:z.array(z.unknown())}).strict();
const message = 'A recovery backup cannot safely represent non-JSON brush data. Saved records were preserved. Export the last valid library or keep the browser data for recovery.';

/** Refuse JSON's silent losses: binary values, dates, undefined, holes, cycles and aliases. */
export function serializeBrushRecovery(records: readonly unknown[]): string {
  const pending: unknown[] = [records], seen = new WeakSet<object>();
  while (pending.length) {
    const value = pending.pop();
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number' && Number.isFinite(value)) continue;
    if (!value || typeof value !== 'object' || seen.has(value)) throw new Error(message);
    seen.add(value);
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new Error(message);
    const keys = Reflect.ownKeys(value);
    if (array && keys.length !== value.length + 1) throw new Error(message);
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) throw new Error(message);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(message);
      pending.push(descriptor.value);
    }
  }
  return JSON.stringify({format:'canoli-brush-library-recovery',version:1,records}, null, 2);
}
export function parseBrushRecovery(text: string): unknown[] {
  return recoverySchema.parse(JSON.parse(text)).records;
}

const binaryRecoverySchema=z.object({format:z.literal('canoli-brush-library-recovery'),version:z.literal(2),records:z.array(z.unknown()),paths:z.array(z.array(z.string()).min(1))}).strict();
/** Preserve JSON-safe raw data plus immutable Blob values, including invalid preset records. */
export async function prepareBrushRecovery(records:readonly unknown[],signal?:AbortSignal){
  const paths:string[][]=[],blobs:Blob[]=[],seen=new WeakSet<object>();
  let copy:unknown;
  const pending:{value:unknown;path:string[];assign(value:unknown):void}[]=[{value:records,path:[],assign:value=>copy=value}];
  while(pending.length){
    signal?.throwIfAborted();const {value,path,assign}=pending.pop()!;
    if(value instanceof Blob){assign(null);paths.push(path);blobs.push(value);continue;}
    if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)){assign(value);continue;}
    if(!value||typeof value!=='object'||seen.has(value))throw new Error(message);seen.add(value);
    const array=Array.isArray(value),proto=Object.getPrototypeOf(value),keys=Reflect.ownKeys(value);
    if(!array&&proto!==Object.prototype&&proto!==null||array&&keys.length!==value.length+1)throw new Error(message);
    const result:Record<string,unknown>|unknown[]=array?new Array(value.length):{};assign(result);
    // Define properties now to retain original field order despite the LIFO traversal.
    for(const key of keys){
      if(array&&key==='length')continue;
      if(typeof key!=='string'||array&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length))throw new Error(message);
      const descriptor=Object.getOwnPropertyDescriptor(value,key)!;if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw new Error(message);
      Object.defineProperty(result,key,{value:null,writable:true,enumerable:true,configurable:true});
      pending.push({value:descriptor.value,path:[...path,key],assign:item=>Object.defineProperty(result,key,{value:item,writable:true,enumerable:true,configurable:true})});
    }
  }
  if(!blobs.length){const text=serializeBrushRecovery(records);return {blob:new Blob([text],{type:'application/json'}),fingerprint:`json:${text}`};}
  const result=await encodeBrushContainer({format:'canoli-brush-library-recovery',version:2,records:copy,paths},blobs,'application/x-canoli-brush-recovery',signal);
  return {blob:result.blob,fingerprint:`binary:${result.fingerprint}`};
}
export async function parseBrushRecoveryFile(file:Blob,signal?:AbortSignal):Promise<unknown[]>{
  const container=await readBrushContainer(file,signal);
  if(!container){const text=await file.text();signal?.throwIfAborted();return parseBrushRecovery(text);}
  const data=binaryRecoverySchema.parse(container.data);if(data.paths.length!==container.blobs.length)throw new Error('Recovery contains unreferenced binary data.');
  data.paths.forEach((path,index)=>{
    let current:unknown=data.records;
    for(let i=0;i<path.length;i++){
      const key=path[i];
      if(!current||typeof current!=='object'||current instanceof Blob||!Object.hasOwn(current,key)||Array.isArray(current)&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=current.length))throw new Error('Invalid recovery blob path.');
      if(i===path.length-1){if((current as Record<string,unknown>)[key]!==null)throw new Error('Duplicate or invalid recovery blob path.');Object.defineProperty(current,key,{value:container.blobs[index],enumerable:true,writable:true,configurable:true});}
      else current=(current as Record<string,unknown>)[key];
    }
  });
  signal?.throwIfAborted();return data.records;
}
