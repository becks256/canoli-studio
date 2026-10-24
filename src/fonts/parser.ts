import {fontDigest,fontFaceId,fontInspectOptionsSchema,fontPrepareOptionsSchema,fontInspectionSchema,fontPreparedBytesSchema,type FontFaceInfo,type FontInspection,type FontInspectOptions,type FontPrepareOptions,type FontPreparedBytes} from './types';
import {extractCollectionFace} from './sfnt';
import {create} from 'fontkit';

interface ParsedFace {
  type:string;familyName:string|null;subfamilyName:string|null;fullName:string|null;postscriptName:string|null;copyright:string|null;
  unitsPerEm:number;numGlyphs:number;italicAngle:number;
  variationAxes:Record<string,{name:string|null;min:number;default:number;max:number}>;
  'OS/2'?:{usWeightClass:number;usWidthClass:number;fsSelection:{italic:boolean;oblique:boolean}};
  directory:{tables:Record<string,{length:number}>};
  _getTableStream(tag:string):{buffer:Uint8Array;pos:number}|null;
}
type NativeFormat='ttf'|'otf'|'woff'|'woff2';
interface SelectedBytes {bytes:Uint8Array;format:NativeFormat;extracted:boolean;repacked:boolean;omittedTables:('DSIG')[]}
interface SourceIndex {format:FontInspection['format'];count:number;get(index:number):SelectedBytes}
const signature=(bytes:Uint8Array)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0);
function nativeFormat(bytes:Uint8Array):NativeFormat{
  if(bytes.length<12)throw new Error('Truncated font header.');
  switch(signature(bytes)){
    case 0x00010000:case 0x74727565:return 'ttf';
    case 0x4f54544f:return 'otf';
    case 0x774f4646:return 'woff';
    case 0x774f4632:return 'woff2';
    default:throw new Error('Unsupported native font header.');
  }
}
function indexSource(bytes:Uint8Array):SourceIndex{
  if(bytes.length<12)throw new Error('Truncated font header.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const range=(at:number,size:number,end=bytes.length)=>{if(!Number.isSafeInteger(at)||!Number.isSafeInteger(size)||at<0||size<0||at+size>end)throw new Error('Font collection range exceeds its source.');};
  const selected=(i:number,count:number)=>{if(!Number.isInteger(i)||i<0||i>=count)throw new Error('Font face index is outside the collection.');};
  if(signature(bytes)===0x74746366){
    const version=view.getUint32(4),count=view.getUint32(8);
    if(![0x00010000,0x00020000].includes(version)||!count)throw new Error('Invalid TrueType collection header.');
    range(12,count*4+(version===0x00020000?12:0));
    return{format:'ttc',count,get(i){selected(i,count);const extracted=extractCollectionFace(bytes,view.getUint32(12+i*4));return{bytes:extracted.bytes,format:nativeFormat(extracted.bytes),extracted:true,repacked:true,omittedTables:extracted.omittedTables as ('DSIG')[]};}};
  }
  if([0x00010000,0x74727565,0x4f54544f,0x774f4646,0x774f4632].includes(signature(bytes))){
    const format=nativeFormat(bytes);return{format,count:1,get(i){selected(i,1);return{bytes,format,extracted:false,repacked:false,omittedTables:[]};}};
  }
  // Resource-fork offsets are validated before touching any parser. Enumerate
  // only the requested page, without instantiating every face in a collection.
  range(0,16);const data=view.getUint32(0),map=view.getUint32(4),dataLength=view.getUint32(8),mapLength=view.getUint32(12);
  if(data<16||map<16||mapLength<30)throw new Error('Use a supported TTF, OTF, WOFF, WOFF2, TTC or SFNT datafork font.');
  range(data,dataLength);range(map,mapLength);
  if(data<map+mapLength&&data+dataLength>map)throw new Error('Font resource data overlaps its map.');
  const list=map+view.getUint16(map+24);range(list,2,map+mapLength);
  const typeCount=view.getUint16(list)+1;range(list+2,typeCount*8,map+mapLength);
  let refs=-1,count=0;
  for(let i=0;i<typeCount;i++){
    const at=list+2+i*8;if(view.getUint32(at)!==0x73666e74)continue;
    if(refs!==-1)throw new Error('Duplicate SFNT resource type.');
    count=view.getUint16(at+4)+1;refs=list+view.getUint16(at+6);range(refs,count*12,map+mapLength);
  }
  if(refs===-1)throw new Error('The resource file contains no SFNT fonts.');
  return{format:'dfont',count,get(i){
    selected(i,count);const resource=data+(view.getUint32(refs+i*12+4)&0xffffff);range(resource,4,data+dataLength);
    const size=view.getUint32(resource);range(resource+4,size,data+dataLength);
    const face=bytes.subarray(resource+4,resource+4+size),format=nativeFormat(face);
    if(format!=='ttf'&&format!=='otf')throw new Error('Datafork font resource is not an SFNT face.');
    return{bytes:face,format,extracted:true,repacked:false,omittedTables:[]};
  }};
}
function rawEmbeddingFlags(font:ParsedFace):number|null{
  const entry=font.directory.tables['OS/2'];if(!entry)return null;
  if(entry.length<10)throw new Error('Truncated font embedding metadata.');
  const stream=font._getTableStream('OS/2');
  if(!stream||stream.pos<0||stream.pos+10>stream.buffer.length)throw new Error('Invalid font embedding metadata range.');
  return new DataView(stream.buffer.buffer,stream.buffer.byteOffset,stream.buffer.byteLength).getUint16(stream.pos+8);
}
async function describe(font:ParsedFace,sourceHash:string,index:number):Promise<FontFaceInfo>{
  const id=await fontFaceId(sourceHash,index),os=font['OS/2'];
  const axes=Object.entries(font.variationAxes??{}).map(([tag,axis])=>({tag,...axis}));
  const weight=axes.find(a=>a.tag==='wght'),width=axes.find(a=>a.tag==='wdth');
  const weightMin=weight?Math.max(1,weight.min):Math.min(1000,Math.max(1,os?.usWeightClass||400));
  const weightMax=weight?Math.min(1000,weight.max):weightMin;
  if(weightMax<weightMin)throw new Error('The font weight axis is outside the native CSS range.');
  const widths=[50,62.5,75,87.5,100,112.5,125,150,200];
  const stretch=width?`${width.min}% ${width.max}%`:`${widths[(os?.usWidthClass??5)-1]??100}%`;
  const italicAxis=axes.find(a=>a.tag==='ital');
  const styles:('normal'|'italic'|'oblique')[]=italicAxis&&italicAxis.min<=0&&italicAxis.max>=1?['normal','italic']:
    [os?.fsSelection?.italic?'italic':os?.fsSelection?.oblique?'oblique':font.italicAngle?'italic':'normal'];
  return{index,id,cssFamily:`CanoliFont_${id}`,family:font.familyName??null,subfamily:font.subfamilyName??null,fullName:font.fullName??null,postscriptName:font.postscriptName??null,copyright:font.copyright??null,
    unitsPerEm:font.unitsPerEm,glyphCount:font.numGlyphs,weightClass:os?.usWeightClass??null,widthClass:os?.usWidthClass??null,embeddingFlags:rawEmbeddingFlags(font),axes,
    descriptors:styles.map(style=>({style,weight:weightMin===weightMax?String(weightMin):`${weightMin} ${weightMax}`,stretch}))};
}
export async function inspectFontBytes(input:Uint8Array,options:FontInspectOptions={},check:()=>void=()=>{}):Promise<FontInspection>{
  const bytes=new Uint8Array(input),settings=fontInspectOptionsSchema.parse(options);check();
  const source=indexSource(bytes),sha256=await fontDigest(bytes);check();
  if(settings.offset>=source.count)throw new Error('Font inspection offset is outside the collection.');
  const faces:FontFaceInfo[]=[];
  for(let i=settings.offset;i<Math.min(source.count,settings.offset+settings.limit);i++){
    check();const selected=source.get(i),font=create(selected.bytes)as ParsedFace;
    faces.push(await describe(font,sha256,i));check();
  }
  return fontInspectionSchema.parse({version:1,parser:'fontkit-2.0.4',format:source.format,byteLength:bytes.length,sha256,faceCount:source.count,offset:settings.offset,faces});
}
export async function prepareFontBytes(input:Uint8Array,options:FontPrepareOptions={},check:()=>void=()=>{}):Promise<FontPreparedBytes>{
  const bytes=new Uint8Array(input),settings=fontPrepareOptionsSchema.parse(options),source=indexSource(bytes);check();
  if(source.count>1&&settings.faceIndex===undefined)throw new Error('Choose an explicit face index from this font collection.');
  const faceIndex=settings.faceIndex??0,selected=source.get(faceIndex),report=await inspectFontBytes(bytes,{offset:faceIndex,limit:1},check);check();
  const type=selected.format==='otf'?'font/otf':`font/${selected.format}`;
  const renderBlob=new Blob([selected.bytes.slice().buffer],{type});
  return fontPreparedBytesSchema.parse({report,faceIndex,renderBlob,renderFormat:selected.format,renderSha256:await fontDigest(selected.bytes),extracted:selected.extracted,repacked:selected.repacked,omittedTables:selected.omittedTables});
}
