import {useEffect, useId, useRef, useState, useSyncExternalStore} from 'react';
import {X} from 'lucide-react';
import type {PaletteLibrary} from '../palettes/service';
import {paletteMatches, type Palette, type PaletteEntry} from '../palettes/model';
import {Dialog} from './Dialog';
import {Button, IconButton, TextInput, TextArea} from './controls';
import {download} from './utils';

export function PaletteLibraryDialog({library, color = '#d5e79b', onChoose, onClose}: {
  library: PaletteLibrary; color?: string; onChoose?(color: string): void; onClose(): void;
}) {
  const id = useId(), snapshot = useSyncExternalStore(library.subscribe, library.getSnapshot);
  const [query, setQuery] = useState(''), [page, setPage] = useState(0), [swatchPage, setSwatchPage] = useState(0);
  const [draft, setDraft] = useState<{entry: PaletteEntry | null; palette: Palette} | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [clear, setClear] = useState(false), input = useRef<HTMLInputElement>(null), alive = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {alive.current = true; void library.refresh().catch(() => {});
    return () => {alive.current = false; pending.current?.abort();};
  }, [library]);
  const perform = async (run: (signal: AbortSignal) => Promise<void>) => {
    pending.current?.abort(); const abort = new AbortController(); pending.current = abort;
    setBusy(true); setError(''); setMessage('');
    try {await run(abort.signal);} catch (cause) {
      if (alive.current && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {if (alive.current && pending.current === abort) {pending.current = null; setBusy(false);}}
  };
  const close = () => {pending.current?.abort(); onClose();};
  const choose = (entry: PaletteEntry) => {setDraft({entry, palette: structuredClone(entry.palette)}); setSwatchPage(0); setError(''); setMessage('');};
  const change = (patch: Partial<Palette>) => setDraft(value => value ? {...value, palette: {...value.palette, ...patch}} : value);
  const swatches = draft?.palette.swatches ?? [], swatchPages = Math.max(1, Math.ceil(swatches.length / 32));
  const currentSwatchPage = Math.min(swatchPage, swatchPages - 1);
  const filtered = snapshot.entries.filter(row => !row.entry ? !query : paletteMatches(row.entry.palette, query));
  const pages = Math.max(1, Math.ceil(filtered.length / 40)), currentPage = Math.min(page, pages - 1);
  const validIds = snapshot.entries.flatMap(row => row.entry ? [row.entry.id] : []);
  const pick = (value: string) => {try {onChoose?.(value); close();} catch (cause) {setError(cause instanceof Error ? cause.message : String(cause));}};
  const save = (copy = false) => void perform(async signal => {
    if (!draft) return;
    const entry = await library.save({...draft.palette, tags: draft.palette.tags.filter(Boolean)}, copy ? null : draft.entry, signal);
    if (alive.current && !signal.aborted) {choose(entry); setMessage('Palette saved locally. Exact duplicates keep their existing copy.');}
  });
  return <Dialog titleId={id} className="palette-library-dialog" localEscape onClose={close}>
    <div className="dialog-heading"><div><span className="section-caption">REUSABLE COLORS</span><h2 id={id}>Color palettes</h2></div><IconButton label="Close color palettes" onClick={close}><X size={18}/></IconButton></div>
    <div className="palette-library-body">
      <p>Named sRGB colors saved in this browser. Applying a swatch uses the current color control; palette edits leave document colors and undo intact.</p>
      <p className="field-hint">These are opaque 8-bit sRGB hex colors. Palette names, descriptions and tags travel in exported packs. No account or upload is required.</p>
      {(error || snapshot.error) && <p role="alert">{error || snapshot.error}</p>}{message && <p role="status">{message}</p>}
      {(busy || snapshot.loading) && <p role="status">Preparing palettes…</p>}
      <div className="palette-actions"><Button disabled={busy || !snapshot.available} onClick={() => {setDraft({entry: null, palette: {name: 'New palette', description: '', tags: [], swatches: [{name: 'Current color', color}]}}); setSwatchPage(0); setError('');}}>New color palette</Button>
        <Button disabled={busy || !snapshot.available} onClick={() => input.current?.click()}>Import palette pack…</Button>
        <input hidden ref={input} type="file" accept=".canolipal,.json,application/json" data-testid="palette-pack-input" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) void perform(async signal => {const result = await library.importPack(file, signal);
            if (alive.current && !signal.aborted) setMessage(`Imported ${result.added} palettes; kept ${result.reused} exact duplicates.`);});
        }}/></div>
      <TextInput label="Search palettes and swatches" layout="stacked" value={query} onChange={value => {setQuery(value); setPage(0);}}/>
      <ul className="palette-library-list">{filtered.slice(currentPage * 40, currentPage * 40 + 40).map((row, index) => <li key={row.entry?.id ?? 'unreadable-' + index}>
        {row.entry ? <Button variant="subtle" disabled={busy} aria-pressed={draft?.entry?.id === row.entry.id} onClick={() => choose(row.entry!)} aria-label={`Open color palette ${row.entry.palette.name}`}><strong>{row.entry.palette.name}</strong><small>{row.entry.palette.swatches.length} swatches · {row.entry.palette.tags.join(', ') || 'No tags'}</small></Button>
          : <><p role="alert">{row.error}</p><Button disabled={busy} onClick={() => void perform(async signal => {
            const blob = await library.recover(row.key, signal); if (alive.current && !signal.aborted) download(blob, 'recovered-palette.json');
          })}>Recover palette record</Button><Button disabled={busy} onClick={() => void perform(signal => library.remove(row.key, signal))}>Remove unreadable palette</Button></>}
      </li>)}</ul>
      {!filtered.length && !snapshot.loading && <p>{query ? 'No palettes match this search.' : 'No saved palettes. Create one or import a palette pack.'}</p>}
      {pages > 1 && <div className="palette-actions"><Button disabled={busy || !currentPage} onClick={() => setPage(currentPage - 1)}>Previous palette page</Button><span>Page {currentPage + 1} of {pages}</span><Button disabled={busy || currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Next palette page</Button></div>}
      {draft && <section aria-label="Palette details">
        <TextInput label="Palette name" layout="stacked" value={draft.palette.name} disabled={busy} onChange={name => change({name})}/>
        <TextArea label="Palette description" value={draft.palette.description} disabled={busy} onChange={description => change({description})}/>
        <TextInput label="Palette tags (comma-separated)" layout="stacked" value={draft.palette.tags.join(', ')} disabled={busy} onChange={value => change({tags: value.split(',').map(tag => tag.trim())})}/>
        <p>{swatches.length} swatches. Saved colors are copied values; later palette changes do not recolor existing artwork.</p>
        <ol className="palette-swatches" start={currentSwatchPage * 32 + 1}>{swatches.slice(currentSwatchPage * 32, currentSwatchPage * 32 + 32).map((swatch, offset) => {
          const index = currentSwatchPage * 32 + offset;
          const replace = (patch: Partial<typeof swatch>) => change({swatches: swatches.map((value, i) => i === index ? {...value, ...patch} : value)});
          const move = (to: number) => {const next = [...swatches]; [next[index], next[to]] = [next[to], next[index]]; change({swatches: next}); setSwatchPage(Math.floor(to / 32));};
          return <li key={index}>
            {onChoose && <Button disabled={busy} className="palette-swatch-pick" aria-label={`Use swatch ${swatch.name} ${swatch.color}`} onClick={() => pick(swatch.color)}><span className="palette-chip" style={{background: swatch.color}}/>{swatch.name} {swatch.color}</Button>}
            <div className="palette-swatch-edit"><TextInput label={`Swatch ${index + 1} name`} value={swatch.name} layout="stacked" disabled={busy} onChange={name => replace({name})}/>
              <label className="field-label">Swatch {index + 1} color<input type="color" aria-label={`Swatch ${index + 1} color`} value={swatch.color} disabled={busy} onChange={event => replace({color: event.target.value})}/><span className="palette-hex">{swatch.color}</span></label>
              <Button disabled={busy || !index} onClick={() => move(index - 1)} aria-label={`Move swatch ${index + 1} earlier`}>↑</Button><Button disabled={busy || index === swatches.length - 1} onClick={() => move(index + 1)} aria-label={`Move swatch ${index + 1} later`}>↓</Button><Button disabled={busy || swatches.length === 1} onClick={() => change({swatches: swatches.filter((_, i) => i !== index)})} aria-label={`Remove swatch ${index + 1}`}>Remove</Button>
            </div>
          </li>;
        })}</ol>
        {swatchPages > 1 && <div className="palette-actions"><Button disabled={busy || !currentSwatchPage} onClick={() => setSwatchPage(currentSwatchPage - 1)}>Previous swatches</Button><span>Swatches page {currentSwatchPage + 1} of {swatchPages}</span><Button disabled={busy || currentSwatchPage === swatchPages - 1} onClick={() => setSwatchPage(currentSwatchPage + 1)}>Next swatches</Button></div>}
        <div className="palette-actions"><Button disabled={busy || swatches.length >= 4096} onClick={() => {change({swatches: [...swatches, {name: `Color ${swatches.length + 1}`, color}]}); setSwatchPage(Math.floor(swatches.length / 32));}}>Add current color</Button><Button variant="primary" disabled={busy || !draft.palette.name.trim()} onClick={() => save()}>Save color palette</Button>{draft.entry && <><Button disabled={busy} onClick={() => save(true)}>Save palette as copy</Button><Button disabled={busy} onClick={() => void perform(async signal => {const blob = await library.exportPack([draft.entry!.id], signal); if (alive.current && !signal.aborted) download(blob, 'canoli-palette.canolipal');})}>Export selected palette</Button><Button disabled={busy} onClick={() => void perform(async signal => {
          await library.refresh(signal); const entry = library.getSnapshot().entries.find(row => row.entry?.id === draft.entry!.id)?.entry;
          if (!entry) throw new Error('This palette was removed. Save as a new copy to retain your draft.');
          if (alive.current && !signal.aborted) choose(entry);
        })}>Reload palette details</Button><Button disabled={busy} onClick={() => void perform(async signal => {await library.remove(draft.entry!.id, signal); if (alive.current && !signal.aborted) setDraft(null);})}>Remove saved palette</Button></>}</div>
      </section>}
      <a className="palette-guide-link" href="/developer/color-palettes.html" target="_blank" rel="noreferrer">Palette packs, storage and color limits</a>
      <div className="palette-actions"><Button disabled={busy || !validIds.length} onClick={() => void perform(async signal => {
        const blob = await library.exportPack(validIds, signal); if (alive.current && !signal.aborted) download(blob, 'canoli-palettes.canolipal');
      })}>Export valid palette pack</Button><Button disabled={busy || !snapshot.available} onClick={() => void perform(signal => library.refresh(signal))}>Reload color palettes</Button><Button disabled={busy || !snapshot.entries.length} onClick={() => setClear(value => !value)}>Clear color palettes…</Button></div>
      {clear && <section aria-label="Confirm palette clearing"><p>Remove all saved palettes from this browser? Export a pack and recover unreadable records first. Existing artwork and history stay intact.</p><Button variant="danger" disabled={busy} onClick={() => void perform(async signal => {await library.clear(signal); if (alive.current && !signal.aborted) {setDraft(null); setClear(false);}})}>Clear saved palettes</Button><Button disabled={busy} onClick={() => setClear(false)}>Keep saved palettes</Button></section>}
    </div><div className="dialog-actions">{busy && <Button onClick={() => {pending.current?.abort(); pending.current = null; setBusy(false);}}>Cancel palette operation</Button>}<Button onClick={close}>Done</Button></div>
  </Dialog>;
}
