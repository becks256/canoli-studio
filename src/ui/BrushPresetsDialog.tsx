import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button, IconButton, TextInput } from './controls';
import { download } from './utils';
import { storageErrorMessage } from '../core/storage-errors';
import { BrushPreset, BUILTIN_BRUSH_PRESETS, BRUSH_TOOL_NAMES, type BrushTool } from '../brushes/presets';
import type { BrushPresetLibrary, SavedBrushPreset } from '../brushes/library';
import type { ToolSettings } from '../tools';
import type {BrushTextureSourceOwner} from '../brushes/texture-source';
import {captureBrushPreset,exportBrushPack} from '../brushes/portable';

const percent = (value:number) => Number((value * 100).toPrecision(15));

export function BrushPresetsDialog({library, tool, settings, sourceOwner, onApply, onClose}: {
  library: BrushPresetLibrary; tool: BrushTool; settings: ToolSettings; sourceOwner:BrushTextureSourceOwner;
  onApply(preset: BrushPreset,signal:AbortSignal): Promise<void>; onClose(): void;
}) {
  const snapshot = useSyncExternalStore(library.subscribe, library.getSnapshot);
  const [selected, setSelected] = useState<SavedBrushPreset>({preset:BUILTIN_BRUSH_PRESETS[0], revision:0});
  const [query, setQuery] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [name, setName] = useState('Untitled brush');
  const [includeColor, setIncludeColor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<Blob | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const input = useRef<HTMLInputElement>(null), pending = useRef<AbortController | null>(null);
  useEffect(() => { void library.reload(); return () => { pending.current?.abort(); }; }, [library]);
  const choose = (value: SavedBrushPreset) => { setSelected(value); setName(value.preset.name); setIncludeColor(value.preset.color !== undefined); setError(null); };
  const current = snapshot.presets.find(value => value.preset.id === selected.preset.id);
  const builtin = BUILTIN_BRUSH_PRESETS.some(value => value.id === selected.preset.id);
  const stale = !builtin && (!current || current.revision !== selected.revision);
  const capture = (signal:AbortSignal) => captureBrushPreset(name, tool, settings, sourceOwner, includeColor, signal);
  const run = async (operation: (signal:AbortSignal) => Promise<void>) => {
    if (pending.current) return;
    const abort = new AbortController(); pending.current = abort; setBusy(true); setError(null); setMessage(null);
    try { await operation(abort.signal); }
    catch (error) { if (!abort.signal.aborted) setError(storageErrorMessage(error)); }
    finally { if (pending.current === abort) { pending.current = null; setBusy(false); } }
  };
  const saveNew = () => run(async signal => { const value = await library.save(await capture(signal), 0, signal); choose(value); setMessage('Brush preset saved locally.'); });
  const saveUpdate = (settingsToo:boolean) => run(async signal => {
    const captured=settingsToo?await capture(signal):null;
    const value = captured ? new BrushPreset({...captured.toJSON(), id:selected.preset.id},captured.source) : selected.preset.with({name});
    const saved = await library.save(value, selected.revision, signal); choose(saved); setMessage('Brush preset updated.');
  });
  const exportFile = (blob:Blob, stem:string) => download(blob, `${stem}.canoli-brushes${blob.type==='application/json'?'.json':''}`);
  const all = [...BUILTIN_BRUSH_PRESETS.map(preset => ({preset, revision:0})), ...snapshot.presets];
  const filtered = all.filter(value => `${value.preset.name} ${BRUSH_TOOL_NAMES[value.preset.tool]}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 100));
  const visiblePage = Math.min(pageIndex, pageCount - 1);
  const shown = filtered.slice(visiblePage * 100, (visiblePage + 1) * 100);
  const values = selected.preset.settings;
  return <Dialog titleId="brush-presets-title" className="brush-presets-dialog" onClose={onClose}>
    <div className="dialog-heading"><div><span className="section-caption">BRUSH LIBRARY</span><h2 id="brush-presets-title">Brush presets</h2></div><IconButton label="Close brush presets" autoFocus onClick={onClose}><X size={19}/></IconButton></div>
    <p>Save the current tool and brush dynamics for later. Applying a preset changes future strokes; existing artwork and paint targets stay as they are.</p>
    {(error || snapshot.error) && <p role="alert">{error ?? snapshot.error} <Button disabled={busy} onClick={()=>{setError(null);void library.reload();}}>Retry loading</Button></p>}
    {snapshot.error&&<section aria-label="Brush library recovery"><p>Keep a recovery backup before resetting saved presets. Current artwork is unaffected.</p><Button disabled={busy} onClick={()=>void run(async signal=>{const file=await library.exportRecoveryFile(signal);download(file,file.type==='application/json'?'recovery.canoli-brush-library.json':'recovery.canoli-brush-library');setBackup(file);setConfirmReset(false);setMessage('Recovery backup downloaded.');})}>Download recovery backup</Button><label className="check-field"><input type="checkbox" disabled={busy||!backup} checked={confirmReset} onChange={event=>setConfirmReset(event.target.checked)}/>I have kept the backup and want to reset saved brush presets</label><Button variant="danger" disabled={busy||!backup||!confirmReset} onClick={()=>void run(async signal=>{await library.resetFromRecoveryFile(backup!,signal);setBackup(null);setConfirmReset(false);choose({preset:BUILTIN_BRUSH_PRESETS[0],revision:0});setMessage('Brush library reset. Import a valid brush pack to restore saved presets.');})}>Reset saved brush presets</Button></section>}
    {(busy||message) && <p role="status">{busy?"Preparing brush data…":message}</p>}
    <div className="brush-presets-layout">
      <section aria-label="Brush preset library">
        <TextInput label="Search brush presets" layout="stacked" value={query} onChange={value=>{setQuery(value);setPageIndex(0);}}/>
        <p className="text-muted">{filtered.length} presets · {snapshot.presets.length} saved locally</p>
        <div className="brush-presets-list" aria-label="Available brush presets">{shown.map(value => <button type="button" className={`brush-preset-row ${selected.preset.id===value.preset.id?'selected':''}`} aria-pressed={selected.preset.id===value.preset.id} disabled={busy} key={value.preset.id} onClick={()=>choose(value)} onDoubleClick={()=>void run(signal=>onApply(value.preset,signal))}>
          <strong>{value.preset.name}</strong><span>{BRUSH_TOOL_NAMES[value.preset.tool]} · {value.preset.settings.size} px · {value.revision===0?'Built-in':'Saved'}</span>
        </button>)}{!filtered.length&&<p>No matching brush presets.</p>}</div>
        {pageCount>1&&<div className="brush-preset-actions"><Button disabled={visiblePage===0||busy} onClick={()=>setPageIndex(visiblePage-1)}>Previous brush presets</Button><span>Page {visiblePage+1} of {pageCount}</span><Button disabled={visiblePage===pageCount-1||busy} onClick={()=>setPageIndex(visiblePage+1)}>Next brush presets</Button></div>}
      </section>
      <section className="brush-preset-details" aria-label="Selected brush preset">
        <h3>{selected.preset.name}</h3><p>{BRUSH_TOOL_NAMES[selected.preset.tool]} · {values.size} px · {percent(values.hardness)}% hardness</p>
        <dl><dt>Texture</dt><dd>{selected.preset.source?`${selected.preset.source.name} · ${selected.preset.source.width} × ${selected.preset.source.height} px · ${selected.preset.texture!.channel}${selected.preset.texture!.invert?" · inverted":""}${selected.preset.source.avif?` · AVIF${selected.preset.source.avif.allowPrecisionLoss?" · 8-bit conversion allowed":""}${selected.preset.source.avif.assumeSrgb?" · sRGB fallback allowed":""}`:""}${selected.preset.source.tiff?` · TIFF page ${selected.preset.source.tiff.page+1}${selected.preset.source.tiff.allowPrecisionLoss?" · 8-bit conversion allowed":""}`:""}`:"Off"}</dd><dt>Symmetry</dt><dd>{values.symmetry?`${values.symmetry.copies.length+1} captured copies`:"Off"}</dd><dt>Tip</dt><dd>{values.tip?`${percent(values.tip.roundness)}% roundness · ${values.tip.angle}° · ${values.tip.tiltAngle||values.tip.tiltRoundness?"Tilt enabled":"Fixed shape"}`:"Default tip"}</dd><dt>Opacity / flow</dt><dd>{percent(values.opacity)}% / {percent(values.flow)}%</dd><dt>Spacing / smoothing</dt><dd>{percent(values.spacing)}% / {percent(values.smoothing)}%</dd><dt>Pressure</dt><dd>{values.pressureSize?'Size':''}{values.pressureSize&&values.pressureOpacity?' and ':''}{values.pressureOpacity?'Opacity':''}{!values.pressureSize&&!values.pressureOpacity?'Off':''} · {values.pressureCurve?`${values.pressureCurve.points.length} curve points`:'Default response'}</dd><dt>Color</dt><dd>{selected.preset.color ?? 'Keep current foreground'}</dd>{selected.preset.tool==='clone'&&<><dt>Clone sampling</dt><dd>{values.cloneAligned?'Aligned':'Unaligned'}</dd></>}{(selected.preset.tool==='dodge'||selected.preset.tool==='burn')&&<><dt>Tonal treatment</dt><dd>{values.tonalRange} · {percent(values.tonalExposure)}% exposure · {values.protectTones?'Protect tones':'Tone protection off'}</dd></>}{selected.preset.tool==='heal'&&<><dt>Healing</dt><dd>{values.patchSampling} · {values.patchMode} detail · {values.healingRadius} px search</dd></>}</dl>
        {stale&&<p role="alert">This preset changed or was removed in another tab. {current&&<Button disabled={busy} onClick={()=>choose(current)}>Reload selected preset</Button>}</p>}
        <div className="brush-preset-actions"><Button variant="primary" disabled={busy} onClick={()=>void run(signal=>onApply(selected.preset,signal))}>Apply preset</Button><Button disabled={busy} onClick={()=>void run(async signal=>exportFile(await exportBrushPack([selected.preset],signal),'brush'))}>Export selected</Button><Button disabled={busy||!!snapshot.error} onClick={()=>void run(async signal=>{const value=await library.save(selected.preset.duplicate(),0,signal);choose(value);setMessage('Preset duplicated.');})}>Duplicate preset</Button></div>
        <TextInput label="Preset name" layout="stacked" disabled={busy} value={name} maxLength={120} onChange={setName}/>
        <label className="check-field"><input type="checkbox" checked={includeColor} disabled={busy} onChange={event=>setIncludeColor(event.target.checked)}/>Include current foreground color</label>
        <p className="text-muted">Save current settings from {BRUSH_TOOL_NAMES[tool]}. Texture images retain their original bytes. Clone source positions and document targets stay in the current document.</p>
        <div className="brush-preset-actions"><Button disabled={busy||!!snapshot.error||!name.trim()} onClick={()=>void saveNew()}>Save current as new</Button><Button disabled={busy||builtin||stale||!!snapshot.error||!name.trim()} onClick={()=>void saveUpdate(false)}>Rename preset</Button><Button disabled={busy||builtin||stale||!!snapshot.error||!name.trim()} onClick={()=>void saveUpdate(true)}>Update from current tool</Button><Button variant="danger" disabled={busy||builtin||stale||!!snapshot.error} onClick={()=>void run(async signal=>{await library.remove(selected.preset.id,selected.revision,signal);choose({preset:BUILTIN_BRUSH_PRESETS[0],revision:0});setMessage('Preset deleted.');})}>Delete preset</Button></div>
      </section>
    </div>
    <div className="brush-preset-actions brush-preset-footer"><input ref={input} type="file" accept="application/json,application/x-canoli-brush-pack,.json,.canoli-brushes" aria-label="Import brush pack file" hidden onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void run(async signal=>{const values=await library.importFile(file,signal);if(values[0])choose(values[0]);setMessage(`Imported ${values.length} brush presets as new copies.`);});}}/><Button disabled={busy||!!snapshot.error} onClick={()=>input.current?.click()}>Import brush pack</Button><Button disabled={busy||!snapshot.presets.length} onClick={()=>void run(async signal=>exportFile(await library.exportFile(undefined,signal),'library'))}>Export saved library</Button><Button disabled={busy||!name.trim()} onClick={()=>void run(async signal=>exportFile(await exportBrushPack([await capture(signal)],signal),'current'))}>Download current brush</Button><Button onClick={onClose}>{busy?'Cancel':'Close'}</Button></div>
  </Dialog>;
}
