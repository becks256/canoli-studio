import { useEffect, useRef, useState } from "react";

/** Coalesce picker events within a task; the canvas owns frame pacing. */
export function ColorInput({ label, value, disabled = false, onPreview, onCommit, onCancel }: {
  label: string;
  value: string;
  disabled?: boolean;
  onPreview(value: string): void;
  onCommit(value: string): void;
  onCancel(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const edit = useRef<{ initial: string; value: string } | null>(null);
  const pending = useRef<object | null>(null);
  const callbacks = useRef({ onPreview, onCommit, onCancel });
  callbacks.current = { onPreview, onCommit, onCancel };
  const stopPreview = () => { pending.current = null; };
  const finish = (next: string, cancel = false) => {
    const current = edit.current;
    stopPreview();
    edit.current = null;
    if (!current) return;
    const resolved = cancel ? current.initial : next;
    // A same-task cancel can leave React state unchanged while the native input
    // value has changed, so restore the displayed value even if React bails out.
    if (input.current) input.current.value = resolved;
    setDraft(resolved);
    if (cancel || next === current.initial) callbacks.current.onCancel();
    else callbacks.current.onCommit(next);
  };
  useEffect(() => { if (!edit.current) setDraft(value); }, [value]);
  useEffect(() => {
    const element = input.current!;
    // React onChange also fires for every native input event. Native change is
    // the browser's picker-completion boundary, so subscribe to it directly.
    const commit = () => finish(element.value);
    element.addEventListener("change", commit);
    return () => { element.removeEventListener("change", commit); stopPreview(); };
  }, []);
  return <input ref={input} type="color" aria-label={label} value={draft} disabled={disabled}
    onChange={() => {}}
    onInput={event => {
      const next = event.currentTarget.value;
      edit.current = { initial: edit.current?.initial ?? value, value: next };
      setDraft(next);
      if (pending.current === null) {
        const token = {}; pending.current = token;
        queueMicrotask(() => {
          if (pending.current !== token) return;
          pending.current = null;
          if (edit.current) callbacks.current.onPreview(edit.current.value);
        });
      }
    }}
    onBlur={event => finish(event.currentTarget.value)}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(draft, true); }
      if (event.key === "Enter") finish(event.currentTarget.value);
    }}
  />;
}
