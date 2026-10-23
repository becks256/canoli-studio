import {useEffect, useMemo, useRef, useState} from 'react';
import type {EditorApplication} from '../editor';
import type {Document} from '../dom';
import type {EditorState} from '../core/store';
import {comparisonExtent, resolveHistoryTarget, type HistoryTarget, type HistoryRegion} from '../core/history';
import {displayHistoryLabel, historyTimeline} from '../core/history-inspection';
import type {HistoryDifferenceStatistics} from '../engine/history-comparison';
import {Button, NumberField, Select, TextInput} from './controls';
import {HistoryOperationInfo} from './HistoryOperationInfo';

type Capture = {document: Document; state: EditorState};
const current = JSON.stringify({kind:'current'});
function RegionInputs({label, value, extent, onChange}: {label: string; value: HistoryRegion; extent: HistoryRegion; onChange(value: HistoryRegion): void}) {
  return <div className="history-region-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <NumberField key={key} label={`${label} ${key}`} value={value[key]} min={key === 'x' || key === 'y' ? 0 : 1} max={key === 'x' || key === 'width' ? extent.width : extent.height} integer onCommit={next => onChange({...value, [key]:next})}/>)}</div>;
}
export function HistoryComparisons({editor, capture, check, reload}: {editor: EditorApplication; capture: Capture; check(): void; reload(): void}) {
  const [name, setName] = useState(''), [before, setBefore] = useState(current), [after, setAfter] = useState(current);
  const [region, setRegion] = useState(() => comparisonExtent(capture.state.document, capture.state.document));
  const [selectedId, setSelectedId] = useState(capture.state.comparisons[0]?.id ?? '');
  const [savedName, setSavedName] = useState(''), [savedRegion, setSavedRegion] = useState(region), [branchName, setBranchName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{before:string;after:string;difference:string;width:number;height:number;statistics:HistoryDifferenceStatistics} | null>(null);
  const abort = useRef<AbortController | null>(null), urls = useRef<string[]>([]), alive = useRef(true);
  const selected = capture.state.comparisons.find(value => value.id === selectedId);
  const options = useMemo(() => [{value:current,label:'Current document state'},
    ...historyTimeline(capture.state).map(value => ({value:JSON.stringify({kind:'timeline',position:value.position}), label:`State ${value.position}: ${value.label}`})),
    ...capture.state.branches.map(value => ({value:JSON.stringify({kind:'branch',branchId:value.id}),label:`Branch ${value.name}: accepted tip`}))], [capture]);
  const beforeValue = options.some(option => option.value === before) ? before : current;
  const afterValue = options.some(option => option.value === after) ? after : current;
  const extent = (a: string, b: string) => comparisonExtent(resolveHistoryTarget(capture.state, JSON.parse(a) as HistoryTarget).document, resolveHistoryTarget(capture.state, JSON.parse(b) as HistoryTarget).document);
  const clearPreview = () => {for (const url of urls.current) URL.revokeObjectURL(url); urls.current=[]; setPreview(null);};
  const cancel = () => {abort.current?.abort(); abort.current=null; setBusy(false);};
  useEffect(() => {alive.current=true; return () => {alive.current=false; abort.current?.abort(); for (const url of urls.current) URL.revokeObjectURL(url);};}, []);
  useEffect(() => {
    cancel(); clearPreview(); setConfirmDelete(false);
    const value = capture.state.comparisons.find(value => value.id === selectedId) ?? capture.state.comparisons[0];
    setSelectedId(value?.id ?? ''); setSavedName(value?.name ?? ''); if(value) setSavedRegion(value.region);
    if (!options.some(option => option.value === before) || !options.some(option => option.value === after)) {setBefore(current); setAfter(current); setRegion(comparisonExtent(capture.state.document,capture.state.document));}
    // Captures change only on explicit reload or an accepted history-management action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture]);
  const mutate = (run: () => void) => {try {check(); run(); setError(''); reload();} catch(cause) {setError(cause instanceof Error ? cause.message : String(cause));}};
  const render = async () => {
    if (!selected) return; cancel(); clearPreview(); const pending = new AbortController(); abort.current=pending; setBusy(true); setError('');
    try {
      check(); const value=await editor.previewHistoryComparison(selected.id,{signal:pending.signal}); check();
      if (!alive.current || pending.signal.aborted || abort.current!==pending) return;
      const before=URL.createObjectURL(value.before),after=URL.createObjectURL(value.after),difference=URL.createObjectURL(value.difference);urls.current=[before,after,difference];
      setPreview({...value,before,after,difference});
    } catch(cause) {if(alive.current&&!pending.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
    finally {if(alive.current&&abort.current===pending){abort.current=null;setBusy(false);}}
  };
  return <section aria-label="Saved history comparisons"><h3>Saved comparisons</h3>
    <p>Pin any two accepted states and a document-pixel region. Saved states survive history pruning and branch deletion. Previewing never changes the live document.</p>
    {error && <p role="alert">{error}</p>}
    {!!capture.state.comparisons.length && <>
      <Select label="Saved history comparison" value={selectedId} options={capture.state.comparisons.map(value=>({value:value.id,label:value.name}))} disabled={busy} onChange={id=>{cancel();clearPreview();setSelectedId(id);setConfirmDelete(false);setError('');const value=capture.state.comparisons.find(value=>value.id===id)!;setSavedName(value.name);setSavedRegion(value.region);}}/>
      {selected && <>
        <p>Captured before: {displayHistoryLabel(selected.beforeLabel)}. Captured after: {displayHistoryLabel(selected.afterLabel)}.</p><HistoryOperationInfo document={capture.document} operation={selected.beforeProvenance} label="Captured before provenance"/><HistoryOperationInfo document={capture.document} operation={selected.afterProvenance} label="Captured after provenance"/>
        <TextInput label="Saved comparison name" value={savedName} maxLength={120} onChange={setSavedName} disabled={busy}/>
        <RegionInputs label="Saved region" value={savedRegion} extent={comparisonExtent(selected.before,selected.after)} onChange={setSavedRegion}/>
        <div className="history-inspector-actions"><Button disabled={busy||!savedName.trim()} onClick={()=>mutate(()=>capture.document.updateHistoryComparison(selected.id,{name:savedName,region:savedRegion}))}>Save comparison details</Button><Button disabled={busy} onClick={()=>void render()}>Preview saved comparison</Button><Button variant="danger" disabled={busy} onClick={()=>setConfirmDelete(true)}>Delete saved comparison</Button></div>
        {confirmDelete && <div><p>Delete “{selected.name}” and release its pinned states? Save a project backup first if you need this comparison.</p><div className="history-inspector-actions"><Button variant="danger" disabled={busy} onClick={()=>mutate(()=>capture.document.deleteHistoryComparison(selected.id))}>Confirm delete comparison</Button><Button onClick={()=>setConfirmDelete(false)}>Keep comparison</Button></div></div>}
        <TextInput label="Comparison branch name" value={branchName} maxLength={120} onChange={setBranchName} disabled={busy}/>
        <div className="history-inspector-actions"><Button disabled={busy||!branchName.trim()} onClick={()=>mutate(()=>{capture.document.createHistoryBranchFromComparison(selected.id,'before',branchName);})}>Continue before as branch</Button><Button disabled={busy||!branchName.trim()} onClick={()=>mutate(()=>{capture.document.createHistoryBranchFromComparison(selected.id,'after',branchName);})}>Continue after as branch</Button></div>
        <p className="field-hint">Continuing creates a branch with this exact accepted state and an empty Undo path. The previous route remains available. Active recipe recording is invalidated on this switch.</p>
      </>}
    </>}
    <details><summary>Save a new comparison</summary><div className="history-new-comparison">
      <TextInput label="New comparison name" value={name} maxLength={120} onChange={setName} disabled={busy}/>
      <Select label="Before comparison state" value={beforeValue} options={options} disabled={busy} onChange={value=>{setBefore(value);setRegion(extent(value,afterValue));}}/>
      <Select label="After comparison state" value={afterValue} options={options} disabled={busy} onChange={value=>{setAfter(value);setRegion(extent(beforeValue,value));}}/>
      <RegionInputs label="New region" value={region} extent={extent(beforeValue,afterValue)} onChange={setRegion}/>
      <div className="history-inspector-actions"><Button disabled={busy} onClick={()=>setRegion(extent(beforeValue,afterValue))}>Use full comparison extent</Button><Button disabled={busy||!name.trim()} onClick={()=>mutate(()=>{const id=capture.document.createHistoryComparison(name,JSON.parse(beforeValue) as HistoryTarget,JSON.parse(afterValue) as HistoryTarget,region);setSelectedId(id);})}>Save new comparison</Button></div>
    </div></details>
    <p className="field-hint">Regions use integer document pixels in the shared top-left coordinate plane; outside a smaller canvas is transparent. Previews fit within 512 pixels. Difference statistics compare displayed sRGB8 premultiplied RGB and alpha, using current browser fonts. Downscaled previews do not establish full-resolution, font, ICC or photographic equality.</p>
    {busy && <div><p role="status">Rendering saved comparison…</p><Button onClick={cancel}>Cancel comparison preview</Button></div>}
    {preview && <>
      <p role="status">Rendered region: {preview.width} × {preview.height} pixels. {preview.statistics.changedPixels} of {preview.statistics.comparedPixels} displayed pixels changed; maximum channel delta {preview.statistics.maximumChannelDelta}/255; mean absolute channel delta {preview.statistics.meanAbsoluteChannelDelta.toFixed(4)}/255.</p>
      <div className="history-preview-pair"><figure><figcaption>Saved before state</figcaption><img src={preview.before} alt="Saved comparison before"/></figure><figure><figcaption>Saved after state</figcaption><img src={preview.after} alt="Saved comparison after"/></figure><figure><figcaption>Displayed difference · black unchanged, magenta intensity = maximum channel delta</figcaption><img src={preview.difference} alt="Saved comparison difference"/></figure></div>
    </>}
  </section>;
}
