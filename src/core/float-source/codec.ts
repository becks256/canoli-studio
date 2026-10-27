import{Sha256}from'../sha256';
import type{FloatEncodedTile,FloatTileMeta}from'./types';
const little=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
export async function digest(bytes:Uint8Array){return[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function hashBlob(blob:Blob,signal?:AbortSignal,progress?:(fraction:number)=>void){const reader=blob.stream().getReader(),hash=new Sha256();let size=0;try{while(true){signal?.throwIfAborted();const row=await reader.read();if(row.done)break;hash.update(row.value);size+=row.value.byteLength;progress?.(size/blob.size);}signal?.throwIfAborted();return hash.digest();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
export function validatePixels(pixels:Float32Array){if(!(pixels instanceof Float32Array)||!(pixels.buffer instanceof ArrayBuffer)||pixels.length%4)throw new Error('Float source pixels require complete RGBA float32.');for(let i=0;i<pixels.length;i++)if(!Number.isFinite(pixels[i])||i%4===3&&(pixels[i]<0||pixels[i]>1))throw new Error('Float source color/alpha is invalid.');}
export async function encodeTile(index:number,width:number,height:number,pixels:Float32Array):Promise<FloatEncodedTile>{
 validatePixels(pixels);if(pixels.length!==width*height*4||pixels.byteLength>256*64*16)throw new Error('Float tile exceeds its working geometry.');let bytes=new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength);if(!little){bytes=new Uint8Array(pixels.byteLength);const v=new DataView(bytes.buffer);for(let i=0;i<pixels.length;i++)v.setFloat32(i*4,pixels[i],true);}
 const blob=new Blob([await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()],{type:'application/zlib'}),encoded=new Uint8Array(await blob.arrayBuffer());return{blob,meta:{index,width,height,rawBytes:bytes.byteLength,encodedBytes:blob.size,rawSha256:await digest(bytes),encodedSha256:await digest(encoded)}};
}
export async function verifyEncodedTile(tile:FloatEncodedTile,expected:FloatTileMeta){
 if(JSON.stringify(tile.meta)!==JSON.stringify(expected)||!(tile.blob instanceof Blob)||tile.blob.size!==expected.encodedBytes||tile.blob.size>expected.rawBytes+65536||await digest(new Uint8Array(await tile.blob.arrayBuffer()))!==expected.encodedSha256)throw new Error('Float tile compressed bytes are missing or corrupt.');
}
export async function decodeTile(tile:FloatEncodedTile,expected:FloatTileMeta):Promise<Float32Array<ArrayBuffer>>{
 await verifyEncodedTile(tile,expected);
 const output=new Uint8Array(expected.rawBytes),reader=tile.blob.stream().pipeThrough(new DecompressionStream('deflate')).getReader();let used=0;try{while(true){const part=await reader.read();if(part.done)break;if(used+part.value.byteLength>output.byteLength)throw new Error('Float tile decompression exceeds its declared geometry.');output.set(part.value,used);used+=part.value.byteLength;}if(used!==output.byteLength||await digest(output)!==expected.rawSha256)throw new Error('Float tile decoded bytes are incomplete or corrupt.');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const pixels=new Float32Array(output.buffer);if(!little){const v=new DataView(output.buffer);for(let i=0;i<pixels.length;i++)pixels[i]=v.getFloat32(i*4,true);}validatePixels(pixels);return pixels;
}
