import {useEffect,useRef,useState} from 'react';
import type {EditorApplication} from '../editor';
import type {FontInspection,FontSourceControl,PreparedFontSource} from '../fonts/types';
import {Button,Select,TextInput} from './controls';

export type FontSourceHost=Pick<EditorApplication,'inspectFont'|'prepareFontSource'>;
type EmbedFace=(file:File,faceIndex:number,control:FontSourceControl)=>Promise<void>;
const label=(value:string|null|undefined,limit=240)=>value?value.length>limit?`${value.slice(0,limit)}…`:value:'Not declared';
const previewHtml='<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}canvas{display:block;width:100%;height:150px}</style></head><body><canvas aria-label="Font sample">Selected font sample</canvas></body></html>';

function FontPreview({prepared,sample}:{prepared:PreparedFontSource|null;sample:string}){
  const frame=useRef<HTMLIFrameElement>(null),visible=useRef<HTMLCanvasElement>(null),[loaded,setLoaded]=useState(0),[error,setError]=useState('');
  useEffect(()=>{
    const iframe=frame.current,output=visible.current,doc=iframe?.contentDocument,canvas=doc?.querySelector('canvas');
    if(!iframe||!output||!doc||!canvas||!loaded)return;
    const faces=prepared?.fontFaces??[];
    const draw=()=>{
    try{
      const scale=Math.min(2,window.devicePixelRatio||1),width=Math.max(1,output.clientWidth);
      canvas.width=Math.ceil(width*scale);canvas.height=150*scale;
      const context=canvas.getContext('2d')!;context.setTransform(scale,0,0,scale,0,0);context.clearRect(0,0,width,150);setError('');
      if(prepared){
        for(const face of faces)doc.fonts.add(face);
        const face=prepared.report.faces[0],weight=face.axes.find(a=>a.tag==='wght')?.default??face.weightClass??400;
        const style=face.axes.find(a=>a.tag==='ital')?.default===1?'italic':face.descriptors[0].style;
        context.font=`${style} ${Math.min(1000,Math.max(1,weight))} 36px ${face.cssFamily}`;
        context.textBaseline='top';context.fillStyle=getComputedStyle(output).color;context.fillText(sample,12,28);
      }
      // Script-disabled frames display canvas fallback content in Chromium.
      // Blit pixels only; the visible document never registers or shapes a font.
      output.width=canvas.width;output.height=canvas.height;output.getContext('2d')!.drawImage(canvas,0,0);
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    };
    draw();const resize=new ResizeObserver(draw);resize.observe(output);window.addEventListener('luma:appearance-change',draw);window.addEventListener('resize',draw);
    return()=>{resize.disconnect();window.removeEventListener('luma:appearance-change',draw);window.removeEventListener('resize',draw);for(const face of faces)doc.fonts.delete(face);};
  },[prepared,sample,loaded]);
  return prepared?<><iframe hidden aria-hidden="true" ref={frame} title="Selected font preview" sandbox="allow-same-origin" tabIndex={-1} srcDoc={previewHtml} onLoad={()=>setLoaded(value=>value+1)}/><canvas ref={visible} className="font-source-preview" role="img" aria-label="Selected font preview">Selected font sample</canvas>{error&&<p role="alert">Font preview failed: {error}</p>}</>:null;
}

function InspectorBody({host,onEmbed}:{host:FontSourceHost;onEmbed?:EmbedFace}){
  const input=useRef<HTMLInputElement>(null),job=useRef<AbortController|null>(null),generation=useRef(0);
  const [file,setFile]=useState<File|null>(null),[report,setReport]=useState<FontInspection|null>(null),[selected,setSelected]=useState<number|null>(null);
  const [prepared,setPrepared]=useState<PreparedFontSource|null>(null),[sample,setSample]=useState('Canoli Studio — Aa 0123');
  const [loading,setLoading]=useState(false),[phase,setPhase]=useState(''),[error,setError]=useState(''),[axisPage,setAxisPage]=useState(0);
  const [embedded,setEmbedded]=useState(false);
  useEffect(()=>()=>{generation.current++;job.current?.abort(new Error('Font inspector closed.'));},[]);
  const run=async(source:File,mode:'inspect'|'prepare'|'embed',offset=0)=>{
    job.current?.abort(new Error('Font source operation replaced.'));
    const abort=new AbortController(),key=++generation.current;job.current=abort;
    setLoading(true);setError('');setEmbedded(false);setPrepared(null);setAxisPage(0);
    const control:FontSourceControl={signal:abort.signal,onProgress:progress=>{if(generation.current===key)setPhase(progress.phase);}};
    try{
      if(mode==='inspect'){
        setSelected(null);const value=await host.inspectFont(source,{offset,limit:16},control);
        if(key!==generation.current||abort.signal.aborted)return;
        setReport(value);if(value.faceCount===1)setSelected(0);
      }else if(mode==='embed'){
        if(selected===null||!onEmbed)throw new Error('Choose a face to embed.');
        await onEmbed(source,selected,control);
        if(key!==generation.current||abort.signal.aborted)return;setEmbedded(true);
      }else{
        if(selected===null)throw new Error('Choose a face to preview.');
        const value=await host.prepareFontSource(source,{faceIndex:selected},control);
        if(key!==generation.current||abort.signal.aborted)return;setPrepared(value);
      }
    }catch(cause){if(key===generation.current)setError(cause instanceof Error?cause.message:String(cause));}
    finally{if(key===generation.current){setLoading(false);setPhase('');job.current=null;}}
  };
  const face=report?.faces.find(value=>value.index===selected),axes=face?.axes??[];
  return <div className="font-source-body">
    <p>Inspect TTF, OTF, WOFF, WOFF2, TTC or SFNT datafork files. Previews stay separate from your document.{onEmbed?' Embed a selected face explicitly to use and save it with this document.':' Inspection does not install or embed fonts.'}</p>
    {embedded&&<p role="status">Font embedded. Choose it in the replacement presets or Typography controls.</p>}
    <input ref={input} type="file" hidden data-testid="font-source-input" aria-label="Font file source" accept=".ttf,.otf,.woff,.woff2,.ttc,.dfont" onChange={event=>{
      const source=event.target.files?.[0];event.target.value='';if(!source)return;
      setFile(source);setReport(null);setSelected(null);void run(source,'inspect');
    }}/>
    <div className="dialog-actions"><Button variant="subtle" onClick={()=>input.current?.click()}>Choose font file…</Button><Button variant="subtle" disabled={!file||loading} onClick={()=>{if(file)void run(file,'inspect');}}>Inspect again</Button>{loading&&<Button variant="subtle" onClick={()=>job.current?.abort(new Error('Font source operation cancelled.'))}>Cancel font operation</Button>}</div>
    {file&&<p>Source: {label(file.name)} · {file.size.toLocaleString()} bytes</p>}
    {loading&&<p role="status">{phase==='reading'?'Reading font source…':phase==='extracting'?'Preparing selected face…':phase==='validating'?'Validating native font…':'Inspecting font source…'}</p>}
    {error&&<p role="alert">{error}</p>}
    {report&&<>
      <p>{report.format.toUpperCase()} · {report.faceCount.toLocaleString()} face{report.faceCount===1?'':'s'} · Showing {report.offset+1}–{report.offset+report.faces.length}</p>
      <Select label="Font file face" layout="stacked" disabled={loading} value={selected===null?'':String(selected)} options={[{value:'',label:'Choose a face'},...report.faces.map(face=>({value:String(face.index),label:`${face.index+1}. ${label(face.fullName??face.family,120)}`}))]} onChange={value=>{setSelected(value===''?null:Number(value));setPrepared(null);setAxisPage(0);}}/>
      <div className="dialog-actions"><Button variant="subtle" disabled={loading||report.offset===0} onClick={()=>{if(file)void run(file,'inspect',Math.max(0,report.offset-16));}}>Previous file faces</Button><Button variant="subtle" disabled={loading||report.offset+report.faces.length>=report.faceCount} onClick={()=>{if(file)void run(file,'inspect',report.offset+report.faces.length);}}>Next file faces</Button></div>
    </>}
    {face&&<>
      <dl className="font-source-metadata">
        <dt>Family</dt><dd dir="auto">{label(face.family)}</dd><dt>Style</dt><dd dir="auto">{label(face.subfamily)}</dd><dt>PostScript name</dt><dd dir="auto">{label(face.postscriptName)}</dd>
        <dt>Glyphs</dt><dd>{face.glyphCount.toLocaleString()}</dd><dt>Units per em</dt><dd>{face.unitsPerEm.toLocaleString()}</dd>
        <dt>Weight class</dt><dd>{face.weightClass??'Not declared'}</dd><dt>Width class</dt><dd>{face.widthClass??'Not declared'}</dd><dt>Embedding flags</dt><dd>{face.embeddingFlags===null?'Not declared':`0x${face.embeddingFlags.toString(16).padStart(4,'0')}`}</dd>
      </dl>
      {face.copyright&&<details><summary>Declared copyright</summary><p dir="auto">{label(face.copyright,4096)}</p></details>}
      {axes.length>0&&<><p>Variation axes: {axes.length}</p><ul>{axes.slice(axisPage*16,axisPage*16+16).map(axis=><li key={axis.tag}>{axis.tag} · {label(axis.name,100)} · {axis.min} / {axis.default} / {axis.max} (min / default / max)</li>)}</ul>{axes.length>16&&<div className="dialog-actions"><Button variant="subtle" disabled={axisPage===0} onClick={()=>setAxisPage(axisPage-1)}>Previous font axes</Button><Button variant="subtle" disabled={(axisPage+1)*16>=axes.length} onClick={()=>setAxisPage(axisPage+1)}>Next font axes</Button></div>}</>}
      <Button variant="subtle" disabled={loading} onClick={()=>{if(file)void run(file,'prepare');}}>Preview selected face</Button>
      {onEmbed&&<><p>Embedding retains the complete original file in saved projects. Review its declared embedding flags and your font license before sharing.</p><Button variant="secondary" disabled={loading} onClick={()=>{if(file)void run(file,'embed');}}>Embed selected face</Button></>}
    </>}
    {prepared&&<>
      <p role="status">Selected face is ready for preview.</p>
      {prepared.repacked&&<p>This collection face was repacked for native preview. {prepared.omittedTables.length?'Its digital-signature table was omitted during repacking. ':''}The original file is unchanged.</p>}
      <TextInput label="Font preview sample" layout="stacked" value={sample} maxLength={512} onChange={setSample}/>
      <p>Characters absent from this face use browser fallback.</p>
    </>}
    <FontPreview prepared={prepared} sample={sample}/>
  </div>;
}

export function FontSourceInspector({host,onEmbed}:{host:FontSourceHost;onEmbed?:EmbedFace}){
  const [open,setOpen]=useState(false);
  return <details className="font-source-inspector" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Inspect font files</summary>{open&&<InspectorBody host={host} onEmbed={onEmbed}/>}</details>;
}
