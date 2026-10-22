import {
  Boxes,
  Download,
  FileCode,
  FolderOpen,
  Palette,
  Redo2,
  Save,
  Scissors,
  Sparkles,
  Undo2,
  Workflow,
} from "lucide-react";
import { Button, IconButton } from "./controls";
import type {ReactNode} from 'react';

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
  recentFilesControl?:ReactNode;
  onSave(): void;
  onExport(): void;
  onExportDialog?(): void;
  onGenerate?(): void;
  onRecipes?(): void;
  onBatch?(): void;
  onColorProfile?(): void;
  onPsdImport?(): void;
  onRefineEdge?(): void;
  onSelectSubject?(): void;
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
  recentFilesControl,
  onSave,
  onExport,
  onExportDialog,
  onGenerate,
  onRecipes,
  onBatch,
  onColorProfile,
  onPsdImport,
  onRefineEdge,
  onSelectSubject,
}: TopBarProps) {
  return (
    <header className="topbar">
      <a
        className="brand"
        href="https://canoli.studio"
        target="_blank"
        rel="noreferrer"
      >
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        Canoli Studio
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
          shortcutId="undo"
          label="Undo (Mod+Z)"
          disabled={!canUndo || busy}
          onClick={onUndo}
        >
          <Undo2 size={16} />
        </IconButton>
        <IconButton
          shortcutId="redo"
          label="Redo (Mod+Shift+Z)"
          disabled={!canRedo || busy}
          onClick={onRedo}
        >
          <Redo2 size={16} />
        </IconButton>
        <span className="separator" />
        <Button variant="subtle" aria-label="Open" title="Open" onClick={onOpen} disabled={busy}>
          <FolderOpen size={15} />
          <span>Open</span>
        </Button>
        {recentFilesControl}
        <Button variant="subtle" aria-label="Save project" title="Save project" onClick={onSave} disabled={busy}>
          <Save size={15} />
          <span>Save project</span>
        </Button>
        {onPsdImport && (
          <Button variant="subtle" aria-label="PSD" title="PSD" onClick={onPsdImport} disabled={busy}>
            <FileCode size={15} />
            <span>PSD</span>
          </Button>
        )}
        {onColorProfile && (
          <Button variant="subtle" aria-label="Color" title="Color" onClick={onColorProfile} disabled={busy}>
            <Palette size={15} />
            <span>Color</span>
          </Button>
        )}
        {onGenerate && (
          <Button variant="subtle" aria-label="Generate" title="Generate" onClick={onGenerate} disabled={busy}>
            <Sparkles size={15} />
            <span>Generate</span>
          </Button>
        )}
        {onRecipes && (
          <Button variant="subtle" aria-label="Recipes" title="Recipes" onClick={onRecipes} disabled={busy}>
            <Workflow size={15} />
            <span>Recipes</span>
          </Button>
        )}
        {onBatch && (
          <Button variant="subtle" aria-label="Batch" title="Batch" onClick={onBatch} disabled={busy}>
            <Boxes size={15} />
            <span>Batch</span>
          </Button>
        )}
        {onSelectSubject && (
          <Button
            variant="subtle"
            aria-label="Subject"
            title="Subject"
            onClick={onSelectSubject}
            disabled={busy || !hasLayers}
          >
            <Sparkles size={15} />
            <span>Subject</span>
          </Button>
        )}
        {onRefineEdge && (
          <Button
            variant="subtle"
            aria-label="Refine"
            title="Refine"
            onClick={onRefineEdge}
            disabled={busy || !hasLayers}
          >
            <Scissors size={15} />
            <span>Refine</span>
          </Button>
        )}
        {onExportDialog && (
          <Button
            variant="subtle"
            aria-label="Export…"
            title="Export…"
            onClick={onExportDialog}
            disabled={busy || !hasLayers}
          >
            <Download size={15} />
            <span>Export…</span>
          </Button>
        )}
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
