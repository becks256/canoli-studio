import {lensCorrectionSchema,hasLensCorrection,validateLensGeometry} from '../core/interchange/raw/lens';
import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {RawDevelopment,SmartObjectLayer} from '../dom';
import type {EditorApplication} from '../editor';
import {ComponentRegistry} from '../core/smart/manager';
import {rawDevelopOptionsSchema,type RawDevelopSettings,type RawImportReport,type RawImportControl} from '../core/interchange/raw/types';
import {developRawFile} from '../core/interchange/raw/client';
import {Button,IconButton,NumberField,Select} from './controls';
import {Dialog} from './Dialog';

export {isCameraRawFile,rawFileAccept} from '../core/interchange/raw/files';

export function RawDevelopmentDialog({editor,file,layer,onClose,onBusyChange,onApplied,onQueued}:{editor:EditorApplication;file?:File;layer?:SmartObjectLayer;onClose():void;onBusyChange(value:boolean):void;onApplied():void;onQueued?:(source:import('../ai/batch/types').BatchSourceInput)=>void}){
  const [source]=useState(()=>{if(file)return null;if(!layer?.document)throw new Error('Choose a RAW image.');const master=new ComponentRegistry(layer.document._read().components).get(layer.componentId).source;return master.kind==='asset'?layer.document.assetStore?.get(master.assetId).raw??null:null;});
  const [settings,setSettings]=useState<RawDevelopSettings>(()=>source?.settings.development??rawDevelopOptionsSchema.parse({}));
  const [precision,setPrecision]=useState(source?.settings.allowPrecisionLoss??false),[report,setReport]=useState<Readonly<RawImportReport>|null>(source?.report??null),[error,setError]=useState(''),[running,setRunning]=useState(false),[stale,setStale]=useState(false);
  const [progress,setProgress]=useState<Parameters<NonNullable<RawImportControl['onProgress']>>[0]|null>(null),[preview,setPreview]=useState<Blob|null>(null),[previewUrl,setPreviewUrl]=useState('');
  const pending=useRef<AbortController|null>(null),applying=useRef(false);
  useEffect(()=>()=>pending.current?.abort(),[]);
  useEffect(()=>{if(!preview){setPreviewUrl('');return;}const url=URL.createObjectURL(preview);setPreviewUrl(url);return()=>URL.revokeObjectURL(url);},[preview]);
  useEffect(()=>{
    if(!file)return;const abort=new AbortController();pending.current?.abort();pending.current=abort;setReport(null);setError('');
    void editor.inspectRaw(file,settings.image,{signal:abort.signal}).then(value=>{if(!abort.signal.aborted)setReport(value);},cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
    return()=>abort.abort();
  },[editor,file,settings.image]);
  useEffect(()=>{
    if(!layer?.document)return;const document=layer.document,revision=document.getSnapshot().revision;
    const changed=()=>{if(applying.current)return;if(editor.document!==document||document.getSnapshot().revision!==revision){pending.current?.abort();setRunning(false);onBusyChange(false);setStale(true);setError('The document changed. Close and reopen RAW development to use its current state.');}};
    const stopDocument=document.subscribe(changed),stopEditor=editor.subscribe(changed);return()=>{stopDocument();stopEditor();};
  },[editor,layer,onBusyChange]);
  const close=()=>{pending.current?.abort();onBusyChange(false);onClose();};
  const change=(patch:Partial<RawDevelopSettings>)=>{setSettings(value=>rawDevelopOptionsSchema.parse({...value,...patch}));setPreview(null);};
  const run=async(previewOnly:boolean)=>{
    const abort=new AbortController();pending.current?.abort();pending.current=abort;setRunning(true);setError('');setProgress(null);onBusyChange(true);
    try{
      const options={allowPrecisionLoss:precision,development:settings},control={signal:abort.signal,onProgress:setProgress};
      if(previewOnly){const blob=file??source?.originalBlob;if(!blob)throw new Error('The retained RAW original is unavailable.');const result=await developRawFile(blob,options,control);abort.signal.throwIfAborted();setPreview(result.png);}
      else{
        applying.current=true;
        if(file&&onQueued){const source=await editor.batch.prepareRawSource(file,options,control);abort.signal.throwIfAborted();onQueued(source);}
        else if(file)await editor.openRaw(file,options,control);
        else if(layer)await layer.developRaw(new RawDevelopment(settings),{...control,allowPrecisionLoss:precision});
        else throw new Error('Choose a RAW image.');
        if(!abort.signal.aborted){onApplied();if(!onQueued)onClose();}
      }
    }catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
    finally{applying.current=false;onBusyChange(false);if(!abort.signal.aborted)setRunning(false);}
  };
  let lensIssue='';if(report&&hasLensCorrection(settings.lens)){try{validateLensGeometry(settings.lens!,report.displayWidth,report.displayHeight);}catch(error){lensIssue=String(error);}}
  const disabled=running||stale,ready=report?.canDevelop&&precision&&!lensIssue&&!(settings.whiteBalance==='camera'&&!report.hasCameraWhiteBalance&&report.channels>1);
  return <Dialog localEscape titleId="raw-development-title" className="svg-import-dialog raw-development-dialog" onClose={close}>
    <div className="dialog-header"><h2 id="raw-development-title">{onQueued?'Queue camera RAW':file?'Import camera RAW':'Develop RAW'}</h2><IconButton label="Close RAW development" onClick={close}><X size={18}/></IconButton></div>
    <div className="svg-import-body"><p><strong>{file?.name??source?.original.name}</strong></p><p>Keep the complete sensor original and editable development settings. Accepted pixels use 8-bit sRGB editing precision. {onQueued?'Queue the original with these settings; develop it in the batch without changing the open editor. Cancel skips remaining unreviewed files.':file?'Open as a smart object in a new document; existing edited documents stay open.':'Apply updates every instance of this shared master in one undo step, preserving layer placement and effects.'}</p>
      {!report&&!error&&<p role="status">Inspecting RAW…</p>}
      {report&&<>
        <p>{report.make} {report.model} · {report.displayWidth} × {report.displayHeight} px{report.bitDepth!==null?` · ${report.bitDepth} bits per sample`:''}</p>
        {report.shooting&&<details><summary>Recorded lens and exposure</summary><dl>
          <dt>Lens maker</dt><dd>{report.shooting.lensMake||'Unknown'}</dd>
          <dt>Lens model</dt><dd>{report.shooting.lensModel||'Unknown'}</dd>
          {([
            ['Focal length',report.shooting.focalLength,'mm'],
            ['35 mm equivalent',report.shooting.focalLength35mm,'mm'],
            ['Aperture',report.shooting.aperture,''],
            ['Exposure time',report.shooting.exposureTime,'s'],
            ['ISO',report.shooting.iso,''],
          ]as const).map(([label,value,unit])=><div key={label}><dt>{label}</dt><dd>{value===null?'Unknown':`${label==='Aperture'?'f/':''}${new Intl.NumberFormat(undefined,{maximumSignificantDigits:7}).format(value)}${unit?' '+unit:''}`}</dd></div>)}
        </dl><p>Recorded by the source file; not verified measurements or calibrated sensor geometry. Lens profile matching requires separate calibration.</p></details>}
        {!!report.unsupported.length&&<ul>{report.unsupported.map(text=><li key={text}>{text}</li>)}</ul>}
        {!!report.warnings.length&&<details><summary>Source limitations</summary><ul>{report.warnings.map(text=><li key={text}>{text}</li>)}</ul></details>}
        {file&&report.imageCount>1&&<NumberField layout="stacked" label="RAW image index" value={settings.image} min={0} max={report.imageCount-1} integer disabled={disabled} onCommit={image=>change({image})}/>}
        <Select layout="stacked" label="RAW white balance" value={settings.whiteBalance} disabled={disabled} options={[{value:'camera',label:'Camera',disabled:!report.hasCameraWhiteBalance&&report.channels>1},{value:'auto',label:'Automatic'},{value:'daylight',label:'Daylight'},{value:'custom',label:'Custom multipliers'}]} onChange={whiteBalance=>change({whiteBalance:whiteBalance as RawDevelopSettings['whiteBalance']})}/>
        {settings.whiteBalance==='custom'&&(['red','green','blue'] as const).map(channel=><NumberField layout="stacked" key={channel} label={`RAW ${channel} multiplier`} value={settings.multipliers[channel]} min={0.01} max={64} step="any" disabled={disabled} onCommit={value=>change({multipliers:{...settings.multipliers,[channel]:value}})}/>)}
        <Select layout="stacked" label="RAW demosaicing" value={settings.demosaic} options={['linear','vng','ppg','ahd','dcb','dht','aahd'].map(value=>({value,label:value.toUpperCase()}))} disabled={disabled} onChange={demosaic=>change({demosaic:demosaic as RawDevelopSettings['demosaic']})}/>
        <NumberField layout="stacked" label="RAW exposure" value={settings.exposure} min={-2} max={3} suffix="EV" step="any" disabled={disabled} onCommit={exposure=>change({exposure})}/>
        <NumberField layout="stacked" label="RAW highlight preservation" value={settings.highlightPreservation} min={0} max={1} step="any" disabled={disabled} onCommit={highlightPreservation=>change({highlightPreservation})}/>
        <Select layout="stacked" label="RAW highlight mode" value={String(settings.highlights)} options={Array.from({length:10},(_,i)=>({value:String(i),label:i===0?'0 — Clip':i===1?'1 — Unclip':i===2?'2 — Blend':`${i} — Reconstruct`}))} disabled={disabled} onChange={value=>change({highlights:Number(value)})}/>
        <details><summary>Lens correction</summary><p>Manual radial, color-fringe and vignette correction in linear RGB before 8-bit editing. Transparent borders retain missing coverage; increase Scale to crop them. Camera/profile matching requires separate calibration.</p>
          <label className="check-field"><input type="checkbox" checked={settings.lens?.enabled??false} disabled={disabled} onChange={event=>change({lens:lensCorrectionSchema.parse({...settings.lens,enabled:event.target.checked})})}/>Enable lens correction</label>
          {settings.lens?.enabled&&<>
            <NumberField layout="stacked" label="Lens scale" value={settings.lens.scale} min={.1} max={10} step="any" disabled={disabled} onCommit={scale=>change({lens:{...settings.lens!,scale}})}/>
            {(['k1','k2','k3']as const).map(key=><NumberField key={'d'+key} layout="stacked" label={`Lens radial ${key}`} value={settings.lens!.distortion[key]} min={-1} max={1} step="any" disabled={disabled} onCommit={value=>change({lens:{...settings.lens!,distortion:{...settings.lens!.distortion,[key]:value}}})}/>)}
            {(['x','y']as const).map(key=><NumberField key={key} layout="stacked" label={`Lens center ${key}`} value={settings.lens!.center[key]} min={0} max={1} step="any" disabled={disabled} onCommit={value=>change({lens:{...settings.lens!,center:{...settings.lens!.center,[key]:value}}})}/>)}
            {(['red','blue']as const).map(key=><NumberField key={key} layout="stacked" label={`Lens ${key} scale`} value={settings.lens!.chromatic[key]} min={.5} max={2} step="any" disabled={disabled} onCommit={value=>change({lens:{...settings.lens!,chromatic:{...settings.lens!.chromatic,[key]:value}}})}/>)}
            {(['k1','k2','k3']as const).map(key=><NumberField key={'v'+key} layout="stacked" label={`Lens vignette ${key}`} value={settings.lens!.vignette[key]} min={-1} max={1} step="any" disabled={disabled} onCommit={value=>change({lens:{...settings.lens!,vignette:{...settings.lens!.vignette,[key]:value}}})}/>)}
          </>}
        </details>
        <label className="check-field"><input type="checkbox" checked={precision} disabled={disabled} onChange={event=>setPrecision(event.target.checked)}/>Convert RAW development to 8-bit editing precision</label>
      </>}
      {previewUrl&&<figure><img src={previewUrl} alt="RAW development preview" className="raw-development-preview"/><figcaption>Native development preview; original sensor resolution is retained.</figcaption></figure>}
      {running&&<div role="status"><p>{progress?.phase==='encoding'?'Preparing working image…':progress?.phase==='developing'?'Developing sensor pixels…':'Inspecting RAW…'}</p><progress aria-label="RAW development progress" max={1} value={progress?.fraction??undefined}/></div>}
      {lensIssue&&<p role="alert">{lensIssue}</p>}
      {error&&<p role="alert">{error}</p>}
    </div>
    <div className="dialog-footer"><Button variant="subtle" onClick={close}>Cancel</Button><Button disabled={!ready||disabled} onClick={()=>void run(true)}>Preview development</Button><Button variant="primary" disabled={!ready||disabled} onClick={()=>void run(false)}>{onQueued?'Queue RAW image':file?'Import RAW image':'Apply RAW development'}</Button></div>
  </Dialog>;
}
