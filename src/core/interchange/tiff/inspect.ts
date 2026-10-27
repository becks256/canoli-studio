import type {TiffImportReport,TiffPageReport} from './types';

const TYPE_BYTES:Record<number,number>={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,13:4,16:8,17:8,18:8};
const safe=(n:number)=>Number.isSafeInteger(n)&&n>=0;
export class TiffReader {
 little=true;big=false;
 constructor(readonly blob:Blob){}
 async bytes(at:number,length:number){if(!safe(at)||!safe(length)||!safe(at+length)||at+length>this.blob.size)throw new Error('TIFF offset/count exceeds the source file.');const bytes=new Uint8Array(await this.blob.slice(at,at+length).arrayBuffer());if(bytes.length!==length)throw new Error('Truncated TIFF data.');return bytes;}
 integer(view:DataView,at:number,big=false){const n=big?Number(view.getBigUint64(at,this.little)):view.getUint32(at,this.little);if(!safe(n))throw new Error('TIFF address exceeds exact browser addressing.');return n;}
 async header(){const b=await this.bytes(0,Math.min(16,this.blob.size));if(b.length<8||(b[0]!==73||b[1]!==73)&&(b[0]!==77||b[1]!==77))throw new Error('This is not a TIFF file.');this.little=b[0]===73;const v=new DataView(b.buffer),magic=v.getUint16(2,this.little);if(magic!==42&&magic!==43)throw new Error('Unsupported TIFF header.');this.big=magic===43;if(this.big&&(b.length<16||v.getUint16(4,this.little)!==8||v.getUint16(6,this.little)!==0))throw new Error('Unsupported BigTIFF address layout.');return this.integer(v,this.big?8:4,this.big);}
 async directory(at:number){const countBytes=this.big?8:2,countData=await this.bytes(at,countBytes),v=new DataView(countData.buffer),count=this.big?this.integer(v,0,true):v.getUint16(0,this.little);if(count>4096)throw new Error('TIFF directory exceeds the 4096-tag metadata budget.');const stride=this.big?20:12,data=await this.bytes(at+countBytes,count*stride+(this.big?8:4)),view=new DataView(data.buffer),fields=new Map<number,TiffField>();
  for(let i=0;i<count;i++){const p=i*stride,tag=view.getUint16(p,this.little),type=view.getUint16(p+2,this.little),n=this.integer(view,p+4,this.big),size=TYPE_BYTES[type];if(!size)throw new Error(`Unsupported TIFF field type ${type}.`);if(fields.has(tag))throw new Error('Duplicate TIFF directory tag.');const bytes=n*size;if(!safe(bytes))throw new Error('TIFF field size exceeds exact addressing.');const slot=p+(this.big?12:8),address=bytes<=(this.big?8:4)?at+countBytes+slot:this.integer(view,slot,this.big);if(!safe(address+bytes)||address+bytes>this.blob.size)throw new Error('TIFF field is outside its source file.');fields.set(tag,new TiffField(this,type,n,address,size));}
  return{fields,next:this.integer(view,count*stride,this.big)};
 }
}
export class TiffField {
 constructor(readonly reader:TiffReader,readonly type:number,readonly count:number,readonly address:number,readonly size:number){}
 async value(index=0){if(!Number.isSafeInteger(index)||index<0||index>=this.count)throw new Error('Missing TIFF field value.');if(![1,3,4,13,16,18].includes(this.type))throw new Error('TIFF structural field must use unsigned integers.');const b=await this.reader.bytes(this.address+index*this.size,this.size),v=new DataView(b.buffer);return this.type===1?b[0]:this.type===3?v.getUint16(0,this.reader.little):this.reader.integer(v,0,this.size===8);}
 async bytes(max:number){if(this.count*this.size>max)throw new Error('TIFF metadata exceeds the parser working budget.');return this.reader.bytes(this.address,this.count*this.size);}
}
export interface TiffPage {fields:Map<number,TiffField>;report:TiffPageReport;blockWidth:number;blockHeight:number;blocksAcross:number;blocksDown:number;alpha:number;palette?:Uint8Array;icc?:Uint8Array}
export interface InspectedTiff {reader:TiffReader;report:TiffImportReport;pages:TiffPage[]}
// ICC cicpType: byte 9 is the H.273 transfer code. Known PQ/HLG
// declarations require a separate HDR workflow even when RGB samples are 0..1.
function floatIccTransfer(profile:Uint8Array):number|undefined{
 if(profile.length<132)throw new Error('Float TIFF needs a complete ICC tag table.');const v=new DataView(profile.buffer,profile.byteOffset,profile.byteLength),count=v.getUint32(128);if(132+count*12>profile.length)throw new Error('Invalid float TIFF ICC tag table.');let transfer:number|undefined;
 for(let i=0;i<count;i++){const at=132+i*12,offset=v.getUint32(at+4),size=v.getUint32(at+8);if(offset+size>profile.length)throw new Error('Float TIFF ICC tag lies outside its source.');if(v.getUint32(at)===0x63696370){if(transfer!==undefined||size!==12||v.getUint32(offset)!==0x63696370||v.getUint32(offset+4)!==0)throw new Error('Invalid float TIFF ICC CICP declaration.');transfer=v.getUint8(offset+9);}}
 return transfer;
}
export async function inspectTiff(blob:Blob,progress?:(fraction:number|null)=>void):Promise<InspectedTiff>{
 const reader=new TiffReader(blob),visited=new Set<number>(),pages:TiffPage[]=[];let next=await reader.header();
 while(next){if(visited.has(next))throw new Error('Cyclic TIFF page directories.');if(pages.length>=256)throw new Error('TIFF exceeds the 256-page inspection budget.');visited.add(next);progress?.(null);const{fields:f,next:following}=await reader.directory(next);next=following;
  const get=async(tag:number,fallback?:number)=>f.has(tag)?f.get(tag)!.value():fallback===undefined?Promise.reject(new Error(`Missing TIFF tag ${tag}.`)):fallback;
  const width=await get(256),height=await get(257),orientation=await get(274,1),samples=await get(277,1),compression=await get(259,1),photometric=await get(262),planar=await get(284,1),bits=await get(258,1),unsupported:string[]=[],warnings:string[]=[];
  if(![width,height].every(n=>n>0&&n<=0xffffffff)||orientation<1||orientation>8||samples<1||samples>64)throw new Error('Invalid TIFF image geometry or sample layout.');
  const bitField=f.get(258);if(bitField){if(bitField.count!==1&&bitField.count!==samples)throw new Error('TIFF bit-depth table does not match samples.');for(let i=1;i<bitField.count;i++)if(await bitField.value(i)!==bits)unsupported.push('Mixed sample bit depths');}
  if(![1,5,8,32946,32773].includes(compression))unsupported.push(`Compression ${compression} (supported: raw, LZW, Deflate, PackBits)`);
  if(![0,1,2,3].includes(photometric))unsupported.push(`Photometric ${photometric} requires a different color decoder`);
  const sampleKind=await get(339,1),floating=sampleKind===3&&bits===32;
  if(!(floating?[0,1,2].includes(photometric):[1,2,4,8,16].includes(bits))||(photometric===2&&bits<8)||(photometric===3&&bits>8))unsupported.push(`Unsupported ${bits}-bit sample layout`);
  if(![1,2].includes(planar))unsupported.push(`Planar configuration ${planar}`);
  if(await get(266,1)!==1)unsupported.push('Reversed bit fill order');
  const sampleFormat=f.get(339);if(sampleFormat&&sampleFormat.count!==1&&sampleFormat.count!==samples)throw new Error('Invalid TIFF sample-format table.');if(sampleFormat)for(let i=0;i<sampleFormat.count;i++)if(await sampleFormat.value(i)!==sampleKind)unsupported.push('Mixed sample formats');if(sampleKind!==1&&!floating)unsupported.push('Unsupported signed or floating-point sample format');
  const predictor=await get(317,1);if(!(floating?[1,2,3]:[1,2]).includes(predictor)||predictor===2&&bits<8)unsupported.push(`Predictor ${predictor} for ${bits}-bit samples`);
  const colorSamples=photometric===2?3:1,extra=samples-colorSamples,alpha=extra===1&&f.get(338)?.count===1?await get(338):0;
  if(extra<0||extra>1||extra===1&&![1,2].includes(alpha))unsupported.push('Unspecified or multiple extra sample channels');
  const tiled=f.has(322)||f.has(323)||f.has(324)||f.has(325),blockWidth=tiled?await get(322):width,blockHeight=tiled?await get(323):Math.min(height,await get(278,0xffffffff));
  if(!blockWidth||!blockHeight||tiled&&(blockWidth%16||blockHeight%16))throw new Error('Invalid TIFF tile/strip geometry.');const blocksAcross=Math.ceil(width/blockWidth),blocksDown=Math.ceil(height/blockHeight),count=blocksAcross*blocksDown*(planar===2?samples:1),offsets=f.get(tiled?324:273),counts=f.get(tiled?325:279);
  if(!safe(count)||offsets?.count!==count||counts?.count!==count)throw new Error('TIFF block tables do not match image geometry.');
  let palette:Uint8Array|undefined,icc:Uint8Array|undefined;
  if(photometric===3){const table=f.get(320);if(!table||table.type!==3||table.count!==3*(2**bits))throw new Error('Invalid TIFF palette.');palette=await table.bytes(1536);}
  if(f.has(34675)){icc=await f.get(34675)!.bytes(16*1024*1024);if(icc.length<128||new TextDecoder().decode(icc.subarray(36,40))!=='acsp'||new DataView(icc.buffer,icc.byteOffset).getUint32(0)!==icc.length)throw new Error('Invalid TIFF ICC profile.');if(photometric!==2||new TextDecoder().decode(icc.subarray(16,20))!=='RGB ')unsupported.push('ICC profile requires an unsupported source color conversion');else warnings.push(floating?'Float RGB can use 32-bit linear editing or an explicitly converted sRGB8 editing proxy; the original profile and samples remain intact.':'Embedded RGB ICC is passed to browser color management; broader profile/device fidelity remains unverified.');}
  else warnings.push(floating?'Float TIFF has no ICC profile. Choose an explicit sRGB or linear-sRGB interpretation before importing.':'No embedded ICC profile: samples are interpreted as sRGB.');
  if(floating)warnings.push('sRGB8 editing requires explicit precision-loss consent and normalized SDR samples. Float32 linear editing preserves finite extended RGB. Nonfinite samples and invalid alpha reject in both modes; HDR transfer interpretation and tone mapping remain unsupported.');
  if(floating&&icc){const transfer=floatIccTransfer(icc);if(transfer===16||transfer===18)unsupported.push(`HDR ICC transfer ${transfer} requires its transfer-function integration; HDR tone mapping is not implemented. Finite extended values with a supported RGB profile can use float editing.`);}
  if(bits===16)warnings.push('Unsigned 16-bit TIFF input currently uses 8-bit editing conversion. Import requires explicit consent; original TIFF bytes remain intact.');
  warnings.push('Imports one selected page as a raster layer. Native TIFF layer/editing metadata is not reconstructed; original file bytes retain all pages and declarations.');
  const report:TiffPageReport={index:pages.length,width,height,orientation,bits,samples,compression,photometric,planar,canDecode:unsupported.length===0,requiresPrecisionLoss:bits===16||floating,hasIcc:!!icc,...(floating?{sampleFormat:3,requiresColorAssumption:!icc}:{}),unsupported:[...new Set(unsupported)],warnings};pages.push({fields:f,report,blockWidth,blockHeight,blocksAcross,blocksDown,alpha,palette,icc});
 }
 if(!pages.length)throw new Error('TIFF contains no image pages.');return{reader,pages,report:{version:1,bigTiff:reader.big,littleEndian:reader.little,pages:pages.map(p=>p.report)}};
}
