import {expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {avifDecoder} from '../src/core/interchange/avif/codec';
import type {NativeAvifModule} from '../src/core/interchange/avif/codec/canoli_avif_decoder.js';

function fixture(){
  const heap=new Uint8Array(2048),pixels=new Uint8ClampedArray([10,20,30,40,50,60,70,80,90,100,110,120,130,140,150,160]);
  new Uint32Array(heap.buffer,256,12).set([1,2,2,8,1,1,13,0,1,512,16,8]);
  const module:NativeAvifModule={HEAPU8:heap,_malloc:vi.fn(()=>64),_free:vi.fn(),_canoli_avif_decode:vi.fn(()=>{heap.set(pixels,512);return 0;}),_canoli_avif_info:()=>256,_canoli_avif_error:()=>1024,_canoli_avif_release:vi.fn(()=>heap.fill(0,512,528))};
  return{module,heap,pixels};
}
it('copies source and output ownership across native release, leaving valid detached editing samples',()=>{
  const {module,pixels}=fixture(),bytes=new Uint8Array([1,2,3]),before=bytes.slice(),decoded=avifDecoder(module).decode(bytes,8)!;
  expect(decoded.data).toEqual(pixels);expect(bytes).toEqual(before);expect(decoded).toMatchObject({width:2,height:2,bitDepth:8,alpha:true,color:{primaries:1,transfer:13,matrix:0,fullRange:true}});
  expect(module._canoli_avif_release).toHaveBeenCalledOnce();expect(module._free).toHaveBeenCalledWith(64);
});
it('rejects native allocation failure before decoding and releases any previous native output',()=>{
  const {module}=fixture();module._malloc=()=>0;expect(()=>avifDecoder(module).decode(new Uint8Array([1]),8)).toThrow(/allocation failed/);expect(module._canoli_avif_decode).not.toHaveBeenCalled();expect(module._canoli_avif_release).toHaveBeenCalledOnce();expect(module._free).not.toHaveBeenCalled();
});
it('preserves native conversion errors and releases both owned allocations',()=>{
  const {module,heap}=fixture();heap.set(new TextEncoder().encode('AVIF YUV/RGB conversion failed.\0'),1024);module._canoli_avif_decode=()=>19;
  expect(()=>avifDecoder(module).decode(new Uint8Array([1]),8)).toThrow('AVIF YUV/RGB conversion failed.');expect(module._canoli_avif_release).toHaveBeenCalledOnce();expect(module._free).toHaveBeenCalledWith(64);
});
for(const field of [0,1,3,4,8,9,10,11])it(`rejects inconsistent native field ${field} before returning borrowed data`,()=>{
  const {module,heap}=fixture(),fields=new Uint32Array(heap.buffer,256,12);fields[field]=field===9?2040:field===1?0:65535;
  expect(()=>avifDecoder(module).decode(new Uint8Array([1]),8)).toThrow(/native RGBA result/);expect(module._canoli_avif_release).toHaveBeenCalledOnce();expect(module._free).toHaveBeenCalledWith(64);
});
it('matches the actual shipped native artifacts and maintained wrapper/build inputs',async()=>{
  const root=new URL('../',import.meta.url),manifest=JSON.parse(await readFile(new URL('src/core/interchange/avif/codec/build.json',root),'utf8'));
  for(const [name,entry]of Object.entries(manifest.artifacts) as [string,{bytes:number;sha256:string}][]){const bytes=await readFile(new URL('src/core/interchange/avif/codec/'+name,root));expect(bytes.length).toBe(entry.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);}
  for(const [name,digest]of Object.entries(manifest.sourceFiles))expect(createHash('sha256').update(await readFile(new URL(name,root))).digest('hex')).toBe(digest);
  const wasm=await WebAssembly.compile(await readFile(new URL('src/core/interchange/avif/codec/canoli_avif_decoder.wasm',root))),imports:Record<string,Record<string,()=>number>>={};
  for(const entry of WebAssembly.Module.imports(wasm)){expect(entry.kind).toBe('function');(imports[entry.module]??={})[entry.name]=()=>0;}
  const instance=await WebAssembly.instantiate(wasm,imports),memory=Object.values(instance.exports).find(value=>value instanceof WebAssembly.Memory) as WebAssembly.Memory;
  expect(memory).toBeDefined();expect(memory.buffer).toBeInstanceOf(ArrayBuffer);
});
