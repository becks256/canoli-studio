import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {ClipboardCheck,Download,X} from 'lucide-react';
import type {EditorApplication} from '../editor';
import {preflightOptionsSchema,type PreflightReport} from '../core/preflight';
import {exportFontFamilies} from '../core/font-references';
import {Dialog} from './Dialog';
import {Button,IconButton,NumberField} from './controls';

export function PreflightDialog({editor,onClose}:{editor:EditorApplication;onClose:()=>void}){
  const state=useSyncExternalStore(editor.subscribe,editor.getSnapshot);
  const [options,setOptions]=useState(()=>preflightOptionsSchema.parse({})),[report,setReport]=useState<PreflightReport|null>(null),[error,setError]=useState(''),[running,setRunning]=useState(false);
  const pending=useRef<AbortController|null>(null),mounted=useRef(true);
  const requestedFonts=useRef(new Set<string>());
  const familyKey=(family:string)=>family.trim().replace(/^(['"])(.*)\1$/,'$2').toLowerCase();
  const [fontEpoch,setFontEpoch]=useState(0),[reportFontEpoch,setReportFontEpoch]=useState(0);
  useEffect(()=>{
    const changed=(event:Event)=>{if((event as Event&{fontfaces?:readonly FontFace[]}).fontfaces?.some(face=>requestedFonts.current.has(familyKey(face.family))))setFontEpoch(value=>value+1);};document.fonts?.addEventListener('loadingdone',changed);document.fonts?.addEventListener('loadingerror',changed);
    return()=>{document.fonts?.removeEventListener('loadingdone',changed);document.fonts?.removeEventListener('loadingerror',changed);};
  },[]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.abort(new Error('Design checks closed.'));};},[]);
  const stale=!!report&&(report.documentId!==state.document.id||report.revision!==state.state.revision||JSON.stringify(report.options)!==JSON.stringify(options)||(report.options.checkFonts&&reportFontEpoch!==fontEpoch));
  const run=async()=>{
    pending.current?.abort();const abort=new AbortController();pending.current=abort;setRunning(true);setError('');
    requestedFonts.current=new Set(options.checkFonts?exportFontFamilies(editor.document.getSnapshot().document,options.includeHidden).map(familyKey):[]);
    try{const result=await editor.preflight(options,{signal:abort.signal});if(mounted.current&&!abort.signal.aborted){setReport(result);setReportFontEpoch(fontEpoch);}}
    catch(cause){if(mounted.current)setError(abort.signal.aborted?'Design checks cancelled.':cause instanceof Error?cause.message:String(cause));}
    finally{if(mounted.current&&pending.current===abort){pending.current=null;setRunning(false);}}
  };
  const download=()=>{
    if(!report||stale)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='canoli-design-checks.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <Dialog titleId="preflight-title" className="preflight-dialog" onClose={onClose}>
    <div className="dialog-heading"><div><div className="dialog-caption">LOCAL INSPECTION</div><h2 id="preflight-title"><ClipboardCheck size={20}/> Design checks</h2></div><IconButton label="Close design checks" onClick={onClose}><X size={18}/></IconButton></div>
    <p className="dialog-subtitle">Review font families, authored bounds and original raster sampling before delivery. Checks do not change your document.</p>
    <div className="preflight-policy">
      <div className="preflight-presets"><Button variant="subtle" disabled={running} onClick={()=>setOptions({...options,outputDpi:72,minimumPpi:72})}>Pixel output</Button><Button variant="subtle" disabled={running} onClick={()=>setOptions({...options,outputDpi:300,minimumPpi:150})}>Print sampling</Button></div>
      <NumberField label="Inspection output DPI" value={options.outputDpi} min={.01} max={Number.MAX_VALUE} disabled={running} onChange={value=>setOptions({...options,outputDpi:value})}/>
      <NumberField label="Minimum source PPI" value={options.minimumPpi} min={.01} max={Number.MAX_VALUE} disabled={running} onChange={value=>setOptions({...options,minimumPpi:value})}/>
      <label><input type="checkbox" checked={options.checkFonts} disabled={running} onChange={event=>setOptions({...options,checkFonts:event.target.checked})}/>Check browser font families</label>
      <label><input type="checkbox" checked={options.checkBounds} disabled={running} onChange={event=>setOptions({...options,checkBounds:event.target.checked})}/>Check bounds beyond the canvas</label>
      <label><input type="checkbox" checked={options.includeHidden} disabled={running} onChange={event=>setOptions({...options,includeHidden:event.target.checked})}/>Include hidden and zero-opacity layers</label>
      <p>DPI and PPI are inspection settings. They do not resample artwork, change document size or certify print readiness. Font probes use only requested family names, without enumerating or uploading font files.</p>
    </div>
    {error&&<p role="alert" className="preflight-error">{error}</p>}
    {running&&<p role="status">Checking this document…</p>}
    {stale&&<p role="status">This report is out of date. Run checks again for the current document and settings.</p>}
    {report&&<section aria-label="Design check results" className="preflight-results">
      <p>{report.counts.error} errors · {report.counts.warning} warnings · {report.counts.info} unverified findings · {report.layersChecked} layer placements checked</p>
      {report.totalFindings===0&&<p>No findings in these enabled checks. Review the inspection limits below.</p>}
      {report.truncated&&<p>Showing the first {report.findings.length} of {report.totalFindings} findings. Summary counts include all findings.</p>}
      <ul className="preflight-findings" tabIndex={0} aria-label="Inspection findings">{report.findings.map((finding,index)=><li key={index} data-check-code={finding.code}>
        <span className={`preflight-severity ${finding.severity}`}>{finding.severity}</span><div><strong>{finding.layerName}</strong><p>{finding.family&&<span>{finding.family}: </span>}{finding.message}</p></div>
        <Button variant="subtle" disabled={stale||running} onClick={()=>{const layer=editor.document.getLayer(finding.layerId);if(layer){editor.document.selectedLayer=layer;onClose();}}}>Select layer</Button>
      </li>)}</ul>
      <details><summary>Inspection limits</summary><ul>{report.limitations.map(limit=><li key={limit}>{limit}</li>)}</ul></details>
    </section>}
    <div className="preflight-footer"><Button variant="subtle" disabled={!report||stale||running} onClick={download}><Download size={14}/> Download report</Button><span/>{running?<Button onClick={()=>pending.current?.abort(new Error('Design checks cancelled.'))}>Cancel checks</Button>:<Button onClick={()=>void run()}>Run checks</Button>}</div>
  </Dialog>;
}
