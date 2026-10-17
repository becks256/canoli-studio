import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { Button, NumberField } from './controls';
import { selectionModificationSchema, type SelectionModificationOptions, type SelectionModificationControl, type SelectionModificationProgress } from '../core/selection-modification';

export function SelectionModifyDialog({ operation: initialOperation, onApply, onClose }: {
  operation: SelectionModificationOptions['operation'];
  onApply(options: SelectionModificationOptions, control: SelectionModificationControl): Promise<void>;
  onClose(): void;
}) {
  const [operation,setOperation] = useState(initialOperation);
  const [radius,setRadius] = useState(5);
  const [error,setError] = useState('');
  const [working,setWorking] = useState(false);
  const [progress,setProgress] = useState<SelectionModificationProgress>();
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(),[]);
  const close = () => { active.current?.abort(); onClose(); };
  return <Dialog titleId="selection-modify-title" onClose={close}>
    <div className="dialog-heading"><h2 id="selection-modify-title">Modify selection</h2></div>
    <p className="script-description">Expand or contract with a circular pixel radius, or soften the combined selection with Feather. Artwork and source images stay unchanged.</p>
    <form onSubmit={async event => {
      event.preventDefault();
      if (working) return;
      const abort = new AbortController(); active.current = abort;
      setWorking(true); setError(''); setProgress(undefined);
      try {
        await onApply(selectionModificationSchema.parse({operation,radius}),{signal:abort.signal,onProgress:setProgress});
        if (!abort.signal.aborted) onClose();
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Selection modification failed.');
      } finally { if (active.current === abort) active.current = null; setWorking(false); }
    }}>
      <label>Operation <select aria-label="Selection modification" value={operation} disabled={working} onChange={event => setOperation(event.target.value as typeof operation)}>
        <option value="expand">Expand</option><option value="contract">Contract</option><option value="feather">Feather</option>
      </select></label>
      <NumberField id="selection-radius" label="Radius" value={radius} min={1} max={128} step={1} suffix="px" disabled={working} onChange={setRadius} onCommit={setRadius} />
      <p className="text-muted">1–128 document pixels. The result is clipped to the canvas; pixels outside it are unselected.</p>
      {working && <div role="status">Modifying selection… <progress aria-label="Selection progress" max={progress?.total ?? 1} value={progress?.completed ?? 0} /></div>}
      {error && <p role="alert">{error}</p>}
      <div className="artboard-actions"><Button type="button" variant="subtle" onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={working || !Number.isInteger(radius) || radius<1 || radius>128}>Apply selection</Button>
      </div>
    </form>
  </Dialog>;
}
