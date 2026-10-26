import {useEffect,useRef,useState} from 'react';
import type {TextLayer,CharacterFormatPatch} from '../dom';
import {Button,ColorField,NumberField,Select,TextInput} from './controls';

export function CharacterFormattingPanel({layer,start,end,disabled}:{layer:TextLayer;start:number;end:number;disabled:boolean}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef<AbortController|undefined>(undefined);
  const revision=layer.document?.getSnapshot().revision,text=layer.text;
  useEffect(()=>()=>{pending.current?.abort();},[layer,start,end,text]);
  const selected=end>start&&end<=text.length,blocked=disabled||busy||!selected;
  const format=async(patch:CharacterFormatPatch|null)=>{
    pending.current?.abort();const request=new AbortController();pending.current=request;setBusy(true);setError('');
    try{await layer.formatRange(start,end,patch,{signal:request.signal});}catch(cause){if(!request.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}finally{if(pending.current===request){pending.current=undefined;setBusy(false);}}
  };
  const ranges=layer.characterRanges,at=ranges.find(range=>range.start<=start&&range.end>start)?.format??{};
  return <details className="character-formatting-panel">
    <summary>Character formatting</summary>
    <p>{selected?`Characters ${start+1}–${end} selected. Changes apply to this range.`:'Select characters in Text content to format a range.'} Unformatted characters inherit the text defaults below.</p>
    <TextInput key={`family-${revision}-${start}-${end}`} layout="stacked" label="Selected font family" value={at.fontFamily??layer.fontFamily} disabled={blocked} onCommit={fontFamily=>void format({fontFamily})}/>
    <NumberField key={`size-${revision}-${start}-${end}`} layout="stacked" label="Selected font size" value={at.fontSize??layer.fontSize} min={1} max={Number.MAX_SAFE_INTEGER} suffix="px" disabled={blocked} onCommit={fontSize=>void format({fontSize})}/>
    <ColorField label="Selected text color" value={at.color??layer.color} disabled={blocked} onChange={color=>void format({color})}/>
    <Select label="Selected weight" layout="stacked" value={at.fontWeight??layer.fontWeight??'normal'} disabled={blocked} options={[{value:'normal',label:'Normal'},{value:'bold',label:'Bold'},...(['100','200','300','400','500','600','700','800','900'].map(value=>({value,label:value})))]} onChange={fontWeight=>void format({fontWeight})}/>
    <Select label="Selected slant" layout="stacked" value={at.fontStyle??layer.fontStyle??'normal'} disabled={blocked} options={[{value:'normal',label:'Normal'},{value:'italic',label:'Italic'}]} onChange={fontStyle=>void format({fontStyle:fontStyle as 'normal'|'italic'})}/>
    <NumberField label="Selected letter spacing" layout="stacked" value={at.letterSpacing??layer.letterSpacing??0} min={-50} max={500} suffix="px" disabled={blocked} onCommit={letterSpacing=>void format({letterSpacing})}/>
    <Button disabled={blocked} onClick={()=>void format(null)}>Clear selected character formatting</Button>
    {busy&&<p role="status">Preparing character layout…</p>}{error&&<p role="alert">{error}</p>}
  </details>;
}
