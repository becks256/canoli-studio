// Test-only native precision measurement. This is not an application/plugin API.
import factory from '../../../src/core/interchange/raw/codec/canoli_raw_decoder.js';
import wasmUrl from '../../../src/core/interchange/raw/codec/canoli_raw_decoder.wasm?url';
import {rawDecoder} from '../../../src/core/interchange/raw/codec';
import {Sha256} from '../../../src/core/sha256';
self.onmessage=async(event:MessageEvent)=>{
  try{
    const codec=rawDecoder(await factory({locateFile:()=>wasmUrl})),image=codec.develop(new Uint8Array(await(event.data as Blob).arrayBuffer()));
    try{
      const hash=new Sha256();let maximumRowBytes=0;
      for(let top=0;top<image.height;top+=64){const rows=image.readRows(top,Math.min(64,image.height-top)),bytes=new Uint8Array(rows.buffer,rows.byteOffset,rows.byteLength);maximumRowBytes=Math.max(maximumRowBytes,bytes.length);hash.update(bytes);}
      self.postMessage({report:image.report,sha256:hash.digest(),maximumRowBytes});
    }finally{image.dispose();}
  }catch(error){self.postMessage({error:String(error)});}
};
