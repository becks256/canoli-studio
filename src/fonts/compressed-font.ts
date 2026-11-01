import {z} from 'zod';
import {sfntChecksum} from './sfnt';
import {fontDigest} from './types';
import type {FontFaceInfo} from './types';

const formats={woff:0x774f4646,woff2:0x774f4632};
const flavors=[0x00010000,0x74727565,0x4f54544f];
// Four-byte tags, including spaces, are defined by the WOFF2 format directory.
const WOFF2_TAGS=['cmap','head','hhea','hmtx','maxp','name','OS/2','post','cvt ','fpgm','glyf','loca','prep','CFF ','VORG','EBDT','EBLC','gasp','hdmx','kern','LTSH','PCLT','VDMX','vhea','vmtx','BASE','GDEF','GPOS','GSUB','EBSC','JSTF','MATH','CBDT','CBLC','COLR','CPAL','SVG ','sbix','acnt','avar','bdat','bloc','bsln','cvar','fdsc','feat','fmtx','fvar','gvar','hsty','just','lcar','mort','morx','opbd','prop','trak','Zapf','Silf','Glat','Gloc','Feat','Sill'];
const view=(bytes:Uint8Array)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
const range=(bytes:Uint8Array,at:number,length:number)=>{if(!Number.isSafeInteger(at)||!Number.isSafeInteger(length)||at<0||length<0||at+length>bytes.length)throw new Error('Compressed font table exceeds its source.');};
const tagAt=(bytes:Uint8Array,at:number)=>{range(bytes,at,4);return String.fromCharCode(...bytes.subarray(at,at+4));};
export interface CompressedFontTable {tag:string;length:number;transformed:boolean;offset?:number;compressedLength?:number;checksum?:number}
export interface CompressedFontDirectory {format:'woff'|'woff2';flavor:number;tables:readonly CompressedFontTable[];dataOffset:number;compressedLength:number;declaredSize:number}
export function compressedFontFormat(bytes:Uint8Array):'woff'|'woff2'|undefined{
 if(bytes.length<4)return;const signature=view(bytes).getUint32(0);return signature===formats.woff?'woff':signature===formats.woff2?'woff2':undefined;
}
export function readCompressedFont(bytes:Uint8Array):CompressedFontDirectory{
 const format=compressedFontFormat(bytes);if(!format)throw new Error('Expected a selected WOFF or WOFF2 font.');const v=view(bytes),header=format==='woff'?44:48;range(bytes,0,header);const flavor=v.getUint32(4),count=v.getUint16(12),declaredSize=v.getUint32(16);
 if(!flavors.includes(flavor)||!count||v.getUint32(8)!==bytes.length||v.getUint16(14)!==0)throw new Error('Invalid selected compressed-font header.');
 const tables:CompressedFontTable[]=[],seen=new Set<string>();let dataOffset=header,compressedLength=0;
 if(format==='woff'){
  range(bytes,header,count*20);dataOffset=header+count*20;const spans:{start:number;end:number}[]=[];
  for(let i=0;i<count;i++){const at=header+i*20,tag=tagAt(bytes,at),offset=v.getUint32(at+4),compressedLength=v.getUint32(at+8),length=v.getUint32(at+12),checksum=v.getUint32(at+16);range(bytes,offset,compressedLength);if(compressedLength>length||offset%4||offset<dataOffset)throw new Error('Invalid WOFF table bounds.');spans.push({start:offset,end:offset+compressedLength});tables.push({tag,offset,compressedLength,length,checksum,transformed:false});}
  spans.sort((a,b)=>a.start-b.start);for(let i=1;i<spans.length;i++)if(spans[i].start<spans[i-1].end)throw new Error('Overlapping WOFF tables.');
  const expected=12+16*count+tables.reduce((n,t)=>n+Math.ceil(t.length/4)*4,0);if(expected!==declaredSize)throw new Error('Invalid WOFF original table size.');
 }else{
  let cursor=header;const uint8=()=>{range(bytes,cursor,1);return bytes[cursor++];},base128=()=>{let n=0;for(let i=0;i<5;i++){const b=uint8();if(i===0&&b===0x80||n>0x1ffffff)throw new Error('Invalid WOFF2 Base128 length.');n=n*128+(b&127);if(!(b&128))return n;}throw new Error('Invalid WOFF2 Base128 length.');};
  for(let i=0;i<count;i++){const flags=uint8(),index=flags&63,tag=index===63?(range(bytes,cursor,4),cursor+=4,tagAt(bytes,cursor-4)):WOFF2_TAGS[index],version=flags>>>6,length=base128();if(!tag)throw new Error('Invalid WOFF2 table tag.');const glyph=tag==='glyf'||tag==='loca',transformed=glyph?version===0:version!==0;if(glyph&&![0,3].includes(version)||!glyph&&version!==0&&!(tag==='hmtx'&&version===1))throw new Error('Unsupported WOFF2 table transform.');if(transformed){const size=base128();if(tag==='loca'&&size!==0)throw new Error('Invalid transformed WOFF2 loca size.');}tables.push({tag,length,transformed});}
  dataOffset=cursor;compressedLength=v.getUint32(20);range(bytes,dataOffset,compressedLength);
 }
 for(const table of tables){if(seen.has(table.tag))throw new Error('Duplicate compressed font table.');seen.add(table.tag);}
 if(!seen.has('head')||!seen.has('maxp')||!seen.has('cmap'))throw new Error('Compressed font is missing native source tables.');
 const metadata=format==='woff'?24:28,metaOffset=v.getUint32(metadata),metaLength=v.getUint32(metadata+4),privateOffset=v.getUint32(metadata+12),privateLength=v.getUint32(metadata+16);if(metaOffset)range(bytes,metaOffset,metaLength);else if(metaLength||v.getUint32(metadata+8))throw new Error('Invalid compressed font metadata.');if(privateOffset)range(bytes,privateOffset,privateLength);else if(privateLength)throw new Error('Invalid compressed font private block.');
 return{format,flavor,tables,dataOffset,compressedLength,declaredSize};
}
function pack(flavor:number,tables:readonly {tag:string;bytes:Uint8Array}[]):Uint8Array<ArrayBuffer>{
 const sorted=[...tables].sort((a,b)=>a.tag<b.tag?-1:a.tag>b.tag?1:0),n=sorted.length,power=2**Math.floor(Math.log2(n));if(power*16>65535)throw new Error('Font directory exceeds its SFNT search fields.');let length=12+n*16;for(const t of sorted)length+=Math.ceil(t.bytes.length/4)*4;if(length>0xffffffff)throw new Error('Decoded font exceeds SFNT addressing.');const out=new Uint8Array(length),v=view(out);v.setUint32(0,flavor);v.setUint16(4,n);v.setUint16(6,power*16);v.setUint16(8,Math.log2(power));v.setUint16(10,n*16-power*16);let pos=12+n*16,head=0;
 for(let i=0;i<n;i++){const t=sorted[i],at=12+i*16;out.set(t.bytes,pos);if(t.tag==='head'){head=pos;v.setUint32(head+8,0);}for(let j=0;j<4;j++)v.setUint8(at+j,t.tag.charCodeAt(j));v.setUint32(at+4,sfntChecksum(out.subarray(pos,pos+t.bytes.length)));v.setUint32(at+8,pos);v.setUint32(at+12,t.bytes.length);pos+=Math.ceil(t.bytes.length/4)*4;}
 v.setUint32(head+8,(0xb1b0afba-sfntChecksum(out))>>>0);return out;
}
export async function decodeCompressedFont(input:Uint8Array,check:()=>void=()=>{}):Promise<Uint8Array<ArrayBuffer>>{
 const bytes=Uint8Array.from(input),directory=readCompressedFont(bytes);check();
 if(directory.format==='woff2'){
  const {default:create}=await import('../generated/font-decoder-runtime.mjs');check();const module=await create();check();let source=0,result=0;
  try{source=module._malloc(bytes.length);if(!source)throw new Error('Cannot allocate compressed font bytes.');module.HEAPU8.set(bytes,source);result=module._canoli_woff2_decode(source,bytes.length);check();if(!result)throw new Error('WOFF2 source could not be decoded.');const size=module._canoli_font_size(result),start=module._canoli_font_data(result);if(!size||!start||start+size>module.HEAPU8.length)throw new Error('Invalid native WOFF2 result.');return module.HEAPU8.slice(start,start+size);}finally{if(result)module._canoli_font_release(result);if(source)module._free(source);}
 }
 const tables:{tag:string;bytes:Uint8Array}[]=[];
 for(const table of directory.tables){check();const source=bytes.slice(table.offset!,table.offset!+table.compressedLength!),decoded=table.compressedLength===table.length?source:new Uint8Array(await new Response(new Blob([source]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());check();if(decoded.length!==table.length)throw new Error('WOFF decoded table length differs.');tables.push({tag:table.tag,bytes:decoded});}
 const result=pack(directory.flavor,tables);check();return result;
}
export const decodedFontWireSchema=z.object({version:z.literal(1),bytes:z.instanceof(Uint8Array),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),decodedSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type DecodedFontWire=z.infer<typeof decodedFontWireSchema>;
/** Full output checksums/table bounds and original source-directory binding.
 * WOFF2 reconstructed glyf/loca lengths may differ from its advisory header. */
export function* validateDecodedFontSteps(original:Uint8Array,decoded:Uint8Array,identity:Pick<FontFaceInfo,'unitsPerEm'|'glyphCount'>):Generator<void>{
 const directory=readCompressedFont(original),v=view(decoded);range(decoded,0,12);const flavor=v.getUint32(0),n=v.getUint16(4);if(flavor!==directory.flavor||n!==directory.tables.length)throw new Error('Decoded font source directory differs.');range(decoded,12,n*16);const expectedTables=new Map(directory.tables.map(t=>[t.tag,t])),seen=new Set<string>(),spans:{start:number;end:number}[]=[];let head:Uint8Array|undefined,maxp:Uint8Array|undefined;
 for(let i=0;i<n;i++){const at=12+i*16,tag=tagAt(decoded,at),offset=v.getUint32(at+8),length=v.getUint32(at+12),expected=expectedTables.get(tag);range(decoded,offset,length);if(!expected||seen.has(tag)||offset%4||offset<12+n*16||!expected.transformed&&length!==expected.length)throw new Error('Decoded font table identity differs.');seen.add(tag);spans.push({start:offset,end:offset+length});const body=decoded.subarray(offset,offset+length);if(tag==='head')head=body;if(tag==='maxp')maxp=body;let checksum=0;
  for(let p=0;p<length;p+=4){let word=0;for(let j=0;j<4;j++)word=word*256+(tag==='head'&&p===8?0:body[p+j]??0);checksum=(checksum+word)>>>0;if((p&16383)===0)yield;}
  if(checksum!==v.getUint32(at+4)||expected.checksum!==undefined&&checksum!==expected.checksum)throw new Error('Decoded font table checksum differs.');yield;
 }
 spans.sort((a,b)=>a.start-b.start);for(let i=1;i<spans.length;i++)if(spans[i].start<spans[i-1].end)throw new Error('Decoded font tables overlap.');
 if(!head||head.length<54||!maxp||maxp.length<6||view(head).getUint16(18)!==identity.unitsPerEm||view(maxp).getUint16(4)!==identity.glyphCount)throw new Error('Decoded font metadata differs from its retained source.');
 let sum=0;for(let p=0;p<decoded.length;p+=4){let word=0;for(let j=0;j<4;j++)word=word*256+(decoded[p+j]??0);sum=(sum+word)>>>0;if((p&16383)===0)yield;}if(sum!==0xb1b0afba)throw new Error('Decoded whole-font checksum differs.');
}
export async function verifyDecodedFontFingerprints(original:Uint8Array,result:DecodedFontWire):Promise<void>{if(result.sourceSha256!==await fontDigest(original)||result.decodedSha256!==await fontDigest(result.bytes))throw new Error('Decoded font fingerprint differs from its source.');}
