import {useState} from 'react';
import type {TextLayer} from '../dom';
import type {EditorCommand} from '../core/commands';
import {parseFontVariations,formatFontVariations} from '../core/font-variations';
import {fontFamilyNames} from '../core/font-families';
import {Button,NumberField} from './controls';

export function VariableFontAxes({layer,disabled,onAction,onPreview}:{layer:TextLayer;disabled:boolean;onAction(action:()=>void):void;onPreview(command:EditorCommand):void}){
 const [page,setPage]=useState(0),names=fontFamilyNames(layer.fontFamily),files=layer.document?.fonts.files.items??[],file=names.map(name=>files.find(value=>value.family.toLowerCase()===name)).find(Boolean);
 const axes=file?.resource.report.faces[0].axes??[],settings=parseFontVariations(layer.fontVariationSettings??'normal'),supported=typeof FontFace!=='undefined'&&'variationSettings'in FontFace.prototype;
 const size=8,current=Math.min(page,Math.max(0,Math.ceil(axes.length/size)-1));
 const valueFor=(tag:string,value:number)=>formatFontVariations([...settings.filter(value=>value.tag!==tag),{tag,value}].sort((a,b)=>a.tag<b.tag?-1:1));
 if(!axes.length&&!(settings.length))return null;
 return <details className="variable-font-axes"><summary>Variable font axes ({axes.length})</summary>
  <p>Explicit axis values override the font’s matching defaults. Reset axes to use the Weight and Font stretch controls again. The original font stays embedded. Unset controls show source defaults; font matching may choose different weight, width, style or optical sizing until you author an axis value.</p>
  {!supported&&<p role="status">This browser cannot render font variation descriptors. Reset variable axes or use a supporting browser.</p>}
  {!axes.length&&<p role="status">Embed the requested variable font to edit its axes, or reset variable axes.</p>}
  {axes.slice(current*size,(current+1)*size).map(axis=><div key={axis.tag}><NumberField layout="stacked" label={`Axis ${axis.tag}${axis.name?` — ${axis.name.slice(0,80)}`:''}`} value={settings.find(value=>value.tag===axis.tag)?.value??axis.default} min={axis.min} max={axis.max} step={.01} disabled={disabled||!supported}
    onPreview={value=>onPreview({type:'layer.update',id:layer.id,patch:{fontVariationSettings:valueFor(axis.tag,value)}})}
    onCommit={value=>onAction(()=>{layer.fontVariationSettings=valueFor(axis.tag,value);})}/>
    <Button variant="subtle" disabled={disabled||!settings.some(value=>value.tag===axis.tag)} onClick={()=>onAction(()=>{layer.fontVariationSettings=formatFontVariations(settings.filter(value=>value.tag!==axis.tag));})}>Use matching default for {axis.tag}</Button></div>) }
  {axes.length>size&&<div className="button-row"><Button disabled={current===0} onClick={()=>setPage(current-1)}>Previous axes</Button><span>{current+1} / {Math.ceil(axes.length/size)}</span><Button disabled={(current+1)*size>=axes.length} onClick={()=>setPage(current+1)}>Next axes</Button></div>}
  <Button disabled={disabled||!settings.length} onClick={()=>onAction(()=>layer.resetVariableAxes())}>Reset variable axes</Button>
 </details>;
}
