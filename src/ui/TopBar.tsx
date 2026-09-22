import { Download, FolderOpen, Redo2, Save, Undo2 } from "lucide-react";
import { Button, IconButton } from "./controls";


export interface TopBarProps {
  documentId: string;
  documentName: string;
  canUndo: boolean;
  canRedo: boolean;
  hasLayers: boolean;
  busy: boolean;
  onRename(name: string): void;
  onUndo(): void;
  onRedo(): void;
  onOpen(): void;
  onSave(): void;
  onExport(): void;
}

export function TopBar({
  documentId,
  documentName,
  canUndo,
  canRedo,
  hasLayers,
  busy,
  onRename,
  onUndo,
  onRedo,
  onOpen,
  onSave,
  onExport,
}: TopBarProps) {
  return (
    <header className="topbar">
      <a
        className="brand"
        href="https://github.com/google/luma"
        target="_blank"
        rel="noreferrer"
      >
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        luma<span className="alpha-label">PROTOTYPE</span>
      </a>
      <div className="document-title">
        <input
          aria-label="Document name"
          key={documentId + documentName}
          defaultValue={documentName}
          maxLength={240}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value && value !== documentName) {
              onRename(value);
            } else {
              event.target.value = documentName;
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <span className="local-tag">Local</span>
      </div>
      <div className="top-actions">
        <IconButton
          label="Undo (Mod+Z)"
          disabled={!canUndo || busy}
          onClick={onUndo}
        >
          <Undo2 size={16} />
        </IconButton>
        <IconButton
          label="Redo (Mod+Shift+Z)"
          disabled={!canRedo || busy}
          onClick={onRedo}
        >
          <Redo2 size={16} />
        </IconButton>
        <span className="separator" />
        <Button variant="subtle" onClick={onOpen} disabled={busy}>
          <FolderOpen size={15} />
          <span>Open</span>
        </Button>
        <Button variant="subtle" onClick={onSave} disabled={busy}>
          <Save size={15} />
          <span>Save project</span>
        </Button>
        <Button
          variant="primary"
          onClick={onExport}
          disabled={busy || !hasLayers}
        >
          <Download size={15} />
          Export PNG
        </Button>
      </div>
    </header>
  );
}
