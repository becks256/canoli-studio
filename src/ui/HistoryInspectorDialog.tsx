import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {X} from 'lucide-react';
import type {EditorApplication} from '../editor';
import {historyTimeline, inspectHistoryChange} from '../core/history-inspection';
import {Dialog} from './Dialog';
import {Button, IconButton, Select, TextInput} from './controls';

const fieldNames = (values:string[]) => values.map(value => value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,letter=>letter.toUpperCase())).join(', ');

export function HistoryInspectorDialog({editor, onClose}: {editor: EditorApplication; onClose(): void}) {
  const id = useId(), [capture, setCapture] = useState(() => ({document: editor.document, state: editor.document.getSnapshot()}));
  const [position, setPosition] = useState(capture.state.past.length), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [branchId, setBranchId] = useState(capture.state.activeBranchId ?? ''), [branchName, setBranchName] = useState(''), [deleteId, setDeleteId] = useState('');
  const [images, setImages] = useState<{before: string | null; after: string} | null>(null);
  const pending = useRef<AbortController | null>(null), urls = useRef<string[]>([]), alive = useRef(true);
  const timeline = useMemo(() => historyTimeline(capture.state), [capture]);
  const summary = useMemo(() => inspectHistoryChange(position ? timeline[position - 1].document : null, timeline[position].document), [timeline, position]);
  const clearImages = () => {for (const url of urls.current) URL.revokeObjectURL(url); urls.current = []; setImages(null);};
  const cancel = () => {pending.current?.abort(); pending.current = null; setBusy(false);};
  useEffect(() => {alive.current = true; return () => {alive.current = false; pending.current?.abort(); for (const url of urls.current) URL.revokeObjectURL(url);};}, []);
  const check = () => {
    if (editor.document !== capture.document || capture.document.getSnapshot().revision !== capture.state.revision)
      throw new Error('History changed. Reload the timeline before previewing or navigating.');
  };
  const reload = () => {
    cancel(); clearImages(); const document = editor.document, state = document.getSnapshot();
    setCapture({document, state}); setPosition(state.past.length); setBranchId(state.activeBranchId ?? ''); setDeleteId(''); setError('');
  };
  const mutateBranch = (run: () => void) => {
    try {check(); run(); reload();} catch (cause) {setError(cause instanceof Error ? cause.message : String(cause));}
  };
  const selectedBranch = capture.state.branches.find(branch => branch.id === branchId);
  const preview = async () => {
    cancel(); clearImages(); const abort = new AbortController(); pending.current = abort; setBusy(true); setError('');
    try {
      check(); const value = await editor.previewHistory(position, {signal: abort.signal}); check();
      if (!alive.current || abort.signal.aborted || pending.current !== abort) return;
      const before = value.before ? URL.createObjectURL(value.before) : null, after = URL.createObjectURL(value.after);
      urls.current = [...(before ? [before] : []), after]; setImages({before, after});
    } catch (cause) {if (alive.current && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));}
    finally {if (alive.current && pending.current === abort) {pending.current = null; setBusy(false);}}
  };
  return <Dialog titleId={id} className="history-inspector-dialog" localEscape onClose={() => {cancel(); onClose();}}>
    <div className="dialog-heading"><div><span className="section-caption">RETAINED DOCUMENT STATES</span><h2 id={id}>Inspect history</h2></div><IconButton label="Close history inspector" onClick={onClose}><X size={18}/></IconButton></div>
    <div className="history-inspector-body">
      <p>Inspect a retained operation, then explicitly move to its result. Moving restores stored artwork without rerunning commands, decoders or generation. Editing before the latest state preserves the previous result as a separate branch.</p>
      <p className="field-hint">This timeline is captured when opened; reload after other edits. Up to 60 transitions are retained. The oldest retained state may already contain earlier edits. History labels describe operations; they do not prove author, timestamp or AI provenance.</p>
      {error && <p role="alert">{error}</p>}
      <section aria-label="Document history branches"><h3>Document branches</h3>
        <p>Create a named branch from the current document state. Switching restores its latest accepted result and retained undo path. Save project and workspace recovery preserve branches and their sources.</p>
        {capture.state.branches.length ? <>
          <Select label="Saved history branch" value={branchId} options={capture.state.branches.map(branch => ({value: branch.id, label: `${branch.name}${branch.id === capture.state.activeBranchId ? ' (active)' : ''}`}))} onChange={value => {setBranchId(value); setBranchName(capture.state.branches.find(branch => branch.id === value)?.name ?? ''); setDeleteId('');}} disabled={busy}/>
          {selectedBranch && <p>Parent: {capture.state.branches.find(branch => branch.id === selectedBranch.parentId)?.name ?? 'Root branch'}. {selectedBranch.tip.past.length} retained transitions. Fork origin: {selectedBranch.forkDocument.width} × {selectedBranch.forkDocument.height} document pixels.</p>}
        </> : <p>No branches yet. The first branch also preserves the existing route as Main.</p>}
        <TextInput label="Branch name" value={branchName} onChange={setBranchName} maxLength={120} disabled={busy}/>
        <div className="history-inspector-actions">
          <Button disabled={busy || !branchName.trim()} onClick={() => mutateBranch(() => {capture.document.createHistoryBranch(branchName);})}>Create branch from current state</Button>
          <Button disabled={busy || !selectedBranch || !branchName.trim()} onClick={() => mutateBranch(() => capture.document.renameHistoryBranch(branchId, branchName))}>Rename branch</Button>
          <Button disabled={busy || !selectedBranch || (branchId === capture.state.activeBranchId && !capture.state.future.length)} onClick={() => mutateBranch(() => capture.document.checkoutHistoryBranch(branchId))}>Switch to branch tip</Button>
          <Button variant="danger" disabled={busy || !selectedBranch || branchId === capture.state.activeBranchId || capture.state.branches.some(branch => branch.parentId === branchId)} onClick={() => setDeleteId(branchId)}>Delete branch</Button>
        </div>
        {deleteId && selectedBranch && <div><p>Delete “{selectedBranch.name}” and its retained path? Save a project backup first if you need this alternative. Active branches and parents with children cannot be deleted.</p><div className="history-inspector-actions"><Button variant="danger" onClick={() => mutateBranch(() => capture.document.deleteHistoryBranch(deleteId))}>Confirm delete branch</Button><Button onClick={() => setDeleteId('')}>Keep branch</Button></div></div>}
        <p className="field-hint">Each route retains up to 60 transitions. Branch creation and naming are persistent metadata changes, separate from Undo. Switching to another branch ends an active recipe recording with an explicit error; start a new recording there.</p>
      </section>
      <ol className="history-inspector-timeline" aria-label="Retained history states">{timeline.map(item => <li key={item.position}><Button variant="subtle" disabled={busy} aria-pressed={position === item.position} onClick={() => {cancel(); clearImages(); setPosition(item.position); setError('');}} aria-label={`Inspect history state ${item.position}: ${item.label}`}><span>{item.position}. {item.label}</span>{item.position === capture.state.past.length && <strong>Current at capture</strong>}</Button></li>)}</ol>
      <section aria-label="Selected history changes"><h3>{timeline[position].label}</h3>
        {!position ? <p>No earlier state is retained for this baseline.</p> : <>
          <p>Document fields: {fieldNames(summary.documentFields) || 'No confirmed changes'}.</p>
          {!!summary.unexaminedDocumentFields.length && <p>Not fully compared: {fieldNames(summary.unexaminedDocumentFields)}.</p>}
          <p>{summary.totalLayers} layer records with changes or incomplete comparisons. Changes to masters, paragraph styles or document settings may affect additional artwork.</p>
          <ul className="history-change-list">{summary.layers.map(layer => <li key={layer.id}><strong>{layer.name}</strong><span>{layer.change} · {layer.kind}</span>{!!layer.fields.length && <span>Fields: {fieldNames(layer.fields)}</span>}{!!layer.unexaminedFields.length && <span>Not fully compared: {fieldNames(layer.unexaminedFields)}</span>}</li>)}</ul>
          {!!summary.omittedLayers && <p>{summary.omittedLayers} additional changed records omitted from this report. All document layers remain intact.</p>}
          {summary.comparisonIncomplete && <p>Comparison metadata budget reached. Unexamined fields are not confirmed differences; use previews and inspect the document.</p>}
          {summary.bounds && <p>Shown artwork bounds: x {summary.bounds.x.toFixed(2)}, y {summary.bounds.y.toFixed(2)}, {summary.bounds.width.toFixed(2)} × {summary.bounds.height.toFixed(2)} document pixels.</p>}
          <p className="field-hint">Bounds cover listed layer geometry, not a pixel-difference region or effect spread. {summary.boundsUnavailable ? 'Some bounds are unavailable with current font/layout support.' : ''}</p>
        </>}
      </section>
      <div className="history-inspector-actions"><Button disabled={busy} onClick={() => void preview()}>Preview before and after</Button><Button disabled={busy} onClick={reload}>Reload history timeline</Button></div>
      <p className="field-hint">Previews fit the canvas into 512 pixels and use currently available browser fonts. Original document geometry and sources are unchanged. They do not establish native-pixel or cross-editor equality.</p>
      {busy && <p role="status">Rendering retained history previews…</p>}
      {images && <div className="history-preview-pair"><figure><figcaption>Before operation</figcaption>{images.before ? <img src={images.before} alt="History before operation"/> : <p>No earlier retained state.</p>}</figure><figure><figcaption>After operation</figcaption><img src={images.after} alt="History after operation"/></figure></div>}
      <a href="/developer/history.html" target="_blank" rel="noreferrer">History navigation, snapshots and limitations</a>
    </div>
    <div className="dialog-actions">{busy && <Button onClick={cancel}>Cancel history preview</Button>}<Button variant="primary" disabled={busy || position === capture.state.past.length} onClick={() => {
      try {check(); capture.document.navigateHistory(position); onClose();} catch (cause) {setError(cause instanceof Error ? cause.message : String(cause));}
    }}>Move to selected history state</Button><Button onClick={onClose}>Done</Button></div>
  </Dialog>;
}
