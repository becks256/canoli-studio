/** Synthetic TIFF metadata fixture: append a complete sorted classic IFD while
 * retaining every original pixel/profile extent at its original file address. */
export function withTiffOrientation(input:Uint8Array,orientation:number):Uint8Array{
  if(!Number.isInteger(orientation)||orientation<1||orientation>8)throw new Error('Invalid fixture orientation.');
  const source=new DataView(input.buffer,input.byteOffset,input.byteLength),little=input[0]===73;
  if(source.getUint16(2,little)!==42)throw new Error('Use a classic TIFF fixture.');
  const at=source.getUint32(4,little),count=source.getUint16(at,little),entries:Uint8Array[]=[];
  for(let i=0;i<count;i++){const offset=at+2+i*12;if(source.getUint16(offset,little)!==274)entries.push(input.slice(offset,offset+12));}
  const tag=new Uint8Array(12),view=new DataView(tag.buffer);view.setUint16(0,274,little);view.setUint16(2,3,little);view.setUint32(4,1,little);view.setUint16(8,orientation,little);entries.push(tag);entries.sort((a,b)=>new DataView(a.buffer,a.byteOffset).getUint16(0,little)-new DataView(b.buffer,b.byteOffset).getUint16(0,little));
  const offset=input.length+(input.length%2),output=new Uint8Array(offset+2+entries.length*12+4);output.set(input);const result=new DataView(output.buffer);result.setUint32(4,offset,little);result.setUint16(offset,entries.length,little);entries.forEach((entry,index)=>output.set(entry,offset+2+index*12));return output;
}
