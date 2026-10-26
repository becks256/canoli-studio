import {textPathSchema} from '../core/text-path';
import {z} from 'zod';
import {characterTextSchema,normalizeCharacterText,measureCharacterTextAsync,characterBoundsForLayout,type CharacterLayoutLine,type CharacterLayout} from '../core/character-layout';
import type {DocumentData} from '../core/model';
import type {AssetStore} from '../core/assets';
import {normalizeStyledTextScene,prepareStyledTextSurface,captureStyledTextFonts,type StyledTextSceneInput,type StyledTextControl,type StyledTextSurface} from './styled-text';

const inputSchema=characterTextSchema.extend({width:z.number(),height:z.number(),alignmentWidth:z.number().finite().min(1).max(Number.MAX_SAFE_INTEGER).optional(),transform:z.tuple([z.number(),z.number(),z.number(),z.number(),z.number(),z.number()]).optional()}).strict();
export type StyledTextParagraphInput=z.input<typeof inputSchema>;
export type StyledParagraphLine=CharacterLayoutLine;
export type StyledParagraphLayout=CharacterLayout;
export interface StyledParagraphSurface extends StyledTextSurface {readonly layout:StyledParagraphLayout}

/** Source-owned native bounds for one later synchronous command. No bitmap,
 * source bytes or mutation authority are returned to isolated callers. */
export async function prepareCharacterTextMetrics(input:import('../core/character-layout').CharacterTextInput,document:DocumentData,assets:AssetStore,control:StyledTextControl={}){
 control={...control};const alive=assets.captureLifetime(),snapshot=normalizeCharacterText(input);let fonts:ReturnType<typeof captureStyledTextFonts>|undefined,released=false,handedOff=false;
 const check=()=>{if(released)throw new Error('Typography preparation was released.');control.signal?.throwIfAborted();if(control.isCancelled?.())throw new DOMException('Typography preparation superseded.','AbortError');alive();fonts?.check();};check();
 try{fonts=captureStyledTextFonts(snapshot.styles,document,assets);check();const layout=await measureCharacterTextAsync(input,{...control,check});check();if(layout.accuracy!=='native')throw new Error('Native typography measurement requires a browser SVG host.');const bounds=characterBoundsForLayout(layout);handedOff=true;return{bounds,check,release:()=>{if(released)return;released=true;fonts?.release();}};}finally{if(!handedOff){released=true;fonts?.release();}}
}

/** Native paragraph rasterization owns fonts independently of model lifetime.
 * The same measurer supplies synchronous command geometry and async rendering. */
export async function prepareStyledTextParagraph(input:StyledTextParagraphInput,document:DocumentData,assets:AssetStore,control:StyledTextControl={}):Promise<StyledParagraphSurface>{
 control={...control};const alive=assets.captureLifetime(),current=()=>{control.signal?.throwIfAborted();if(control.isCancelled?.())throw new DOMException('Styled paragraph preparation superseded.','AbortError');alive();};current();
 const value=inputSchema.parse(input),{width,height,transform,alignmentWidth,...source}=value,snapshot=normalizeCharacterText(source),window=normalizeStyledTextScene({width,height,transform,lines:[]});
 let fonts:ReturnType<typeof captureStyledTextFonts>|undefined,surface:StyledTextSurface|undefined,handedOff=false;
 try{
  fonts=captureStyledTextFonts(snapshot.styles,document,assets);const check=()=>{current();fonts!.check();};check();
  const layout=await measureCharacterTextAsync(source,{...control,alignmentWidth,check});check();if(layout.accuracy!=='native')throw new Error('Native styled paragraph preparation requires a browser SVG host.');
  const scene:StyledTextSceneInput={width:window.width,height:window.height,transform:[...window.transform]as[number,number,number,number,number,number],lines:layout.lines.map(line=>({x:line.x,y:line.y,align:line.align,direction:line.direction,wordSpacingDelta:line.wordSpacingDelta,...(line.path?{path:textPathSchema.parse(line.path)}:{}),...(line.writing?{writing:line.writing}:{}),spans:line.spans.map(span=>({text:span.text,style:span.style}))}))};
  surface=await prepareStyledTextSurface(scene,fonts.document,assets,control);check();handedOff=true;return Object.freeze({...surface,layout});
 }finally{fonts?.release();if(!handedOff)surface?.release();}
}
