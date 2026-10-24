/** Repack one TTC face without subsetting or changing glyph/layout tables. */
export function extractCollectionFace(source:Uint8Array,offset:number):{bytes:Uint8Array;omittedTables:string[]}{
  const view=new DataView(source.buffer,source.byteOffset,source.byteLength);
  const range=(at:number,size:number)=>{if(!Number.isSafeInteger(at)||!Number.isSafeInteger(size)||at<0||size<0||at+size>source.length)throw new Error('Font table lies outside its source.');};
  range(offset,12);const flavor=view.getUint32(offset);
  if(![0x00010000,0x74727565,0x4f54544f].includes(flavor))throw new Error('Collection face has an unsupported SFNT header.');
  const count=view.getUint16(offset+4);if(!count)throw new Error('Font has no tables.');range(offset+12,count*16);
  const tables:{tag:number;name:string;offset:number;length:number}[]=[],tags=new Set<number>(),omittedTables:string[]=[];
  for(let i=0;i<count;i++){
    const at=offset+12+i*16,tag=view.getUint32(at),start=view.getUint32(at+8),length=view.getUint32(at+12);
    if(tags.has(tag))throw new Error('Duplicate SFNT table.');tags.add(tag);range(start,length);
    if(length&&start<offset+12+count*16&&start+length>offset)throw new Error('Font table overlaps its directory.');
    const name=String.fromCharCode(...source.subarray(at,at+4));
    if(name==='DSIG')omittedTables.push(name);else tables.push({tag,name,offset:start,length});
  }
  // Collection faces may share tables with OTHER faces, but their own tables
  // cannot overlap. This also bounds derived storage by the source's table data.
  const spans=tables.filter(t=>t.length).sort((a,b)=>a.offset-b.offset);
  for(let i=1;i<spans.length;i++)if(spans[i-1].offset+spans[i-1].length>spans[i].offset)throw new Error('Overlapping SFNT tables.');
  if(!tables.some(t=>t.name==='head'&&t.length>=54))throw new Error('Font is missing its complete head table.');
  tables.sort((a,b)=>a.tag-b.tag);
  const n=tables.length,power=2**Math.floor(Math.log2(n));
  if(power*16>65535)throw new Error('SFNT table count cannot be represented by its search header.');
  let size=12+n*16;for(const t of tables)size+=Math.ceil(t.length/4)*4;
  if(!Number.isSafeInteger(size)||size>0xffffffff)throw new Error('Derived SFNT exceeds its format offsets.');
  const bytes=new Uint8Array(size),out=new DataView(bytes.buffer);
  out.setUint32(0,flavor===0x4f54544f?flavor:0x00010000);out.setUint16(4,n);out.setUint16(6,power*16);out.setUint16(8,Math.log2(power));out.setUint16(10,n*16-power*16);
  let position=12+n*16,head=0;
  for(let i=0;i<n;i++){
    const t=tables[i],at=12+i*16;bytes.set(source.subarray(t.offset,t.offset+t.length),position);
    if(t.name==='head'){head=position;out.setUint32(head+8,0);}
    out.setUint32(at,t.tag);out.setUint32(at+4,sfntChecksum(bytes.subarray(position,position+Math.ceil(t.length/4)*4)));out.setUint32(at+8,position);out.setUint32(at+12,t.length);position+=Math.ceil(t.length/4)*4;
  }
  out.setUint32(head+8,(0xb1b0afba-sfntChecksum(bytes))>>>0);
  return{bytes,omittedTables};
}
export function sfntChecksum(bytes:Uint8Array):number{
  let sum=0;for(let i=0;i<bytes.length;i+=4)sum=(sum+((bytes[i]??0)*0x1000000+(bytes[i+1]??0)*0x10000+(bytes[i+2]??0)*0x100+(bytes[i+3]??0)))>>>0;return sum;
}
