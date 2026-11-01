import {nativeMetricPosition} from './native-metrics';
import * as hb from '../generated/font-shaper-runtime.mjs';
import {resolveFontRunSettings} from './css-instance';
import {parseFontVariations} from '../core/font-variations';
import {normalizeFontRun,validateFontRun,type FontRunInput,type FontRunResult} from './shaping-types';
/** Source-font shaping only. It does not perform bidi/fallback itemization or
 * establish equivalence with a browser's complete native layout. */
export function shapeFontRun(bytes:Uint8Array,input:FontRunInput,settings='normal',check:()=>void=()=>{}):FontRunResult{
 const request=normalizeFontRun(input);check();if(hb.versionString()!=='15.0.0')throw new Error('Unexpected pinned HarfBuzz runtime.');
 const blob=new hb.Blob(bytes),face=new hb.Face(blob,0),base=new hb.Font(face),buffer=new hb.Buffer(),maxp=face.referenceTable('maxp');
 if(!maxp||maxp.length<6||!Number.isInteger(face.upem)||face.upem<1||face.upem>65535)throw new Error('Shaping requires an original selected SFNT font.');
 const glyphCount=new DataView(maxp.buffer,maxp.byteOffset,maxp.byteLength).getUint16(4);base.setScale(face.upem*64,face.upem*64);const effective=resolveFontRunSettings(Object.values(face.getAxisInfos()),settings,request.css);base.setVariations(parseFontVariations(effective).map(axis=>new hb.Variation(axis.tag,axis.value)));
 const projection=request.nativeMetrics,scale=projection?nativeMetricPosition(projection.em):face.upem*64;let font=base;
 if(projection){if(projection.glyphs.some(g=>g.glyphId>=glyphCount))throw new Error('Native font metrics differ from their retained source glyph IDs.');base.setScale(scale,scale);font=base.subFont();const funcs=new hb.FontFuncs(),rows=new Map(projection.glyphs.map(g=>[g.glyphId,g]));
  funcs.setGlyphHAdvanceFunc((_,id)=>rows.has(id)?nativeMetricPosition(rows.get(id)!.hAdvance):base.glyphHAdvance(id));funcs.setGlyphVAdvanceFunc((_,id)=>rows.has(id)?nativeMetricPosition(rows.get(id)!.vAdvance):base.glyphVAdvance(id));funcs.setGlyphVOriginFunc((_,id)=>rows.has(id)?[nativeMetricPosition(rows.get(id)!.vOriginX),nativeMetricPosition(rows.get(id)!.vOriginY)]:base.glyphVOrigin(id));funcs.setGlyphExtentsFunc((_,id)=>{const e=rows.get(id)?.extents;return e?{xBearing:nativeMetricPosition(e.xBearing),yBearing:nativeMetricPosition(e.yBearing),width:nativeMetricPosition(e.width),height:nativeMetricPosition(e.height)}:base.glyphExtents(id);});font.setFuncs(funcs);
 }const toSource=face.upem/scale;
 buffer.addText(request.text,request.itemOffset,request.itemLength);buffer.setDirection({ltr:hb.Direction.LTR,rtl:hb.Direction.RTL,ttb:hb.Direction.TTB,btt:hb.Direction.BTT}[request.direction]);if(request.script)buffer.setScript(request.script);buffer.setLanguage(request.language);buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_GRAPHEMES);buffer.guessSegmentProperties();check();
 if(request.nominal){let cluster=request.itemOffset;const glyphs=[];for(const character of request.text.slice(request.itemOffset,request.itemOffset+request.itemLength)){const glyphId=font.nominalGlyph(character.codePointAt(0)!)??0,vertical=request.direction==='ttb',origin=vertical?font.glyphVOrigin(glyphId):[0,0];if(!origin)throw new Error('Original nominal vertical glyph origin is unavailable.');glyphs.push({glyphId,cluster,flags:0,xAdvance:vertical?0:font.glyphHAdvance(glyphId)*toSource,yAdvance:vertical?font.glyphVAdvance(glyphId)*toSource:0,xOffset:vertical?-origin[0]*toSource:0,yOffset:vertical?-origin[1]*toSource:0});cluster+=character.length;check();}const result:FontRunResult={version:1,engine:'HarfBuzz 15.0.0',unitsPerEm:face.upem,glyphCount,glyphs};validateFontRun(result,request,effective,{unitsPerEm:face.upem,glyphCount});return result;}
 hb.shape(font,buffer,request.features.map(feature=>new hb.Feature(feature.tag,feature.value)));check();
 const infos=buffer.getGlyphInfos(),positions=buffer.getGlyphPositions();if(infos.length!==positions.length)throw new Error('Inconsistent shaped glyph buffers.');
 const result:FontRunResult={version:1,engine:'HarfBuzz 15.0.0',unitsPerEm:face.upem,glyphCount,glyphs:infos.map((info,i)=>({glyphId:info.codepoint,cluster:info.cluster,flags:info.flags,xAdvance:positions[i].xAdvance*toSource,yAdvance:positions[i].yAdvance*toSource,xOffset:positions[i].xOffset*toSource,yOffset:positions[i].yOffset*toSource}))};
 validateFontRun(result,request,effective,{unitsPerEm:face.upem,glyphCount});check();return result;
}
