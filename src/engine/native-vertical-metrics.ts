import type {NativeFontMetric} from '../fonts/native-metrics';
/** Checked private selector SFNT tables retain original GID metrics. Native
 * bounds supply the platform's vertical-origin callback, independent of artwork
 * positions and alpha verification. VORG and missing-vmtx fallback stay distinct. */
export function captureVerticalMetricTables(bytes:Uint8Array){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tables=new Map<string,DataView>();
 if(bytes.length<12)throw new Error('Native font metrics require a complete SFNT directory.');const count=view.getUint16(4);if(12+count*16>bytes.length)throw new Error('Invalid native font metric directory.');
 for(let i=0;i<count;i++){const p=12+i*16,tag=String.fromCharCode(...bytes.subarray(p,p+4)),offset=view.getUint32(p+8),length=view.getUint32(p+12);if(offset+length>bytes.length||tables.has(tag))throw new Error('Invalid native font metric table.');tables.set(tag,new DataView(bytes.buffer,bytes.byteOffset+offset,length));}
 const head=tables.get('head'),maxp=tables.get('maxp'),hhea=tables.get('hhea'),hmtx=tables.get('hmtx');if(!head||head.byteLength<54||!maxp||maxp.byteLength<6||!hhea||hhea.byteLength<36||!hmtx)throw new Error('Native font metrics require original horizontal tables.');
 const upem=head.getUint16(18),glyphs=maxp.getUint16(4),horizontal=hhea.getUint16(34);if(!upem||!glyphs||!horizontal||horizontal>glyphs||hmtx.byteLength<horizontal*4+(glyphs-horizontal)*2)throw new Error('Invalid native horizontal font metrics.');
 const vhea=tables.get('vhea'),vmtx=tables.get('vmtx'),vorg=tables.get('VORG');let vertical=0;const origins=new Map<number,number>();
 if(vhea||vmtx){if(!vhea||vhea.byteLength<36||!vmtx)throw new Error('Invalid native vertical font tables.');vertical=vhea.getUint16(34);if(!vertical||vertical>glyphs||vmtx.byteLength<vertical*4+(glyphs-vertical)*2)throw new Error('Invalid native vertical font metrics.');}
 if(vorg){if(vorg.byteLength<8||vorg.getUint16(0)!==1||vorg.getUint16(2)!==0||vorg.byteLength<8+vorg.getUint16(6)*4)throw new Error('Invalid native VORG metrics.');for(let p=8;p<8+vorg.getUint16(6)*4;p+=4){const id=vorg.getUint16(p);if(id>=glyphs||origins.has(id))throw new Error('Invalid native VORG glyph.');origins.set(id,vorg.getInt16(p+2));}}
 return Object.freeze({upem,glyphs,metric(glyphId:number,em:number,m:TextMetrics):NativeFontMetric{
  if(!Number.isInteger(glyphId)||glyphId<0||glyphId>=glyphs)throw new Error('Native metric glyph ID differs from its source.');const scale=em/upem,tsb=vertical?vmtx!.getInt16(glyphId<vertical?glyphId*4+2:vertical*4+(glyphId-vertical)*2):undefined;
  return{glyphId,hAdvance:m.width,vAdvance:vertical?-Math.fround(vmtx!.getUint16(Math.min(glyphId,vertical-1)*4)*scale):-(m.fontBoundingBoxAscent+m.fontBoundingBoxDescent),vOriginX:Math.fround(hmtx!.getUint16(Math.min(glyphId,horizontal-1)*4)*scale)/2,vOriginY:vorg?Math.fround((origins.get(glyphId)??vorg.getInt16(4))*scale):tsb===undefined?m.fontBoundingBoxAscent:Math.fround(m.actualBoundingBoxAscent+Math.fround(tsb*scale)),extents:{xBearing:-m.actualBoundingBoxLeft,yBearing:m.actualBoundingBoxAscent,width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:-(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)}};
 }});
}
