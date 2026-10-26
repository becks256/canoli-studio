import {z} from 'zod';
import {characterFormatSchema,characterFormatPatchSchema,definedCharacterFormat,type CharacterFormat,type CharacterFormatPatch} from './character-format';
import type {TextMeasurementRange} from './text-layout';

const offset=z.number().int().min(0).max(10000);
export const characterRangeSchema=z.object({start:offset,end:offset,format:characterFormatPatchSchema}).strict();
export interface CharacterRangeData {readonly start:number;readonly end:number;readonly format:Readonly<CharacterFormatPatch>}
const same=(a:CharacterFormatPatch,b:CharacterFormatPatch)=>Object.keys(characterFormatSchema.shape).every(key=>a[key as keyof CharacterFormat]===b[key as keyof CharacterFormat]);
function boundary(text:string,value:number){
  if(!Number.isInteger(value)||value<0||value>text.length)throw new Error('Character range is outside its text.');
  if(value>0&&value<text.length&&/[\ud800-\udbff]/.test(text[value-1])&&/[\udc00-\udfff]/.test(text[value]))throw new Error('A character range cannot split a Unicode surrogate pair.');
}
/** Internal source-indexed serialization; OO mutations will own publication. */
export function normalizeCharacterRanges(text:string,input:readonly CharacterRangeData[]):readonly CharacterRangeData[]{
  z.string().max(10000).parse(text);const values=z.array(characterRangeSchema).max(10000).parse(input),result:{start:number;end:number;format:Readonly<CharacterFormatPatch>}[]=[];let previous=0;
  for(const range of values){
    boundary(text,range.start);boundary(text,range.end);
    if(range.end<=range.start||range.start<previous)throw new Error('Character ranges must be nonempty, ordered and nonoverlapping.');previous=range.end;
    const format=Object.freeze(definedCharacterFormat(range.format));if(!Object.keys(format).length)continue;
    const last=result.at(-1);if(last?.end===range.start&&same(last.format,format))last.end=range.end;else result.push({...range,format});
  }
  return Object.freeze(result.map(range=>Object.freeze(range)));
}
const EMPTY_FORMAT:Readonly<CharacterFormatPatch>=Object.freeze({});
function formatAt(ranges:readonly CharacterRangeData[],index:number):Readonly<CharacterFormatPatch>{
  let low=0,high=ranges.length-1;
  while(low<=high){const middle=(low+high)>>>1,range=ranges[middle];if(index<range.start)high=middle-1;else if(index>=range.end)low=middle+1;else return range.format;}
  return EMPTY_FORMAT;
}
export function resolvedCharacterFormat(ranges:readonly CharacterRangeData[],base:Readonly<CharacterFormat>,index:number):Readonly<CharacterFormat>{return Object.freeze(characterFormatSchema.parse({...base,...formatAt(ranges,index)}));}

/** Overlay an authored format, or clear the selected range with null. */
export function formatCharacterRange(text:string,input:readonly CharacterRangeData[],start:number,end:number,patch:CharacterFormatPatch|null):readonly CharacterRangeData[]{
  const ranges=normalizeCharacterRanges(text,input);boundary(text,start);boundary(text,end);if(end<=start)throw new Error('Choose a nonempty character range.');
  const format=patch===null?null:definedCharacterFormat(characterFormatPatchSchema.parse(patch)),bounds=[...new Set([0,text.length,start,end,...ranges.flatMap(range=>[range.start,range.end])])].sort((a,b)=>a-b),result:CharacterRangeData[]=[];
  for(let i=0;i<bounds.length-1;i++){const a=bounds[i],b=bounds[i+1],old=formatAt(ranges,a),selected=a>=start&&b<=end;result.push({start:a,end:b,format:selected?(format===null?{}:{...old,...format}):old});}
  return normalizeCharacterRanges(text,result);
}

/** Replace source text while retaining unaffected formatting and explicit
 * insertion affinity. A selection inherits its first character by default. */
export function editCharacterRanges(text:string,input:readonly CharacterRangeData[],start:number,end:number,replacement:string,affinity:'before'|'after'=end>start?'after':'before'):{text:string;ranges:readonly CharacterRangeData[]}{
  const ranges=normalizeCharacterRanges(text,input);boundary(text,start);boundary(text,end);if(end<start)throw new Error('Character edit endpoints must be ordered.');
  if(affinity!=='before'&&affinity!=='after')throw new Error('Character insertion affinity must be before or after.');
  z.string().parse(replacement);const next=text.slice(0,start)+replacement+text.slice(end);z.string().max(10000).parse(next);
  const point=Math.max(0,Math.min(text.length-1,start-(affinity==='before'&&start>0?1:0))),inherited=formatAt(ranges,point),delta=replacement.length-(end-start),result:CharacterRangeData[]=[];
  for(const range of ranges)if(range.start<start)result.push({...range,end:Math.min(start,range.end)});
  if(replacement.length)result.push({start,end:start+replacement.length,format:inherited});
  for(const range of ranges)if(range.end>end)result.push({...range,start:Math.max(end,range.start)+delta,end:range.end+delta});
  return{text:next,ranges:normalizeCharacterRanges(next,result)};
}

/** Whole-string setters keep the longest unchanged prefix/suffix. Explicit
 * replaceText retains the user's selected interval and affinity instead. */
export function replaceCharacterText(text:string,ranges:readonly CharacterRangeData[],replacement:string):readonly CharacterRangeData[]{
 if(text===replacement)return normalizeCharacterRanges(text,ranges);let start=0;while(start<text.length&&start<replacement.length&&text[start]===replacement[start])start++;
 if(start>0&&/[\ud800-\udbff]/.test(text[start-1])&&(/[\udc00-\udfff]/.test(text[start]??'')||/[\udc00-\udfff]/.test(replacement[start]??'')))start--;
 let oldEnd=text.length,newEnd=replacement.length;while(oldEnd>start&&newEnd>start&&text[oldEnd-1]===replacement[newEnd-1]){oldEnd--;newEnd--;}
 if(oldEnd>start&&/[\ud800-\udbff]/.test(text[oldEnd-1])&&/[\udc00-\udfff]/.test(text[oldEnd]??'')){oldEnd++;newEnd++;}
 return editCharacterRanges(text,ranges,start,oldEnd,replacement.slice(start,newEnd)).ranges;
}

/** Project an original source range into one native visual line. Consumed
 * whitespace and discretionary hyphens retain their original style identity. */
export function characterLineSpans(text:string,ranges:readonly CharacterRangeData[],base:Readonly<CharacterFormat>,range:Readonly<TextMeasurementRange>,wrapped:boolean):{text:string;style:Readonly<CharacterFormat>}[]{
  const raw=text.slice(range.start,range.end);let bodyEnd=range.end;
  if(wrapped){if(range.softBreak)bodyEnd=range.start+raw.replace(/[ \t\r\f]+$/g,'').length;if(/[\u2028\u2029]/u.test(text[bodyEnd-1]??''))bodyEnd--;}
  const result:{text:string;style:Readonly<CharacterFormat>}[]=[],styles=new Map<Readonly<CharacterFormatPatch>,Readonly<CharacterFormat>>();
  const append=(value:string,index:number)=>{
    const format=formatAt(ranges,index);let style=styles.get(format);if(!style){style=Object.freeze(characterFormatSchema.parse({...base,...format}));styles.set(format,style);}const previous=result.at(-1);
    if(previous&&same(previous.style,style))previous.text+=value;else result.push({text:value,style});
  };
  for(let i=range.start;i<bodyEnd;){const point=text.codePointAt(i)!,value=String.fromCodePoint(point);if(!wrapped||value!=='\u00ad')append(/[\t\r\f]/.test(value)?' ':value,i);i+=value.length;}
  if(wrapped&&range.softBreak&&raw.endsWith('\u00ad'))append('-',range.end-1);
  return result;
}
