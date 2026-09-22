import { useState } from "react";
import type { DragEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Layers,
  LockKeyhole,
  Paintbrush,
  PenTool,
  SquarePlus,
  Trash2,
  Type,
  UnlockKeyhole,
} from "lucide-react";
import type { Document, Layer, LayerGroup } from "../dom";
import type { DocumentData, LayerData } from "../core/model";
import { allLayers, isLocked } from "../core/model";
import { IconButton } from "./controls";

export interface LayersPanelProps {
  document: Document;
  viewDocument: DocumentData;
  selectedId: string | null;
  selectedLayer: Layer | null;
  locked: boolean;
  busy: boolean;
  historyPast: Array<{ label: string }>;
  historyFuture: Array<{ label: string }>;
  getThumbnail(assetId: string): string;
  onCancelTools(): void;
  onClearPreview(): void;
  onAttempt(action: () => void): void;
  onSelectLayer(layer: Layer): void;
  onAddLayer(): void;
  onAddGroup(): void;
  onDuplicateLayer(): void;
  onMoveLayerForward(): void;
  onMoveLayerBackward(): void;
  onDeleteLayer(): void;
}

export function LayersPanel({
  document: dom,
  viewDocument,
  selectedId,
  selectedLayer: selected,
  locked,
  busy,
  historyPast,
  historyFuture,
  getThumbnail,
  onCancelTools,
  onClearPreview,
  onAttempt,
  onSelectLayer,
  onAddLayer,
  onAddGroup,
  onDuplicateLayer,
  onMoveLayerForward,
  onMoveLayerBackward,
  onDeleteLayer,
}: LayersPanelProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [draggedLayer, setDraggedLayer] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    placement: "before" | "after" | "inside";
  } | null>(null);

  function dropLayer(
    event: DragEvent,
    targetId: string | null,
    placement: "before" | "after" | "inside",
  ) {
    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData("application/x-luma-layer");
    setDraggedLayer(null);
    setDropTarget(null);
    if (!id || id === targetId) return;
    onAttempt(() => {
      const layer = dom.getLayer(id);
      const target = dom.getLayer(targetId);
      if (!layer) return;
      if (placement === "inside") {
        if (target instanceof Object && ("layers" in target) || !target) {
          layer.moveTo((target as LayerGroup) ?? dom, { preservePosition: true });
        }
      } else if (target) {
        if (placement === "after") layer.moveAfter(target);
        else layer.moveBefore(target);
      }
    });
  }

  function renderLayers(nodes: LayerData[], depth = 0) {
    return [...nodes].reverse().map((node) => {
      const object = dom.getLayer(node.id)!;
      return (
        <div key={node.id}>
          <div
            className={`layer-row ${selectedId === node.id ? "selected" : ""} ${!node.visible ? "muted" : ""} ${dropTarget?.id === node.id ? `drop-${dropTarget.placement}` : ""}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            draggable={!busy && !isLocked(viewDocument, node.id)}
            onDragStart={(event) => {
              onCancelTools();
              event.dataTransfer.setData("application/x-luma-layer", node.id);
              event.dataTransfer.effectAllowed = "move";
              setDraggedLayer(node.id);
            }}
            onDragEnd={() => {
              setDraggedLayer(null);
              setDropTarget(null);
            }}
            onDragOver={(event) => {
              if (!draggedLayer || draggedLayer === node.id) return;
              event.preventDefault();
              event.stopPropagation();
              const box = event.currentTarget.getBoundingClientRect();
              const y = (event.clientY - box.top) / box.height;
              setDropTarget({
                id: node.id,
                placement:
                  node.kind === "group" && y > 0.25 && y < 0.75
                    ? "inside"
                    : y < 0.5
                      ? "after"
                      : "before",
              });
            }}
            onDrop={(event) =>
              dropLayer(
                event,
                node.id,
                dropTarget?.id === node.id ? dropTarget.placement : "after",
              )
            }
          >
            {node.kind === "group" ? (
              <button
                className="tree-toggle"
                aria-label={`Toggle ${node.name}`}
                onClick={() =>
                  setCollapsed((old) => {
                    const next = new Set(old);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  })
                }
              >
                {collapsed.has(node.id) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
              </button>
            ) : (
              <span className="tree-spacer" />
            )}
            <button
              className="layer-select"
              aria-pressed={selectedId === node.id}
              aria-label={`Select ${node.name}`}
              onClick={() => {
                onCancelTools();
                onClearPreview();
                onSelectLayer(object);
              }}
            >
              {node.kind === "group" ? (
                <span className="layer-thumb group-thumb">
                  <Folder size={17} />
                </span>
              ) : node.kind === "raster" ? (
                <img
                  className="layer-thumb"
                  src={getThumbnail(node.assetId)}
                  alt=""
                />
              ) : node.kind === "paint" ? (
                <span className="layer-thumb group-thumb">
                  <Paintbrush size={15} />
                </span>
              ) : node.kind === "vector" ? (
                <span className="layer-thumb group-thumb">
                  <PenTool size={15} />
                </span>
              ) : node.kind === "text" ? (
                <span className="layer-thumb group-thumb">
                  <Type size={15} />
                </span>
              ) : (
                <span className="layer-thumb group-thumb">
                  <Layers size={15} />
                </span>
              )}
              <span>{node.name}</span>
            </button>
            <button
              className={`layer-control ${node.locked ? "always" : ""}`}
              aria-label={`${node.locked ? "Unlock" : "Lock"} ${node.name}`}
              onClick={() =>
                onAttempt(() => {
                  object.locked = !node.locked;
                })
              }
            >
              {node.locked ? (
                <LockKeyhole size={12} />
              ) : (
                <UnlockKeyhole size={12} />
              )}
            </button>
            <button
              className="layer-control always"
              aria-label={`${node.visible ? "Hide" : "Show"} ${node.name}`}
              disabled={isLocked(viewDocument, node.id)}
              onClick={() =>
                onAttempt(() => {
                  object.visible = !node.visible;
                })
              }
            >
              {node.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </div>
          {node.kind === "group" &&
            !collapsed.has(node.id) &&
            renderLayers(node.children, depth + 1)}
        </div>
      );
    });
  }

  return (
    <aside className="layers-panel">
      <div className="panel-tabs">
        <button
          className={!showHistory ? "active" : ""}
          onClick={() => setShowHistory(false)}
        >
          Layers
        </button>
        <button
          className={showHistory ? "active" : ""}
          onClick={() => setShowHistory(true)}
        >
          History
        </button>
        <div className="panel-tab-actions">
          <IconButton
            label="New layer (Mod+Shift+N)"
            disabled={busy}
            onClick={onAddLayer}
          >
            <SquarePlus size={15} />
          </IconButton>
          <IconButton
            label="Add group (Mod+G)"
            disabled={busy || locked}
            onClick={onAddGroup}
          >
            <FolderPlus size={15} />
          </IconButton>
        </div>
      </div>
      {!showHistory ? (
        <>
          <div className="document-summary">
            <Layers size={14} />
            <span>
              {viewDocument.width} × {viewDocument.height}
            </span>
            <span className="count">
              {allLayers(viewDocument.children).length}
            </span>
          </div>
          <div className="layer-list">
            {renderLayers(viewDocument.children)}
            {!viewDocument.children.length && (
              <p className="panel-empty">
                Your layers will appear here.
                <br />
                Import an image to begin.
              </p>
            )}
          </div>
          <div
            className={`layer-root-drop ${draggedLayer ? "visible" : ""}`}
            onDragOver={(e) => {
              if (draggedLayer) e.preventDefault();
            }}
            onDrop={(e) => dropLayer(e, null, "inside")}
          >
            Drop here to move to document
          </div>
          <div className="layer-actions">
            <IconButton
              label="Duplicate layer (Mod+J)"
              disabled={!selected || locked || busy}
              onClick={onDuplicateLayer}
            >
              <Copy size={15} />
            </IconButton>
            <IconButton
              label="Move layer forward (Mod+])"
              disabled={!selected || locked || busy}
              onClick={onMoveLayerForward}
            >
              <ArrowUp size={15} />
            </IconButton>
            <IconButton
              label="Move layer backward (Mod+[)"
              disabled={!selected || locked || busy}
              onClick={onMoveLayerBackward}
            >
              <ArrowDown size={15} />
            </IconButton>
            <span className="grow" />
            <IconButton
              label="Delete layer (Delete)"
              disabled={!selected || locked || busy}
              onClick={onDeleteLayer}
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        </>
      ) : (
        <div className="history-list">
          <p className="section-caption">THIS SESSION</p>
          <div className="history-entry">
            <span className="history-dot" />
            Document opened
          </div>
          {historyPast.map((entry, index) => (
            <div className="history-entry" key={index}>
              <span className="history-dot" />
              {entry.label}
              {index === historyPast.length - 1 && <Check size={12} />}
            </div>
          ))}
          {historyFuture.length > 0 && (
            <p className="panel-empty">
              {historyFuture.length} change
              {historyFuture.length === 1 ? "" : "s"} available to redo.
            </p>
          )}
        </div>
      )}
      <div className="local-note">
        <span className="status-dot" />A little space to make things.
        <small>Your images stay on this device.</small>
      </div>
    </aside>
  );
}
