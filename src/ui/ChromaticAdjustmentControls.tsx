import { useState } from 'react';
import type { ChromaticAdjustmentData } from '../core/adjustments';
import { Select, Slider } from './controls';

export function ChromaticAdjustmentControls({adjustment,disabled,onPreview,onCommit}:{
  adjustment:ChromaticAdjustmentData;disabled:boolean;
  onPreview(value:ChromaticAdjustmentData):void;
  onCommit(value:ChromaticAdjustmentData):void;
}){
  const [range,setRange]=useState<'shadows'|'midtones'|'highlights'>('midtones');
  if(adjustment.kind==='vibrance')return <>
    {(['vibrance','saturation'] as const).map(key=><Slider key={key}
      label={key==='vibrance'?'Vibrance':'Vibrance saturation'} value={adjustment[key]} min={-100} max={100} step={1} suffix="%" disabled={disabled}
      onPreview={value=>onPreview({...adjustment,[key]:value})} onCommit={value=>onCommit({...adjustment,[key]:value})} />)}
    <p className="section-description">Vibrance targets less chromatic colors. Neutral pixels stay neutral; skin tones are not detected.</p>
  </>;
  return <>
    <Select label="Color balance range" value={range} disabled={disabled}
      options={[{value:'shadows',label:'Shadows'},{value:'midtones',label:'Midtones'},{value:'highlights',label:'Highlights'}]}
      onChange={value=>setRange(value as typeof range)} />
    {(['red','green','blue'] as const).map(channel=><Slider key={channel}
      label={channel==='red'?'Cyan / Red':channel==='green'?'Magenta / Green':'Yellow / Blue'}
      value={adjustment[range][channel]} min={-100} max={100} step={1} disabled={disabled}
      onPreview={value=>onPreview({...adjustment,[range]:{...adjustment[range],[channel]:value}})}
      onCommit={value=>onCommit({...adjustment,[range]:{...adjustment[range],[channel]:value}})} />)}
    <label className="context-check-field"><input type="checkbox" aria-label="Preserve luminosity" checked={adjustment.preserveLuminosity} disabled={disabled}
      onChange={event=>onCommit({...adjustment,preserveLuminosity:event.target.checked})} /> Preserve luminosity</label>
  </>;
}
