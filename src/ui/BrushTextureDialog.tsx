import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {BrushTextureSourceOwner,type BrushTexturePreference} from '../brushes/texture-source';
import type {EditorApplication} from '../editor';
import type {TiffImportReport} from '../core/interchange/tiff/types';
import {useBrushTexturePreview} from './hooks/useBrushTexturePreview';
import {Dialog} from './Dialog';
import {Button,IconButton,Select} from './controls';

export function BrushTextureDialog({editor,onClose}:{editor:EditorApplication;onClose():void}){
  const [draft]=useState(()=>{const value=new BrushTextureSourceOwner();if(editor.brushTextureSource.source)value.captureFrom(editor.brushTextureSource);return value;});
  const [source,setSource]=useState(draft.source),[enabled,setEnabled]=useState(!!editor.tools.getSnapshot().settings.texture);
  const [channel,setChannel]=useState<'alpha'|'luminance'>(editor.tools.getSnapshot().settings.texture?.channel??'luminance');
  const [invert,setInvert]=useState(editor.tools.getSnapshot().settings.texture?.invert??false);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[file,setFile]=useState<File|null>(null),[report,setReport]=useState<TiffImportReport|null>(null),[page,setPage]=useState(0),[consent,setConsent]=useState(false);
  const pending=useRef<AbortController|null>(null),input=useRef<HTMLInputElement>(null);
  useEffect(()=>()=>{pending.current?.abort();draft.dispose();},[draft]);
  const preference:BrushTexturePreference=enabled?{channel,invert}:null;
  const preview=useBrushTexturePreview(draft,source?{channel,invert}:null,editor.renderer.processor);
  const ready=()=>{setSource(draft.source);setEnabled(true);setError('');setFile(null);setReport(null);};
  const run=async(operation:(signal:AbortSignal)=>Promise<void>)=>{
    pending.current?.abort();const abort=new AbortController();pending.current=abort;setBusy(true);setError('');
    try{await operation(abort.signal);}
    catch(cause){if(!abort.signal.aborted)setError(String(cause instanceof Error?cause.message:cause));}
    finally{if(pending.current===abort){pending.current=null;setBusy(false);}}
  };
  const chooseFile=(value:File)=>void run(async signal=>{
    setFile(null);setReport(null);
    // Some browsers supply no MIME for TIFF; normalize its type without copying bytes.
    const head=new Uint8Array(await value.slice(0,4).arrayBuffer());signal.throwIfAborted();
    const tiff=head[0]===73&&head[1]===73&&(head[2]===42||head[2]===43)&&head[3]===0||head[0]===77&&head[1]===77&&head[2]===0&&(head[3]===42||head[3]===43);
    if(tiff||value.type==='image/tiff'){
      const file=value.type==='image/tiff'?value:new File([value],value.name,{type:'image/tiff'});
      const report=await editor.inspectTiff(file,{signal});signal.throwIfAborted();setFile(file);setReport(report);setPage(0);setConsent(false);return;
    }
    await draft.import(value,value.name,{signal});signal.throwIfAborted();ready();
  });
  const selected=report?.pages[page];
  return <Dialog titleId="brush-texture-title" className="brush-texture-dialog" onClose={onClose}>
    <div className="dialog-heading"><div><span className="section-caption">BRUSH DYNAMICS</span><h2 id="brush-texture-title">Brush texture</h2></div><IconButton label="Close brush texture" autoFocus onClick={onClose}><X size={19}/></IconButton></div>
    <p>Stretch an image across each dab. Texture changes future strokes; existing artwork retains its source and settings.</p>
    <label className="check-field"><input type="checkbox" checked={enabled} disabled={busy} onChange={event=>setEnabled(event.target.checked)}/>Use brush texture</label>
    <Select label="Document image source" layout="stacked" value="" disabled={busy} options={[{value:'',label:'Choose an image…'},...editor.assetStore.values().map(asset=>({value:asset.id,label:`${asset.name} — ${asset.width} × ${asset.height} px`}))]} onChange={id=>{if(!id)return;try{draft.capture(editor.assetStore,id);ready();}catch(cause){setError(String(cause instanceof Error?cause.message:cause));}}}/>
    <input hidden ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/tiff,.tif,.tiff" aria-label="Brush texture image file" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)chooseFile(file);}}/>
    <Button disabled={busy} onClick={()=>input.current?.click()}>Import texture image…</Button>
    {report&&file&&<section aria-label="TIFF texture source review"><p>{file.name} · {report.bigTiff?'BigTIFF':'TIFF'}</p><Select label="Texture TIFF page" layout="stacked" value={String(page)} disabled={busy} options={report.pages.map(value=>({value:String(value.index),label:`Page ${value.index+1} — ${value.width} × ${value.height} px`}))} onChange={value=>{setPage(Number(value));setConsent(false);}}/>
      {selected&&<><p>{selected.bits} bits per sample · {selected.samples} channels · Orientation {selected.orientation}</p>{[...selected.unsupported,...selected.warnings].map((text,index)=><p className="text-muted" key={index}>{text}</p>)}{selected.requiresPrecisionLoss&&<label className="check-field"><input type="checkbox" disabled={busy} checked={consent} onChange={event=>setConsent(event.target.checked)}/>Convert texture to 8-bit editing precision</label>}</>}
      <Button disabled={busy||!selected?.canDecode||!!selected.requiresPrecisionLoss&&!consent} onClick={()=>void run(async signal=>{await draft.import(file,file.name,{signal,tiff:{page,allowPrecisionLoss:consent}});signal.throwIfAborted();ready();})}>Use TIFF page as texture</Button>
    </section>}
    {source&&<><p data-testid="brush-texture-source">{source.name} · {source.width} × {source.height} px{source.tiff?` · TIFF page ${source.tiff.page+1}`:''}</p><p className="text-muted">Original bytes and native dimensions are retained. The 128 × 128 coverage preview and cursor are proxies; white indicates ink. TIFF orientation is reported above; texture uses the decoded source pixel grid.</p></>}
    <Select label="Texture channel" layout="stacked" value={channel} disabled={busy} options={[{value:'luminance',label:'Luminance — dark pixels paint'},{value:'alpha',label:'Alpha — opaque pixels paint'}]} onChange={value=>setChannel(value as typeof channel)}/>
    <label className="check-field"><input type="checkbox" checked={invert} disabled={busy} onChange={event=>setInvert(event.target.checked)}/>Invert texture coverage</label>
    {preview.url&&<img className="brush-texture-preview" src={preview.url} width={128} height={128} alt="Texture coverage preview"/>}
    {(error||preview.error)&&<p role="alert">{error||preview.error}</p>}{busy&&<p role="status">Preparing texture source…</p>}
    <p className="text-muted">Save this texture with the current brush from Brush presets. Original image bytes travel with the brush pack.</p>
    <div className="brush-preset-actions end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy||!!report||enabled&&!source} onClick={()=>{try{editor.tools.applyBrushTexture(draft,preference);onClose();}catch(cause){setError(String(cause instanceof Error?cause.message:cause));}}}>Apply texture</Button></div>
  </Dialog>;
}
