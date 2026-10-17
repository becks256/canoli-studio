const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(bytes.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, bytes.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(bytes, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < result.length - 4; i++)
    crc = crcTable[(crc ^ result[i]) & 255] ^ (crc >>> 8);
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}

/** Native scanline sink; retains compressed output and one bounded caller strip. */
export class PngRowEncoder {
  private parts:BlobPart[]=[];
  private compression=new CompressionStream('deflate');
  private writer=this.compression.writable.getWriter();
  private reader=this.compression.readable.getReader();
  private collecting:Promise<void>;
  private rows=0;
  constructor(readonly width:number,readonly height:number,iccDeflated?:Uint8Array){
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>0x7fffffff||height>0x7fffffff)throw new Error('Invalid PNG geometry.');
    const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,width);view.setUint32(4,height);header[8]=8;header[9]=6;
    let color=chunk('sRGB',new Uint8Array([0]));
    if(iccDeflated){const name=new TextEncoder().encode('TIFF source\0\0'),bytes=new Uint8Array(name.length+iccDeflated.length);bytes.set(name);bytes.set(iccDeflated,name.length);color=chunk('iCCP',bytes);}
    this.parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),color];
    this.collecting=(async()=>{while(true){const {value,done}=await this.reader.read();if(done)break;this.parts.push(chunk('IDAT',value));}})();void this.collecting.catch(()=>{});
  }
  async append(rgba:Uint8Array,rows:number):Promise<void>{
    if(!Number.isInteger(rows)||rows<1||this.rows+rows>this.height||rgba.length!==this.width*rows*4)throw new Error('PNG scanlines do not match source geometry.');
    const bytes=this.width*4,filtered=new Uint8Array((bytes+1)*rows);
    for(let y=0;y<rows;y++)filtered.set(rgba.subarray(y*bytes,(y+1)*bytes),y*(bytes+1)+1);
    await this.writer.write(filtered);this.rows+=rows;
  }
  async finish():Promise<Blob>{
    if(this.rows!==this.height)throw new Error('Incomplete PNG scanlines.');
    await this.writer.close();await this.collecting;this.parts.push(chunk('IEND',new Uint8Array()));return new Blob(this.parts,{type:'image/png'});
  }
  async abort(reason:unknown){await Promise.allSettled([this.writer.abort(reason),this.reader.cancel(reason)]);}
}
