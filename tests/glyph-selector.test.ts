import {it,expect,beforeAll} from 'vitest';
import {readFile} from 'node:fs/promises';
import {create} from 'fontkit';
import {compileGlyphSelectors,validateGlyphSelectors} from '../src/fonts/glyph-sfnt';
import {renderFloatGlyphs,type FloatGlyph} from '../src/engine/float-glyph';
import {AffineTransform} from '../src/core/affine';
import {FloatPixelProcessor} from '../src/engine/float-pixels';
import {instantiateKernel} from '../src/engine/wasm';
import type {NativeGlyphFont} from '../src/engine/native-glyph-font';
interface Font {glyphForCodePoint(cp:number):{id:number;path:{toSVG():string};advanceWidth:number};characterSet:number[]}
for(const path of ['fonts/Regular.ttf','fonts/CFF.otf','font-variations/Axes.ttf','vertical-font/Vertical.ttf'])it('retains every authored Unicode mapping, glyph outline and advance: '+path,async()=>{
 const original=new Uint8Array(await readFile('tests/fixtures/'+path)),before=Uint8Array.from(original),result=compileGlyphSelectors(original);validateGlyphSelectors(original,result);
 const source=create(original)as Font,derived=create(result.bytes)as Font;
 expect(original).toEqual(before);for(const cp of source.characterSet){const a=source.glyphForCodePoint(cp),b=derived.glyphForCodePoint(cp);expect(b.id).toBe(a.id);expect(b.path.toSVG()).toBe(a.path.toSVG());expect(b.advanceWidth).toBe(a.advanceWidth);}
 for(let glyph=1;glyph<result.glyphCount;glyph++)expect(derived.glyphForCodePoint(result.selectors[glyph]).id).toBe(glyph);
});
it('rejects malformed and compressed input, corrupt worker selectors and changed source tables',async()=>{
 const source=new Uint8Array(await readFile('tests/fixtures/fonts/Regular.ttf'));
 for(const input of [new Uint8Array(),source.subarray(0,50),new Uint8Array(await readFile('tests/fixtures/fonts/Regular.woff'))])expect(()=>compileGlyphSelectors(input)).toThrow();
 const a=compileGlyphSelectors(source);a.selectors[1]=a.selectors[2];expect(()=>validateGlyphSelectors(source,a)).toThrow('map differs');
 const b=compileGlyphSelectors(source);b.bytes[b.bytes.length-1]^=1;expect(()=>validateGlyphSelectors(source,b)).toThrow();
 expect(()=>compileGlyphSelectors(source,()=>{throw new Error('Cancelled native selectors');})).toThrow('Cancelled native selectors');
});
let native:FloatPixelProcessor;beforeAll(async()=>{native=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));});
const processor={floatComposite:async(...args:Parameters<FloatPixelProcessor['composite']>)=>native.composite(...args)};
const font:NativeGlyphFont=Object.freeze({axes:[],descriptors:[{style:'normal' as const,weight:'400',stretch:'100%'}],sourceFamily:'OriginalGlyph',family:'PrivateGlyph',glyphCount:3,settings:'normal',monochrome:true,async shapeRun(){throw new Error('Resolved glyph paint must not invoke shaping.');},character:()=>String.fromCodePoint(0xf0000),check(){},release(){}});
const primitive=(color:readonly[number,number,number,number]):FloatGlyph=>({font,glyphId:2,style:{fontSize:40,fontWeight:'400',fontStyle:'normal'},color,transform:new AffineTransform()});
const area={x:0,y:0,width:1,height:1};
it('native glyph paint keeps signed HDR RGB and per-glyph alpha in actual WASM, including sub-byte overlap',async()=>{
 for(const alpha of [.5,.64123012345,1e-8]){const color=[4,-.25,1.5,alpha]as const,a=Math.fround(alpha),result=await renderFloatGlyphs([primitive(color),primitive(color)],area,processor,()=>{},async()=>new Float32Array([1]));expect(result).toEqual(new Float32Array([4,-.25,1.5,a+a*(1-a)]));}
 const a=.375,b=.625,actual=await renderFloatGlyphs([primitive([4,-.25,1.5,a]),primitive([-.5,3,.125,b])],area,processor,()=>{},async()=>new Float32Array([1])),alpha=b+a*(1-b);expect(actual).toEqual(new Float32Array([(-.5*b+4*a*(1-b))/alpha,(3*b-.25*a*(1-b))/alpha,(.125*b+1.5*a*(1-b))/alpha,alpha]));
});
it('coverage and source alpha multiply once, caller mutations cannot retarget a captured primitive',async()=>{
 const source=[primitive([4,-.25,1.5,.64123])],mask=Math.fround(17/255),expected=new Float32Array([4,-.25,1.5,Math.fround(.64123)*mask]);let changed=false;
 const result=await renderFloatGlyphs(source,area,processor,()=>{},async()=>{if(!changed){changed=true;source[0]=primitive([0,0,0,0]);}return new Float32Array([mask]);});expect(result).toEqual(expected);
});
it('native baseline and computed-size projections snapshot before awaits and reject nonfinite geometry',async()=>{
 const origin={x:3,y:4},source={...primitive([4,-.25,1.5,.5]),origin,paintFontSize:13.64123012345};let captured=false;
 const actual=await renderFloatGlyphs([source],area,processor,()=>{},async glyph=>{origin.x=999;captured=glyph.origin!.x===3&&Object.isFrozen(glyph.origin)&&glyph.paintFontSize===13.64123012345;return new Float32Array([1]);});expect(captured).toBe(true);expect(actual).toEqual(new Float32Array([4,-.25,1.5,.5]));
 for(const bad of [{...source,origin:{x:Infinity,y:0}},{...source,paintFontSize:0},{...source,paintFontSize:NaN},{...source,surface:'unknown'as 'svg'}])await expect(renderFloatGlyphs([bad],area,processor,()=>{},async()=>new Float32Array([1]))).rejects.toThrow('placement');
});
it('invalid coverage, retired owners, unsupported intrinsic color and malformed worker output cannot publish',async()=>{
 for(const mask of [new Float32Array(),new Float32Array([NaN]),new Float32Array([1.1])])await expect(renderFloatGlyphs([primitive([1,0,0,1])],area,processor,()=>{},async()=>mask)).rejects.toThrow();
 await expect(renderFloatGlyphs([primitive([1,0,0,1])],area,{floatComposite:async()=>new Float32Array(8)},()=>{},async()=>new Float32Array([1]))).rejects.toThrow('geometry');
 await expect(renderFloatGlyphs([{...primitive([1,0,0,1]),font:{...font,monochrome:false}}],area,processor,()=>{})).rejects.toThrow('intrinsic color-font');
 let cancelled=false;await expect(renderFloatGlyphs([primitive([1,0,0,1])],area,processor,()=>{if(cancelled)throw new Error('Owner retired');},async()=>{cancelled=true;return new Float32Array([1]);})).rejects.toThrow('Owner retired');
});
it('resolved native baselines and rotations snapshot before coverage and reject invalid paint',async()=>{
 const path={data:'M24 150C100 30 340 30 420 150',startOffset:210,baselineOffset:-7},source={...primitive([4,-.25,1.5,.5]),surface:'svg'as const,path,rotation:12};let captured=false;
 const actual=await renderFloatGlyphs([source],area,processor,()=>{},async glyph=>{path.data='M0 0H1';path.startOffset=999;source.rotation=90;captured=glyph.path!.startOffset===210&&glyph.path!.data==='M24 150C100 30 340 30 420 150'&&Object.isFrozen(glyph.path)&&glyph.rotation===12;return new Float32Array([1]);});expect(captured).toBe(true);expect(actual).toEqual(new Float32Array([4,-.25,1.5,.5]));
 for(const bad of [{...source,rotation:NaN},{...source,surface:undefined},{...source,path:{...path,startOffset:Infinity}},{...source,path:{...path,baselineOffset:NaN}},{...source,path:{...path,data:''}}])await expect(renderFloatGlyphs([bad],area,processor,()=>{},async()=>new Float32Array([1]))).rejects.toThrow();
});

it('never overwrites existing private Unicode mappings when choosing glyph selectors',async()=>{
 const original=compileGlyphSelectors(new Uint8Array(await readFile('tests/fixtures/fonts/Regular.ttf'))),next=compileGlyphSelectors(original.bytes);validateGlyphSelectors(original.bytes,next);const font=create(next.bytes)as Font;
 for(let glyph=1;glyph<original.glyphCount;glyph++){expect(font.glyphForCodePoint(original.selectors[glyph]).id).toBe(glyph);expect(font.glyphForCodePoint(next.selectors[glyph]).id).toBe(glyph);expect([...original.selectors]).not.toContain(next.selectors[glyph]);}
});

it('retains original OpenType layout bytes for hint classification while declaring all source features disabled',async()=>{
 const {glyphFeatureSettings}=await import('../src/fonts/glyph-sfnt'),source=new Uint8Array(await readFile('tests/fixtures/shaping-font/Shaping.ttf')),result=compileGlyphSelectors(source),tables=(bytes:Uint8Array)=>{const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return new Map(Array.from({length:v.getUint16(4)},(_,i)=>{const p=12+i*16;return[String.fromCharCode(...bytes.subarray(p,p+4)),bytes.slice(v.getUint32(p+8),v.getUint32(p+8)+v.getUint32(p+12))]as const;}));},a=tables(source),b=tables(result.bytes);
 for(const tag of ['GSUB','GPOS','GDEF'])expect(b.get(tag)).toEqual(a.get(tag));const settings=glyphFeatureSettings(source);for(const tag of ['liga','rlig','kern','mark','init','medi','fina'])expect(settings).toContain('"'+tag+'" 0');
});
