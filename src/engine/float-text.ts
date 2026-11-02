import {AffineTransform} from '../core/affine';
import {characterInputForLayer,normalizeCharacterText,measureCharacterTextAsync,type CharacterLayout} from '../core/character-layout';
import {documentFontFiles} from '../core/font-files';
import {fontFamilyNames} from '../core/font-families';
import {sameFontResource} from '../fonts/resources';
import {isImmutable,freeze} from '../core/immutable';
import {textPathSchema} from '../core/text-path';
import type {DocumentData,TextLayerData} from '../core/model';
import type {AssetStore} from '../core/assets';
import {isVerticalText} from '../core/text-writing';
import {validateWindow,type FloatSourceControl,type FloatSourceWindow} from '../core/float-source/types';
import {captureStyledTextFonts,captureStyledTextPlan,type StyledTextPlan} from './styled-text';
import type {FloatGlyph} from './float-glyph';
import type {NativeGlyphFont} from './native-glyph-font';
import type {PixelProcessor} from './processor';
import {validateFloatWorkerWindow} from './float-pixels';

export interface CapturedFloatText {
 readonly layout:CharacterLayout;
 readonly glyphCount:number;
 check():void;
 checkDocument(document:DocumentData):void;
 read(bounds:FloatSourceWindow,check?:()=>void):Promise<Float32Array<ArrayBuffer>>;
 dispose():void;
}

/** Existing OO text snapshots become native linear fields. Font ownership,
 * complete native matching and ordered original-color paint remain mandatory;
 * no byte text bitmap supplies RGB and no prepared DTO mutates a document. */
export async function captureFloatText(document:DocumentData,layer:TextLayerData,assets:AssetStore,world:AffineTransform,processor:Pick<PixelProcessor,'floatComposite'>,control:FloatSourceControl={}):Promise<CapturedFloatText>{
 document=isImmutable(document)?document:freeze(structuredClone(document));layer=isImmutable(layer)?layer:freeze(structuredClone(layer));
 const transform:[number,number,number,number,number,number]=[world.a,world.b,world.c,world.d,world.e,world.f];
 const options={...control},source=normalizeCharacterText(characterInputForLayer(layer)),alive=assets.captureLifetime(),abort=new AbortController(),signal=AbortSignal.any([abort.signal,...(options.signal?[options.signal]:[])]),families=[...new Set(source.styles.flatMap(style=>fontFamilyNames(style.fontFamily)))],requested=new Set(families),files=documentFontFiles(document).filter(file=>requested.has(file.resource.report.faces[0].cssFamily.toLowerCase()));
 for(const style of source.styles)if(!files.some(file=>file.resource.report.faces[0].cssFamily.toLowerCase()===fontFamilyNames(style.fontFamily)[0]))throw new Error('Float text requires a declared original font as its first requested family.');
 let released=false,fonts:ReturnType<typeof captureStyledTextFonts>|undefined,plan:StyledTextPlan|undefined,handedOff=false;
 const owners=new Set<NativeGlyphFont>();
 // Owner callbacks retain the base check. Calling the full glyph check from
 // those callbacks would recursively validate the same glyph registration.
 const baseCheck=()=>{signal.throwIfAborted();if(released)throw new Error('Float text capture is closed.');alive();fonts?.check();plan?.check();};
 const check=()=>{baseCheck();for(const owner of owners)owner.check();};
 const dispose=()=>{if(released)return;released=true;abort.abort(new Error('Float text capture is closed.'));plan?.release();fonts?.release();};
 const documents=new WeakSet<DocumentData>();
 const checkDocument=(current:DocumentData)=>{
  check();if(documents.has(current))return;
  const declared=documentFontFiles(current).filter(file=>requested.has(file.resource.report.faces[0].cssFamily.toLowerCase()));
  if(declared.length!==files.length||files.some(file=>!declared.some(candidate=>candidate.id===file.id&&sameFontResource(file.resource,candidate.resource))))throw new Error('Float text font declarations changed.');
  if(isImmutable(current))documents.add(current);
 };
 try{
  check();fonts=captureStyledTextFonts(source.styles,document,assets);check();
  const input=characterInputForLayer(layer),layout=await measureCharacterTextAsync(input,{signal,alignmentWidth:isVerticalText(layer)&&!layer.textPath?layer.textInlineExtent:layer.width,check});check();
  if(layout.accuracy!=='native')throw new Error('Float text requires native browser typography measurement.');
  plan=await captureStyledTextPlan({width:document.width,height:document.height,transform,lines:layout.lines.map(line=>({x:line.x,y:line.y,align:line.align,direction:line.direction,wordSpacingDelta:line.wordSpacingDelta,...(line.path?{path:textPathSchema.parse(line.path)}:{}),...(line.writing?{writing:line.writing}:{}),spans:line.spans.map(span=>({text:span.text,style:span.style}))}))},fonts.document,assets,{signal,captureLinearPaint:true});check();
  const glyphs:Readonly<FloatGlyph>[]=[];
  for(let index=0;index<plan.scene.lines.length;index++){
   check();if(!plan.scene.lines[index].spans.some(span=>span.text.length))continue;
   const match=await plan.matchStyledGlyphLine(index,{signal,check:baseCheck});check();
   if(match.status!=='matched')throw new Error(`Float text could not retain original native paint: ${match.reason}`);
   glyphs.push(...match.glyphs);for(const glyph of match.glyphs)owners.add(glyph.font);
  }
  plan.retireMeasurement();fonts.release();fonts=undefined;checkDocument(document);
  const captured=plan;
  handedOff=true;return Object.freeze({layout,glyphCount:glyphs.length,check,checkDocument,dispose,read:async(bounds:FloatSourceWindow,current:()=>void=()=>{})=>{
   check();current();const area=validateWindow({...bounds}),pixels=await captured.renderGlyphs(glyphs,area,processor,()=>{check();current();});check();current();validateFloatWorkerWindow(pixels);return pixels as Float32Array<ArrayBuffer>;
  }});
 }finally{if(!handedOff)dispose();}
}

interface Tile {entry:Entry;key:string;ready:Promise<Float32Array<ArrayBuffer>>}
interface Entry {signature:string;tiles:Map<string,Tile>;layer:TextLayerData;assets:AssetStore;world:readonly number[];width:number;height:number;pins:number;retired:boolean;abort:AbortController;ready:Promise<CapturedFloatText>;source?:CapturedFloatText}
export interface FloatTextLease {readonly source:CapturedFloatText;check():void;read(bounds:FloatSourceWindow):Promise<Float32Array<ArrayBuffer>>;dispose():void}

/** Renderer-owned preparation survives viewport requests. Eviction never retires
 * active scenes. Caller cancellation releases only its lease; owner clear/close
 * aborts all work and sources. This is a cache budget, never a document limit. */
export class FloatTextCache {
 private entries=new Set<Entry>();private closed=false;
 private signatures=new WeakMap<TextLayerData,string>();
 private tiles=new Map<Tile,true>();
 private readonly cell=256;
 private readonly tileCapacity=16;
 private signature(layer:TextLayerData){let value=isImmutable(layer)?this.signatures.get(layer):undefined;if(value===undefined){value=JSON.stringify([characterInputForLayer(layer),isVerticalText(layer)&&!layer.textPath?layer.textInlineExtent:layer.width]);if(isImmutable(layer))this.signatures.set(layer,value);}return value;}
 constructor(private processor:Pick<PixelProcessor,'floatComposite'>,private capacity=128){if(!Number.isSafeInteger(capacity)||capacity<1)throw new Error('Invalid float text cache budget.');}
 clear(){for(const entry of this.entries)this.retire(entry);this.entries.clear();this.tiles.clear();}
 dispose(){this.closed=true;this.clear();}
 private retire(entry:Entry){if(entry.retired)return;entry.retired=true;entry.abort.abort(new Error('Float text cache entry retired.'));entry.source?.dispose();for(const tile of entry.tiles.values())this.tiles.delete(tile);entry.tiles.clear();this.entries.delete(entry);}
 private trim(){for(const entry of this.entries){if(this.entries.size<=this.capacity)break;if(!entry.pins)this.retire(entry);}}
 async capture(document:DocumentData,layer:TextLayerData,assets:AssetStore,world:AffineTransform,control:FloatSourceControl&{isCancelled?:()=>boolean}={}):Promise<FloatTextLease>{
  const checkRequest=()=>{control.signal?.throwIfAborted();if(this.closed)throw new Error('Float text cache is closed.');if(control.isCancelled?.())throw new DOMException('Float text preparation superseded.','AbortError');};checkRequest();
  const transform=[world.a,world.b,world.c,world.d,world.e,world.f],signature=this.signature(layer);let entry=[...this.entries].find(value=>!value.retired&&value.signature===signature&&value.assets===assets&&value.width===document.width&&value.height===document.height&&value.world.every((n,i)=>n===transform[i]));
  if(entry?.source)try{entry.source.checkDocument(document);}catch{this.retire(entry);entry=undefined;}
  if(!entry){
   const abort=new AbortController();entry={signature,tiles:new Map(),layer,assets,world:transform,width:document.width,height:document.height,pins:0,retired:false,abort,ready:undefined!};const value=entry;this.entries.add(value);
   value.ready=captureFloatText(document,layer,assets,world,this.processor,{signal:abort.signal}).then(source=>{if(value.retired||this.closed){source.dispose();throw new Error('Float text cache is closed or retired.');}value.source=source;return source;},error=>{this.retire(value);throw error;});
   // A cancelled viewport can leave preparation in the cache for the next frame.
   // Owner retirement still cancels it; an unobserved rejection is never leaked.
   void value.ready.catch(()=>{});
  }
  const owned=entry;owned.pins++;this.entries.delete(owned);this.entries.add(owned);let accepted=false;
  try{
   const source=await new Promise<CapturedFloatText>((resolve,reject)=>{
    let ended=false;const finish=(error?:unknown,value?:CapturedFloatText)=>{if(ended)return;ended=true;clearInterval(timer);control.signal?.removeEventListener('abort',cancel);error===undefined?resolve(value!):reject(error);},cancel=()=>finish(control.signal?.reason??new Error('Float text preparation cancelled.'));
    const timer=setInterval(()=>{try{checkRequest();}catch(error){finish(error);}},16);
    control.signal?.addEventListener('abort',cancel,{once:true});owned.ready.then(value=>{try{checkRequest();finish(undefined,value);}catch(error){finish(error);}},error=>finish(error));if(control.signal?.aborted)cancel();
   });checkRequest();source.checkDocument(document);let released=false;
   const check=()=>{checkRequest();if(released||owned.retired)throw new Error('Float text lease is closed.');source.check();};
   accepted=true;this.trim();return{source,check,read:bounds=>this.read(owned,source,bounds,check),dispose:()=>{if(released)return;released=true;owned.pins--;this.trim();}};
  }finally{if(!accepted){owned.pins--;this.trim();}}
 }
 private async read(entry:Entry,source:CapturedFloatText,input:FloatSourceWindow,check:()=>void):Promise<Float32Array<ArrayBuffer>>{
  const area=validateWindow({...input}),output=new Float32Array(area.width*area.height*4),cell=this.cell;check();
  for(let y=Math.floor(area.y/cell)*cell;y<area.y+area.height;y+=cell)for(let x=Math.floor(area.x/cell)*cell;x<area.x+area.width;x+=cell){
   check();const key=`${x},${y}`;let tile=entry.tiles.get(key);
   if(!tile){
    // Cell work belongs to the renderer entry, never to the first viewport.
    // Cancelling one waiter leaves valid in-flight pixels reusable.
    tile={entry,key,ready:source.read({x,y,width:cell,height:cell})};entry.tiles.set(key,tile);
    const owned=tile;void tile.ready.catch(()=>{if(entry.tiles.get(key)===owned)entry.tiles.delete(key);this.tiles.delete(owned);});
   }
   const owned=tile;this.tiles.delete(owned);this.tiles.set(owned,true);
   const pixels=await this.waitForTile(owned.ready,check);check();
   while(this.tiles.size>this.tileCapacity){const oldest=this.tiles.keys().next().value!;this.tiles.delete(oldest);if(oldest.entry.tiles.get(oldest.key)===oldest)oldest.entry.tiles.delete(oldest.key);}
   const left=Math.max(x,area.x),top=Math.max(y,area.y),width=Math.min(x+cell,area.x+area.width)-left,height=Math.min(y+cell,area.y+area.height)-top;
   for(let row=0;row<height;row++){const start=((top-y+row)*cell+left-x)*4;output.set(pixels.subarray(start,start+width*4),((top-area.y+row)*area.width+left-area.x)*4);}
  }
  check();return output;
 }
 private waitForTile<T>(ready:Promise<T>,check:()=>void):Promise<T>{
  return new Promise((resolve,reject)=>{let ended=false;const finish=(error?:unknown,value?:T)=>{if(ended)return;ended=true;clearInterval(timer);error===undefined?resolve(value!):reject(error);};const timer=setInterval(()=>{try{check();}catch(error){finish(error);}},16);ready.then(value=>{try{check();finish(undefined,value);}catch(error){finish(error);}},error=>finish(error));});
 }
}
