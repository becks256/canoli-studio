import type {SvgFontSource} from '../core/svg-css-import';
import type {SvgTextPlacement} from '../core/svg-import';
import {fontFamilyParts} from '../core/font-families';
import {applyTextStyle,nativeTextFont} from '../core/text-style';
import {Document,TextLayer,FontFile,AffineTransform} from '../dom';
import type {FontSourceStore} from '../fonts/store';
import type {FontResource} from '../fonts/resources';
import type {AssetStore} from '../core/assets';
import type {SvgImportControl} from '../core/svg-import';
import {createCanvas,release} from './canvas';
import type {TextLayerData} from '../core/model';
import {characterInputForLayer,measureCharacterText} from '../core/character-layout';
import {normalizeCharacterRanges} from '../core/text-ranges';

interface PreparedSvgFont extends SvgFontSource {resource:Readonly<FontResource>}
const widths:Record<string,number>={'ultra-condensed':50,'extra-condensed':62.5,condensed:75,'semi-condensed':87.5,normal:100,'semi-expanded':112.5,expanded:125,'extra-expanded':150,'ultra-expanded':200};
function range(value:string,stretch=false):[number,number]{
 value=value.trim();const keyword=stretch?widths[value]:value==='normal'?400:value==='bold'?700:undefined;
 const values=keyword===undefined?value.split(/\s+/).map(n=>Number(n.replace(/%$/,''))):[keyword];
 if(values.length>2||!values.length||values.some(n=>!Number.isFinite(n)||n<=0||!stretch&&n>1000)||values.length===2&&values[0]>values[1])throw new Error('Invalid SVG font matching range.');
 return[values[0],values[1]??values[0]];
}
const sameRange=(a:string,b:string,stretch=false)=>JSON.stringify(range(a,stretch))===JSON.stringify(range(b,stretch));

/** Parsing and FontFace.load are private; registration happens only later in
 * one synchronous reconstruction scope, with no callbacks or awaits. */
export async function prepareSvgFontSources(inputs:readonly SvgFontSource[],store:FontSourceStore,control:SvgImportControl,check:()=>void,requireMatching=true):Promise<PreparedSvgFont[]>{
 const result:PreparedSvgFont[]=[];
 for(const input of inputs){
  let resource:Readonly<FontResource>|undefined,last:unknown;
  for(const source of input.sources){
   check();control.signal?.throwIfAborted();
   try{resource=await store.prepare(source,{}, {signal:control.signal});check();break;}
   catch(error){check();control.signal?.throwIfAborted();last=error;}
  }
  if(!resource)throw new Error('Embedded SVG font could not be prepared: '+String(last));
  // The current document font contract derives matching descriptors from the
  // original. Arbitrary CSS overrides must not silently change synthesis.
  if(requireMatching&&!resource.descriptor.report.faces[0].descriptors.some(face=>face.style===input.style&&sameRange(face.weight,input.weight)&&sameRange(face.stretch,input.stretch,true)))throw new Error('SVG font-face matching overrides differ from the original face; choose flattened import.');
  result.push({...input,resource});
 }
 return result;
}

/** CSS weight search order, including the special 400–500 interval. */
function weightRank(value:[number,number],target:number):[number,number]{
 if(value[0]<=target&&target<=value[1])return[0,0];
 if(target>=400&&target<=500){if(value[0]>target&&value[0]<=500)return[1,value[0]-target];if(value[1]<target)return[2,target-value[1]];return[3,value[0]-target];}
 if(target<400)return value[1]<target?[1,target-value[1]]:[2,value[0]-target];
 return value[0]>target?[1,value[0]-target]:[2,target-value[1]];
}
function widthRank(value:[number,number],target:number):[number,number]{
 if(value[0]<=target&&target<=value[1])return[0,0];
 return target<=100?(value[1]<target?[1,target-value[1]]:[2,value[0]-target]):(value[0]>target?[1,value[0]-target]:[2,target-value[1]]);
}
const compare=(a:readonly number[],b:readonly number[])=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};

export function reconstructSvgTexts(doc:Document,placements:readonly SvgTextPlacement[],mappings:readonly PreparedSvgFont[],store:FontSourceStore,assets:AssetStore){
 if(!placements.length)return;
 const canvas=createCanvas(1,1),context=canvas.getContext('2d')!;
 try{
  for(const placement of placements){
   const layer=doc.getLayer(placement.layerId);if(!(layer instanceof TextLayer))throw new Error('Invalid SVG text placement.');
   const source=layer.toJSON() as TextLayerData,selected=new Map<string,Readonly<FontResource>>();
   const remap=(format:Pick<TextLayerData,'fontFamily'|'fontWeight'|'fontStyle'|'fontStretch'>)=>{
    const weight=format.fontWeight==='bold'?700:format.fontWeight==='normal'||!format.fontWeight?400:Number(format.fontWeight),stretch=widths[format.fontStretch??'normal'];
    return fontFamilyParts(format.fontFamily).map(part=>{
    const choices=mappings.map((font,index)=>({font,index})).filter(({font})=>font.family===part.name);
    if(!choices.length){if(/^canolifont_[a-f0-9]{64}$/i.test(part.name))throw new Error('SVG refers to missing embedded font bytes.');return part.raw;}
    choices.sort((a,b)=>compare([...widthRank(range(a.font.stretch,true),stretch),a.font.style===(format.fontStyle??'normal')?0:1,...weightRank(range(a.font.weight),weight),-a.index],[...widthRank(range(b.font.stretch,true),stretch),b.font.style===(format.fontStyle??'normal')?0:1,...weightRank(range(b.font.weight),weight),-b.index]));
    const resource=choices[0].font.resource;
    selected.set(resource.id,resource);
    return resource.descriptor.report.faces[0].cssFamily;
   }).join(',');};
   const family=remap(source),ranges=placement.characterRanges===undefined?undefined:normalizeCharacterRanges(source.text,placement.characterRanges).map(range=>({...range,format:{...range.format,fontFamily:remap({...source,...range.format})}}));
   for(const resource of selected.values()){
    if(!assets.fonts.has(resource.id))store.shareTo(assets.fonts,resource.id);
    doc.fonts.files.add(new FontFile({id:resource.id,name:(resource.descriptor.report.faces[0].fullName??resource.cssFamily).slice(0,240),resource:resource.descriptor}));
   }
   layer.update({fontFamily:family,...(ranges===undefined?{}:{characterRanges:ranges})});
   const text=layer.toJSON() as TextLayerData;
   if(ranges!==undefined){
    const layout=measureCharacterText(characterInputForLayer(text)),first=layout.lines[0];if(layout.accuracy!=='native'||!first||layout.lines.length!==1)throw new Error('SVG inline character reconstruction requires one native logical line.');
    const shiftX=placement.x-first.x,shiftY=placement.y-first.y;
    layer.transform=layer.transform.multiply(AffineTransform.translation(shiftX,shiftY));continue;
   }
   layer.reflow();applyTextStyle(context,text);context.textAlign=text.align;
   if(globalThis.document?.fonts&&!globalThis.document.fonts.check(nativeTextFont(text),text.text||'M'))throw new Error('A referenced SVG font is still loading. Retry after fonts are ready.');
   // Undo the exact top-to-alphabetic relation used by native SVG export.
   context.textBaseline='alphabetic';const alphabetic=context.measureText(text.text||'M').actualBoundingBoxAscent;
   context.textBaseline='top';const top=context.measureText(text.text||'M').actualBoundingBoxAscent;
   const shiftX=placement.x-(text.align==='right'?text.width:text.align==='center'?text.width/2:0),shiftY=placement.y-alphabetic+top;
   if(!Number.isFinite(shiftX)||!Number.isFinite(shiftY))throw new Error('The browser cannot measure imported SVG text baselines.');
   layer.transform=layer.transform.multiply(AffineTransform.translation(shiftX,shiftY));
  }
 }finally{release(canvas);}
}
