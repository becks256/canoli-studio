/** Identify the AVIF file brand independently of an untrusted declared MIME.
 * Only box headers and the bounded ftyp table are read; image data is skipped.
 * This is routing protection, not container/payload validation.
 */
export async function hasAvifBrand(blob:Blob,check:()=>void=()=>{}):Promise<boolean>{
  const ascii=(bytes:Uint8Array,at:number)=>String.fromCharCode(...bytes.subarray(at,at+4));
  for(let at=0,count=0;at+8<=blob.size;){
    check();if(++count>16384)throw new Error('AVIF source detection metadata box budget exceeded.');
    const bytes=new Uint8Array(await blob.slice(at,Math.min(blob.size,at+16)).arrayBuffer());check();
    if(bytes.length<8)return false;
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),type=ascii(bytes,4);
    if(!/^[\x20-\x7e]{4}$/.test(type))return false;
    let size=view.getUint32(0),header=8;
    if(size===1){if(bytes.length<16)return false;const wide=view.getBigUint64(8);if(wide>BigInt(Number.MAX_SAFE_INTEGER))return false;size=Number(wide);header=16;}
    else if(size===0)size=blob.size-at;
    if(size<header||size>blob.size-at)return false;
    if(type==='ftyp'){
      // Matches the input reader's table budget, independent of file/image size.
      const length=size-header;
      const brands=new Uint8Array(await blob.slice(at+header,at+header+Math.min(length,4096)).arrayBuffer());check();
      for(let i=0;i+4<=brands.length;i+=4){if(i===4)continue;if(['avif','avis'].includes(ascii(brands,i)))return true;}
      // A brand hidden beyond the inspection budget must not fall through to a
      // browser decoder with different precision/color rules.
      if(length>4096)throw new Error('AVIF source detection file-type metadata budget exceeded.');
      if(length<8||length%4)return false;
    }
    at+=size;
  }
  return false;
}
