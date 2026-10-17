import { useEffect, useRef, useState } from 'react';
import type { Document } from '../dom';
import { MAX_ALPHA_CHANNELS, type ChannelLoadOptions } from '../core/alpha-channels';
import { PixelProcessor } from '../engine/processor';
import { InspectorSection } from './InspectorSection';
import { Button, Select, TextInput } from './controls';

export function AlphaChannelsPanel({document,disabled,onAttempt}:{document:Document;disabled:boolean;onAttempt(action:()=>void):void}){
  const channels=document.alphaChannels.items;
  const [selected,setSelected]=useState<string>(),[name,setName]=useState('Alpha 1');
  const [collapsed,setCollapsed]=useState(true);
  const [operation,setOperation]=useState<NonNullable<ChannelLoadOptions['operation']>>('replace'),[invert,setInvert]=useState(false);
  const [working,setWorking]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[progress,setProgress]=useState({completed:0,total:1});
  const active=useRef<AbortController|null>(null),canvas=useRef<HTMLCanvasElement>(null);
  const channel=channels.find(value=>value.id===selected)??channels[0],source=channel?document.getSnapshot().document.alphaChannels!.find(value=>value.id===channel.id):undefined;
  useEffect(()=>()=>{active.current?.abort();},[document]);
  useEffect(()=>{
    if(collapsed||!source||!canvas.current)return;
    const processor=new PixelProcessor();let disposed=false;
    const scale=Math.min(1,320/document.width,160/document.height),width=Math.max(1,Math.floor(document.width*scale)),height=Math.max(1,Math.floor(document.height*scale));
    void processor.selection({selection:source.selection,width,height,x:0,y:0,stepX:document.width/width,stepY:document.height/height}).then(pixels=>{
      if(disposed||!canvas.current)return;
      for(let i=0;i<pixels.length;i+=4){pixels[i]=pixels[i+1]=pixels[i+2]=pixels[i+3];pixels[i+3]=255;}
      const target=canvas.current;target.width=width;target.height=height;const context=target.getContext('2d')!,image=context.createImageData(width,height);image.data.set(pixels);context.putImageData(image,0,0);
    }).catch(cause=>{if(!disposed)setError(String(cause));}).finally(()=>processor.dispose());
    return()=>{disposed=true;processor.dispose();};
  },[source,document,document.width,document.height,collapsed]);
  const locked=disabled||working;
  return <InspectorSection title="Alpha channels" collapsed={collapsed} onToggle={()=>setCollapsed(value=>!value)} badge={channels.length} className="alpha-channels-panel">
    <div className="alpha-channels-controls">
      <p className="section-description">Save selection coverage independently of layers. White selects; black excludes. Channels do not change the image until loaded or used as a mask.</p>
      <TextInput label="New channel name" layout="stacked" value={name} onChange={setName} disabled={locked}/>
      <Button disabled={locked||!name.trim()||!document.selection||channels.length>=MAX_ALPHA_CHANNELS} onClick={()=>onAttempt(()=>{
        const saved=document.alphaChannels.capture(name.trim());setSelected(saved.id);setMessage(`Saved ${saved.name}.`);setName(`Alpha ${channels.length+2}`);
      })}>Save selection as channel</Button>
      {!channels.length&&<p className="section-description">No saved alpha channels.</p>}
      {channels.length>0&&<>
        <Select label="Saved alpha channel" layout="stacked" value={channel!.id} options={channels.map(value=>({value:value.id,label:value.name}))} onChange={setSelected} disabled={locked}/>
        <TextInput key={channel!.id} label="Channel name" layout="stacked" value={channel!.name} disabled={locked} onCommit={value=>onAttempt(()=>{channel!.name=value.trim();})}/>
        <canvas ref={canvas} className="alpha-channel-preview" aria-label="Alpha channel preview"/>
        <p className="section-description">Coverage preview. Load uses native document pixels.</p>
        <Select label="Channel selection operation" layout="stacked" value={operation} disabled={locked} options={['replace','add','subtract','intersect'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))} onChange={value=>setOperation(value as typeof operation)}/>
        <label className="checkbox-field"><input type="checkbox" aria-label="Invert loaded channel" checked={invert} disabled={locked} onChange={event=>setInvert(event.target.checked)}/> Invert loaded channel</label>
        <div className="alpha-channel-actions">
          <Button disabled={locked} onClick={async()=>{
            const abort=new AbortController(),loadedName=channel!.name;active.current=abort;setWorking(true);setError('');setMessage('');
            try{await channel!.load({operation,invert},{signal:abort.signal,onProgress:setProgress});if(!abort.signal.aborted)setMessage(`Loaded ${loadedName}.`);}
            catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
            finally{if(active.current===abort)active.current=null;setWorking(false);}
          }}>Load channel selection</Button>
          <Button disabled={locked||!document.selection} onClick={()=>onAttempt(()=>{channel!.captureSelection();setMessage(`Updated ${channel!.name}.`);})}>Update from selection</Button>
          <Button disabled={locked||channels.length>=MAX_ALPHA_CHANNELS} onClick={()=>onAttempt(()=>{setSelected(channel!.duplicate().id);})}>Duplicate channel</Button>
          <Button disabled={locked||channel!.id===channels[0].id} onClick={()=>onAttempt(()=>channel!.move('up'))}>Move channel up</Button>
          <Button disabled={locked||channel!.id===channels.at(-1)!.id} onClick={()=>onAttempt(()=>channel!.move('down'))}>Move channel down</Button>
          <Button disabled={locked} onClick={()=>onAttempt(()=>{channel!.remove();setSelected(undefined);})}>Remove channel</Button>
        </div>
      </>}
      {working&&<div role="status">Loading alpha channel… <progress aria-label="Alpha channel progress" max={progress.total} value={progress.completed}/><Button onClick={()=>{active.current?.abort();setMessage('Channel loading cancelled.');}}>Cancel channel loading</Button></div>}
      {error&&<p role="alert">{error}</p>}
      <div role="status">{message}</div>
    </div>
  </InspectorSection>;
}
