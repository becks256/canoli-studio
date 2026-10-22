import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Dialog } from "./Dialog";
import { IconButton } from "./controls";
import { formatShortcut } from "./shortcuts";
import type { ShortcutAction } from "./shortcuts";
import { commandCategory, searchCommands } from "./command-search";
import "./CommandPalette.css";

export function CommandPalette({
  actions,
  busy,
  onClose,
  onExecute,
}: {
  actions: ShortcutAction[];
  busy: boolean;
  onClose(): void;
  onExecute(action: ShortcutAction): void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    search.current?.focus();
  }, []);
  const results = searchCommands(
    actions.filter((a) => a.id !== "command-palette"),
    query,
  );
  const active=selectedId===null?(results.length?0:-1):results.findIndex(action=>action.id===selectedId);
  useEffect(()=>{if(selectedId===null&&results.length)setSelectedId(results[0].id);},[selectedId,results]);
  const run = (action: ShortcutAction) => {
    if (!busy && action.enabled?.() !== false) onExecute(action);
  };
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, query]);
  return (
    <Dialog
      titleId={`${listId}-title`}
      className="command-palette"
      onClose={onClose}
    >
      <div className="dialog-heading">
        <h2 id={`${listId}-title`}>Find a command</h2>
        <IconButton label="Close command palette" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <label className="command-search">
        <Search size={18} aria-hidden="true" />
        <input
          ref={search}
          aria-label="Search commands"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            active>=0 ? `${listId}-${active}` : undefined
          }
          value={query}
          placeholder="Search tools, layers, and actions…"
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedId(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (
              ["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(
                event.key,
              )
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (!results.length) return;
              if (event.key === "Enter") {if(active>=0)run(results[active]);}
              else if(event.key==='Home')setSelectedId(results[0].id);
              else if(event.key==='End')setSelectedId(results.at(-1)!.id);
              else setSelectedId(results[active<0?(event.key==='ArrowDown'?0:results.length-1):(active+(event.key==='ArrowDown'?1:-1)+results.length)%results.length].id);
            }
          }}
        />
      </label>
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Commands"
        className="command-results"
      >
        {results.map((action, i) => (
          <div
            key={action.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            aria-disabled={busy || action.enabled?.() === false}
            className="command-result"
            onMouseMove={() => setSelectedId(action.id)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(action)}
          >
            <span>
              <small>{commandCategory(action)}</small>
              {action.label}
              {action.description&&<span className="command-result-description">{action.description}</span>}
            </span>
            <kbd>{action.keys[0] ? formatShortcut(action.keys[0]) : ""}</kbd>
          </div>
        ))}
      </div>
      {!results.length && <p role="status">No matching commands.</p>}
      {results.length>0&&active<0&&<p role="status">The selected item is no longer available. Choose another result.</p>}
      <p className="command-hint">
        ↑ ↓ to navigate · Enter to run · Escape to close
      </p>
    </Dialog>
  );
}
