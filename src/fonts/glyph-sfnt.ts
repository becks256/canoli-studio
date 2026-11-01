import {sfntChecksum} from './sfnt';

/** Private already-shaped glyph access. Source files and public text stay intact. */
export const GLYPH_LAYOUT_TABLES=Object.freeze(['GSUB','GPOS','GDEF','BASE','JSTF','kern','kerx','morx','mort','ankr','trak','opbd','prop','feat','lcar','just','bsln','Silf','Glat','Gloc','Feat','Sill','DSIG']);
export interface GlyphSelectorBytes {bytes:Uint8Array;selectors:Uint32Array;glyphCount:number}
interface Sfnt {flavor:number;tables:Map<string,Uint8Array>;glyphCount:number}
const inside=(length:number,at:number,size:number)=>{if(!Number.isSafeInteger(at)||!Number.isSafeInteger(size)||at<0||size<0||at+size>length)throw new Error('Glyph font table exceeds its source.');};
const view=(b:Uint8Array)=>new DataView(b.buffer,b.byteOffset,b.byteLength);
function sfnt(bytes:Uint8Array):Sfnt{
 inside(bytes.length,0,12);const v=view(bytes),flavor=v.getUint32(0);if(![0x00010000,0x74727565,0x4f54544f].includes(flavor))throw new Error('Native glyph selectors require selected uncompressed TTF or OTF bytes.');
 const n=v.getUint16(4);inside(bytes.length,12,n*16);if(!n)throw new Error('Glyph font has no tables.');
 const tables=new Map<string,Uint8Array>(),ranges:{at:number;end:number}[]=[];
 for(let i=0;i<n;i++){const at=12+i*16,tag=String.fromCharCode(...bytes.subarray(at,at+4)),offset=v.getUint32(at+8),length=v.getUint32(at+12);inside(bytes.length,offset,length);if(tables.has(tag)||length&&offset<12+n*16)throw new Error('Invalid glyph font table directory.');tables.set(tag,bytes.subarray(offset,offset+length));if(length)ranges.push({at:offset,end:offset+length});}
 ranges.sort((a,b)=>a.at-b.at);for(let i=1;i<ranges.length;i++)if(ranges[i].at<ranges[i-1].end)throw new Error('Overlapping glyph font tables.');
 const head=tables.get('head'),maxp=tables.get('maxp');if(!head||head.length<54||!maxp||maxp.length<6||!tables.has('cmap'))throw new Error('Glyph font is missing its native header, glyph count or character map.');
 const glyphCount=view(maxp).getUint16(4);if(glyphCount<2)throw new Error('Glyph selectors require a nonzero source glyph.');return{flavor,tables,glyphCount};
}
interface CmapRecord {platform:number;encoding:number;offset:number}
function records(bytes:Uint8Array):CmapRecord[]{inside(bytes.length,0,4);const v=view(bytes);if(v.getUint16(0)!==0)throw new Error('Invalid glyph character map version.');const n=v.getUint16(2);inside(bytes.length,4,n*8);const out:CmapRecord[]=[],keys=new Set<string>();for(let i=0;i<n;i++){const at=4+i*8,platform=v.getUint16(at),encoding=v.getUint16(at+2),offset=v.getUint32(at+4),key=platform+':'+encoding;inside(bytes.length,offset,2);if(keys.has(key))throw new Error('Duplicate glyph character map encoding.');keys.add(key);out.push({platform,encoding,offset});}return out;}
function unicodeCmap(bytes:Uint8Array):{offset:number;format:number;length:number}{
 const rs=records(bytes),v=view(bytes);for(const [platform,encoding]of [[3,10],[0,6],[0,4],[3,1],[0,3],[0,2],[0,1],[0,0]]){const r=rs.find(r=>r.platform===platform&&r.encoding===encoding);if(!r)continue;const format=v.getUint16(r.offset);if(![0,4,6,10,12,13].includes(format))throw new Error('This native glyph selector requires a supported Unicode cmap format.');inside(bytes.length,r.offset,format>=10?8:4);const length=format>=10?v.getUint32(r.offset+4):v.getUint16(r.offset+2);inside(bytes.length,r.offset,length);return{offset:r.offset,format,length};}throw new Error('Native glyph selectors require an original Unicode character map.');
}
function* mappings(bytes:Uint8Array):Generator<[number,number]>{
 const {offset:o,format,length}=unicodeCmap(bytes),v=view(bytes),range=(at:number,size:number)=>{inside(o+length,at,size);if(at<o)throw new Error('Invalid glyph character map offset.');};
 if(format===0){range(o,262);for(let cp=0;cp<256;cp++)yield[cp,v.getUint8(o+6+cp)];}
 else if(format===4){range(o,16);const count=v.getUint16(o+6)/2;if(!Number.isInteger(count)||!count)throw new Error('Invalid segmented Unicode map.');const ends=o+14,starts=ends+count*2+2,deltas=starts+count*2,offsets=deltas+count*2;range(offsets,count*2);let previous=-1;for(let i=0;i<count;i++){const start=v.getUint16(starts+i*2),end=v.getUint16(ends+i*2),delta=v.getInt16(deltas+i*2),relative=v.getUint16(offsets+i*2);if(start>end||start<=previous)throw new Error('Overlapping Unicode glyph ranges.');previous=end;for(let cp=start;cp<=end;cp++){let glyph:number;if(relative){const at=offsets+i*2+relative+(cp-start)*2;range(at,2);glyph=v.getUint16(at);if(glyph)glyph=(glyph+delta)&65535;}else glyph=(cp+delta)&65535;yield[cp,glyph];}}}
 else if(format===6||format===10){const wide=format===10;range(o,wide?20:10);const first=wide?v.getUint32(o+12):v.getUint16(o+6),count=wide?v.getUint32(o+16):v.getUint16(o+8),at=o+(wide?20:10);range(at,count*2);if(first+count>0x110000)throw new Error('Unicode glyph range is invalid.');for(let i=0;i<count;i++)yield[first+i,v.getUint16(at+i*2)];}
 else{range(o,16);const count=v.getUint32(o+12);range(o+16,count*12);let previous=-1;for(let i=0;i<count;i++){const at=o+16+i*12,first=v.getUint32(at),last=v.getUint32(at+4),glyph=v.getUint32(at+8);if(first>last||last>0x10ffff||first<=previous)throw new Error('Overlapping or invalid Unicode glyph groups.');previous=last;for(let cp=first;cp<=last;cp++)yield[cp,format===13?glyph:glyph+cp-first];}}
}
function augmentedCmap(original:Uint8Array,map:Map<number,number>):Uint8Array{
 const groups:{first:number;last:number;glyph:number}[]=[];for(const [cp,glyph]of [...map].sort((a,b)=>a[0]-b[0])){const last=groups.at(-1);if(last&&last.last+1===cp&&last.glyph+cp-last.first===glyph)last.last=cp;else groups.push({first:cp,last:cp,glyph});}
 const rs=records(original).filter(r=>!(r.platform===0&&r.encoding===4||r.platform===3&&r.encoding===10));const header=4+(rs.length+2)*8,at=header+original.length,length=16+groups.length*12,bytes=new Uint8Array(at+length),v=view(bytes);bytes.set(original,header);
 const all=[...rs.map(r=>({...r,offset:header+r.offset})),{platform:0,encoding:4,offset:at},{platform:3,encoding:10,offset:at}].sort((a,b)=>a.platform-b.platform||a.encoding-b.encoding);v.setUint16(2,all.length);for(let i=0;i<all.length;i++){const p=4+i*8,r=all[i];v.setUint16(p,r.platform);v.setUint16(p+2,r.encoding);v.setUint32(p+4,r.offset);}
 v.setUint16(at,12);v.setUint32(at+4,length);v.setUint32(at+12,groups.length);groups.forEach((g,i)=>{const p=at+16+i*12;v.setUint32(p,g.first);v.setUint32(p+4,g.last);v.setUint32(p+8,g.glyph);});return bytes;
}
function pack(source:Sfnt,cmap:Uint8Array):Uint8Array{
 const tables=[...source.tables].filter(([tag])=>!GLYPH_LAYOUT_TABLES.includes(tag)).map(([tag,body])=>[tag,tag==='cmap'?cmap:body]as const);
 // SFNT directory order is unsigned byte order, independent of locale.
 tables.sort(([a],[b])=>a<b?-1:a>b?1:0);const n=tables.length,power=2**Math.floor(Math.log2(n));if(power*16>65535)throw new Error('Glyph font directory cannot represent its table count.');let size=12+n*16;for(const [,body]of tables)size+=Math.ceil(body.length/4)*4;if(!Number.isSafeInteger(size)||size>0xffffffff)throw new Error('Glyph font exceeds SFNT offsets.');
 const bytes=new Uint8Array(size),v=view(bytes);v.setUint32(0,source.flavor===0x4f54544f?source.flavor:0x00010000);v.setUint16(4,n);v.setUint16(6,power*16);v.setUint16(8,Math.log2(power));v.setUint16(10,n*16-power*16);let offset=12+n*16,head=0;
 tables.forEach(([tag,body],i)=>{const at=12+i*16;bytes.set(body,offset);for(let j=0;j<4;j++)v.setUint8(at+j,tag.charCodeAt(j));if(tag==='head'){head=offset;v.setUint32(offset+8,0);}v.setUint32(at+4,sfntChecksum(bytes.subarray(offset,offset+Math.ceil(body.length/4)*4)));v.setUint32(at+8,offset);v.setUint32(at+12,body.length);offset+=Math.ceil(body.length/4)*4;});v.setUint32(head+8,(0xb1b0afba-sfntChecksum(bytes))>>>0);return bytes;
}
export function isGlyphSelectorPoint(cp:number):boolean{return Number.isInteger(cp)&&(cp>=0xf0000&&cp<=0xffffd||cp>=0x100000&&cp<=0x10fffd||cp>=0xe000&&cp<=0xf8ff);}
/** No outline/hint/metric/axis/color table or authored mapping is overwritten. */
export function compileGlyphSelectors(input:Uint8Array,check:()=>void=()=>{}):GlyphSelectorBytes{
 check();const source=sfnt(input),map=new Map<number,number>();let visited=0;for(const [cp,glyph]of mappings(source.tables.get('cmap')!)){if(glyph>=source.glyphCount)throw new Error('Character map references a missing source glyph.');if(glyph)map.set(cp,glyph);if(++visited%1024===0)check();}
 const selectors=new Uint32Array(source.glyphCount);let cp=0xf0000;for(let glyph=1;glyph<source.glyphCount;glyph++){while(map.has(cp)||!isGlyphSelectorPoint(cp)){cp++;if(cp===0xffffe)cp=0x100000;if(cp===0x10fffe)cp=0xe000;if(cp>0xf8ff&&cp<0xf0000)throw new Error('No unassigned private Unicode selector remains.');}selectors[glyph]=cp;map.set(cp,glyph);cp++;if(cp===0xffffe)cp=0x100000;if(cp===0x10fffe)cp=0xe000;if(glyph%1024===0)check();}
 check();const bytes=pack(source,augmentedCmap(source.tables.get('cmap')!,map));check();return{bytes,selectors,glyphCount:source.glyphCount};
}
/** Cooperative complete source-table and character-map validation. */
export function* validateGlyphSelectorSteps(sourceBytes:Uint8Array,result:GlyphSelectorBytes):Generator<void>{
 if(!(result.bytes instanceof Uint8Array)||!(result.selectors instanceof Uint32Array))throw new Error('Invalid native glyph selector result.');const source=sfnt(sourceBytes),derived=sfnt(result.bytes);if(derived.flavor!==(source.flavor===0x4f54544f?source.flavor:0x00010000)||result.glyphCount!==source.glyphCount||derived.glyphCount!==source.glyphCount||result.selectors.length!==source.glyphCount||result.selectors[0]!==0)throw new Error('Native glyph selector identity differs.');
 let checksum=0;for(let i=0;i<result.bytes.length;i+=4){const b=result.bytes;checksum=(checksum+((b[i]??0)*0x1000000+(b[i+1]??0)*0x10000+(b[i+2]??0)*0x100+(b[i+3]??0)))>>>0;if(i%16384===0)yield;}if(checksum!==0xb1b0afba)throw new Error('Native glyph selector checksum differs.');
 const expected=[...source.tables.keys()].filter(tag=>!GLYPH_LAYOUT_TABLES.includes(tag));if(derived.tables.size!==expected.length||expected.some(tag=>!derived.tables.has(tag)))throw new Error('Native glyph selector table set differs.');
 for(const tag of expected){if(tag==='cmap')continue;const a=source.tables.get(tag)!,b=derived.tables.get(tag)!;if(a.length!==b.length)throw new Error('Native glyph selector altered source '+tag+' bytes.');for(let i=0;i<a.length;i++){if(!(tag==='head'&&i>=8&&i<12)&&a[i]!==b[i])throw new Error('Native glyph selector altered source '+tag+' bytes.');if(i%16384===0)yield;}}
 const original=new Map<number,number>(),actual=new Map<number,number>();let visited=0;
 for(const entry of mappings(source.tables.get('cmap')!)){if(entry[1])original.set(...entry);if(++visited%1024===0)yield;}
 for(const entry of mappings(derived.tables.get('cmap')!)){if(entry[1])actual.set(...entry);if(++visited%1024===0)yield;}
 for(const [cp,glyph]of original){if(actual.get(cp)!==glyph)throw new Error('Native glyph selector altered an authored character mapping.');if(++visited%1024===0)yield;}
 const seen=new Set<number>();for(let glyph=1;glyph<source.glyphCount;glyph++){const cp=result.selectors[glyph];if(!isGlyphSelectorPoint(cp)||seen.has(cp)||original.has(cp)||actual.get(cp)!==glyph)throw new Error('Native glyph selector map differs.');seen.add(cp);if(glyph%1024===0)yield;}
 if(actual.size!==original.size+source.glyphCount-1)throw new Error('Native glyph selector added unexpected mappings.');
}
export function validateGlyphSelectors(sourceBytes:Uint8Array,result:GlyphSelectorBytes):void{for(const _ of validateGlyphSelectorSteps(sourceBytes,result))void _;}
