import { LayerThumbnail } from "./LayerThumbnail";
import type { RasterEditing } from "../raster-editing";
import { LayerFilterBar } from "./LayerFilterBar";
import { emptyLayerFilter, filterLayers } from "./layer-filter";
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Component,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Layers,
  LockKeyhole,
  Paintbrush,
  PenTool,
  SquarePlus,
  SlidersHorizontal,
  Trash2,
  Type,
  UnlockKeyhole,
} from "lucide-react";
import {
  SmartObjectLayer,
  type Document,
  type Layer,
  type LayerGroup,
} from "../dom";
import type { DocumentData, LayerData } from "../core/model";
import { allLayers, isLocked } from "../core/model";
import { Button, IconButton, Slider } from "./controls";

// These glyphs have no row state or handlers. Retain their elements so a text
// edit does not rebuild every unchanged icon in the layer list. State-dependent
// controls still choose the appropriate glyph on every render.
const layerIcons = {
  collapsed: <ChevronRight size={12} />,
  expanded: <ChevronDown size={12} />,
  group: <Folder size={17} />,
  paint: <Paintbrush size={15} />,
  vector: <PenTool size={15} />,
  text: <Type size={15} />,
  smartObject: <Component size={15} />,
  adjustment: <SlidersHorizontal size={15} />,
  layer: <Layers size={15} />,
  locked: <LockKeyhole size={12} />,
  unlocked: <UnlockKeyhole size={12} />,
  visible: <Eye size={13} />,
  hidden: <EyeOff size={13} />,
  addLayer: <SquarePlus size={15} />,
  addGroup: <FolderPlus size={15} />,
  layerComps: <Layers size={14} />,
  copy: <Copy size={15} />,
  forward: <ArrowUp size={15} />,
  backward: <ArrowDown size={15} />,
  delete: <Trash2 size={15} />,
  currentHistory: <Check size={12} />,
};

export interface LayersPanelProps {
  document: Document;
  viewDocument: DocumentData;
  selectedId: string | null;
  selectedLayer: Layer | null;
  locked: boolean;
  busy: boolean;
  onInspectHistory(): void;
  historyPast: Array<{ label: string }>;
  historyFuture: Array<{ label: string }>;
  getThumbnail(assetId: string): string;
  pixels?: RasterEditing;
  deferThumbnails?: boolean;
  onCancelTools(): void;
  onClearPreview(): void;
  onAttempt(action: () => void): void;
  onSelectLayer(layer: Layer, additive?: boolean): void;
  onLoadTransparency?(id: string): void;
  onAddLayer(): void;
  onAddGroup(): void;
  onAddAdjustmentLayer?(): void;
  copyTargets?: { id: string; document: Document }[];
  onCopyToDocument?(document: Document): void;
  onEditSmartObject?(layer: SmartObjectLayer): void;
  onRasterizeSmartObject?(layer: SmartObjectLayer): void;
  onRelinkSmartObject?(layer: SmartObjectLayer, file: File): void;
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
  onInspectHistory,
  historyPast,
  historyFuture,
  getThumbnail,
  pixels,
  deferThumbnails = false,
  onCancelTools,
  onClearPreview,
  onAttempt,
  onSelectLayer,
  onLoadTransparency,
  onAddLayer,
  onAddGroup,
  onAddAdjustmentLayer,
  copyTargets = [],
  onCopyToDocument,
  onEditSmartObject,
  onRasterizeSmartObject,
  onRelinkSmartObject,
  onDuplicateLayer,
  onMoveLayerForward,
  onMoveLayerBackward,
  onDeleteLayer,
}: LayersPanelProps) {
  const linkedFileInput = useRef<HTMLInputElement>(null);
  const linkedFileTarget = useRef<SmartObjectLayer | null>(null);
  const [filter, setFilter] = useState({ ...emptyLayerFilter });
  const [scalePercent, setScalePercent] = useState(100);
  const selectionKey = dom.getSnapshot().selectedIds.join(":");
  useEffect(() => {
    setScalePercent(100);
  }, [dom, selectionKey]);
  useEffect(() => {
    setFilter({ ...emptyLayerFilter });
  }, [dom]);
  const filtered = filterLayers(viewDocument.children, filter);
  const isCollapsed = (id: string) => !filtered.active && collapsed.has(id);
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
        if ((target instanceof Object && "layers" in target) || !target) {
          layer.moveTo((target as LayerGroup) ?? dom, {
            preservePosition: true,
          });
        }
      } else if (target) {
        if (placement === "after") layer.moveAfter(target);
        else layer.moveBefore(target);
      }
    });
  }

  function renderLayers(nodes: LayerData[], depth = 0) {
    return [...nodes]
      .reverse()
      .filter((node) => filtered.included.has(node.id))
      .map((node) => {
        const object = dom.getLayer(node.id)!;
        return (
          <div key={node.id}>
            <div
              className={`layer-row ${filtered.active && !filtered.matches.has(node.id) ? "filter-context" : ""} ${dom.getSnapshot().selectedIds.includes(node.id) ? "selected" : ""} ${!node.visible ? "muted" : ""} ${dropTarget?.id === node.id ? `drop-${dropTarget.placement}` : ""}`}
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
                  disabled={filtered.active}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old);
                      if (next.has(node.id)) next.delete(node.id);
                      else next.add(node.id);
                      return next;
                    })
                  }
                >
                  {isCollapsed(node.id) ? layerIcons.collapsed : layerIcons.expanded}
                </button>
              ) : (
                <span className="tree-spacer" />
              )}
              <button
                className="layer-select"
                aria-pressed={dom.getSnapshot().selectedIds.includes(node.id)}
                aria-label={`Select ${node.name}`}
                onClick={(event) => {
                  onCancelTools();
                  onClearPreview();
                  onSelectLayer(
                    object,
                    event.ctrlKey || event.metaKey || event.shiftKey,
                  );
                }}
              >
                {node.kind === "group" ? (
                  <span className="layer-thumb group-thumb">
                    {layerIcons.group}
                  </span>
                ) : (node.kind === "raster" || node.kind === "paint") && pixels ? (
                  <LayerThumbnail
                    document={dom.getSnapshot().document}
                    layerId={node.id}
                    name={node.name}
                    pixels={pixels}
                    paused={deferThumbnails}
                    fallback={node.kind === "raster" ? getThumbnail(node.assetId) : undefined}
                    onClick={event => {
                      if (!(event.ctrlKey || event.metaKey) || busy || !onLoadTransparency) return;
                      event.preventDefault(); event.stopPropagation();
                      onLoadTransparency(node.id);
                    }}
                  />
                ) : node.kind === "raster" ? (
                  <img className="layer-thumb" src={getThumbnail(node.assetId)} alt="" />
                ) : node.kind === "paint" ? (
                  <span className="layer-thumb group-thumb">{layerIcons.paint}</span>
                ) : node.kind === "vector" ? (
                  <span className="layer-thumb group-thumb">
                    {layerIcons.vector}
                  </span>
                ) : node.kind === "text" ? (
                  <span className="layer-thumb group-thumb">
                    {layerIcons.text}
                  </span>
                ) : node.kind === "smart-object" ? (
                  <span
                    className="layer-thumb group-thumb"
                    title="Smart object"
                  >
                    {layerIcons.smartObject}
                  </span>
                ) : node.kind === "adjustment" ? (
                  <span className="layer-thumb group-thumb">
                    {layerIcons.adjustment}
                  </span>
                ) : (
                  <span className="layer-thumb group-thumb">
                    {layerIcons.layer}
                  </span>
                )}
                <span className="layer-name">{node.name}</span>
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
                {node.locked ? layerIcons.locked : layerIcons.unlocked}
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
                {node.visible ? layerIcons.visible : layerIcons.hidden}
              </button>
            </div>
            {node.kind === "group" &&
              !isCollapsed(node.id) &&
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
            shortcutId="new-layer"
            label="New layer (Mod+Shift+N)"
            disabled={busy}
            onClick={onAddLayer}
          >
            {layerIcons.addLayer}
          </IconButton>
          <IconButton
            shortcutId="group"
            label="Add group (Mod+G)"
            disabled={busy || locked}
            onClick={onAddGroup}
          >
            {layerIcons.addGroup}
          </IconButton>
          {onAddAdjustmentLayer && (
            <IconButton
              label="New adjustment layer"
              disabled={busy || locked}
              onClick={onAddAdjustmentLayer}
            >
              {layerIcons.adjustment}
            </IconButton>
          )}
        </div>
      </div>
      {!showHistory ? (
        <>
          <div className="document-summary">
            {layerIcons.layerComps}
            <span>
              {viewDocument.width} × {viewDocument.height}
            </span>
            <span className="count">
              {allLayers(viewDocument.children).length}
            </span>
          </div>
          {copyTargets.length > 0 && onCopyToDocument && (
            <label className="layer-copy-target">
              <span>Copy selection to</span>
              <select
                aria-label="Copy selected layers to document"
                value=""
                disabled={busy || dom.selectedLayers.length === 0}
                onChange={(event) => {
                  const target = copyTargets.find(
                    (item) => item.id === event.target.value,
                  );
                  if (target) onCopyToDocument(target.document);
                }}
              >
                <option value="" disabled>
                  Choose document…
                </option>
                {copyTargets.map((target, index) => (
                  <option key={target.id} value={target.id}>
                    {index + 1}. {target.document.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <LayerFilterBar
            value={filter}
            onChange={setFilter}
            active={filtered.active}
            count={filtered.matches.size}
          />
          {filtered.active &&
            selectedId &&
            !filtered.matches.has(selectedId) && (
              <p className="panel-empty">
                Selected layer: {selected?.name}. Outside current filter.
              </p>
            )}
          <div className="layer-list">
            {filtered.active && !filtered.matches.size && (
              <p className="panel-empty">No matching layers.</p>
            )}
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
          {dom.selectedLayers.length > 1 && (
            <div className="layer-filter-bar">
              <span>{dom.selectedLayers.length} layers selected</span>
              <label>
                Align layers{" "}
                <select
                  aria-label="Align selected layers"
                  disabled={
                    busy ||
                    dom.layerSelection.rootLayers.some((layer) =>
                      isLocked(viewDocument, layer.id),
                    )
                  }
                  defaultValue=""
                  onChange={(event) => {
                    const value = event.target.value;
                    onAttempt(() =>
                      dom.layerSelection.align(
                        value as import("../dom/layer-selection").LayerAlignment,
                      ),
                    );
                    event.target.value = "";
                  }}
                >
                  <option value="" disabled>
                    Choose alignment
                  </option>
                  {["left", "center", "right", "top", "middle", "bottom"].map(
                    (value) => (
                      <option value={value} key={value}>
                        {value}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Distribute layers{" "}
                <select
                  aria-label="Distribute selected layers"
                  disabled={
                    busy ||
                    dom.layerSelection.rootLayers.length < 3 ||
                    dom.layerSelection.rootLayers.some((layer) =>
                      isLocked(viewDocument, layer.id),
                    )
                  }
                  defaultValue=""
                  onChange={(event) => {
                    const [axis, mode] = event.target.value.split(":") as [
                      import("../core/layer-layout").DistributionAxis,
                      import("../core/layer-layout").DistributionMode,
                    ];
                    onCancelTools();
                    onClearPreview();
                    onAttempt(() => dom.layerSelection.distribute(axis, mode));
                    event.target.value = "";
                  }}
                >
                  <option value="" disabled>
                    Choose spacing
                  </option>
                  <option value="horizontal:gaps">Horizontal gaps</option>
                  <option value="vertical:gaps">Vertical gaps</option>
                  <option value="horizontal:centers">Horizontal centers</option>
                  <option value="vertical:centers">Vertical centers</option>
                </select>
              </label>
              <label>
                Rotate layers{" "}
                <select
                  aria-label="Rotate selected layers"
                  disabled={
                    busy ||
                    dom.layerSelection.rootLayers.some((layer) =>
                      isLocked(viewDocument, layer.id),
                    )
                  }
                  defaultValue=""
                  onChange={(event) => {
                    const degrees = Number(event.target.value);
                    onCancelTools();
                    onClearPreview();
                    onAttempt(() => dom.layerSelection.rotate(degrees));
                    event.target.value = "";
                  }}
                >
                  <option value="" disabled>
                    Choose rotation
                  </option>
                  <option value="90">90° clockwise</option>
                  <option value="-90">90° counterclockwise</option>
                  <option value="180">180°</option>
                </select>
              </label>
              <label>
                Scale layers{" "}
                <select
                  aria-label="Scale selected layers"
                  disabled={
                    busy ||
                    dom.layerSelection.rootLayers.some((layer) =>
                      isLocked(viewDocument, layer.id),
                    )
                  }
                  defaultValue=""
                  onChange={(event) => {
                    const factor = Number(event.target.value);
                    onCancelTools();
                    onClearPreview();
                    onAttempt(() => dom.layerSelection.scale(factor));
                    event.target.value = "";
                  }}
                >
                  <option value="" disabled>
                    Choose scale
                  </option>
                  <option value="0.5">50%</option>
                  <option value="2">200%</option>
                </select>
              </label>
            </div>
          )}
          {dom.selectedLayers.length > 0 && (
            <div className="layer-filter-bar">
              <label>
                Flip layers{" "}
                <select
                  aria-label="Flip selected layers"
                  defaultValue=""
                  disabled={
                    busy ||
                    dom.layerSelection.rootLayers.some((layer) =>
                      isLocked(viewDocument, layer.id),
                    )
                  }
                  onChange={(event) => {
                    const axis = event.target.value as
                      "horizontal" | "vertical";
                    onCancelTools();
                    onClearPreview();
                    onAttempt(() => dom.layerSelection.flip(axis));
                    event.target.value = "";
                  }}
                >
                  <option value="" disabled>
                    Choose direction
                  </option>
                  <option value="horizontal">Horizontal</option>
                  <option value="vertical">Vertical</option>
                </select>
              </label>
            </div>
          )}
          {dom.selectedLayers.length > 1 && (
            <div className="selection-scale-controls">
              <Slider
                label="Selection scale"
                value={scalePercent}
                min={1}
                max={400}
                step={0.1}
                suffix="%"
                disabled={
                  busy ||
                  dom.layerSelection.rootLayers.some((layer) =>
                    isLocked(viewDocument, layer.id),
                  )
                }
                onPreview={setScalePercent}
                onCommit={setScalePercent}
              />
              <Button
                disabled={
                  busy ||
                  scalePercent === 100 ||
                  dom.layerSelection.rootLayers.some((layer) =>
                    isLocked(viewDocument, layer.id),
                  )
                }
                onClick={() => {
                  onCancelTools();
                  onClearPreview();
                  onAttempt(() => {
                    dom.layerSelection.scale(scalePercent / 100);
                    setScalePercent(100);
                  });
                }}
              >
                Apply selection scale
              </Button>
            </div>
          )}
          {selected && (
            <Button
              disabled={
                busy ||
                dom.selectedLayers.some((layer) =>
                  isLocked(viewDocument, layer.id),
                )
              }
              onClick={() => {
                onCancelTools();
                onClearPreview();
                onAttempt(() => {
                  dom.createSmartObject(dom.selectedLayers);
                });
              }}
            >
              Convert to smart object
            </Button>
          )}
          {selected instanceof SmartObjectLayer && onRasterizeSmartObject && (
            <Button
              disabled={
                busy ||
                dom.selectedLayers.length !== 1 ||
                isLocked(viewDocument, selected.id)
              }
              onClick={() => {
                onCancelTools();
                onClearPreview();
                onRasterizeSmartObject(selected);
              }}
            >
              Rasterize smart object
            </Button>
          )}
          {selected instanceof SmartObjectLayer && onRelinkSmartObject && (
            <>
              <input
                ref={linkedFileInput}
                type="file"
                accept="image/*"
                hidden
                aria-label="Linked source image"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0],
                    target = linkedFileTarget.current;
                  event.currentTarget.value = "";
                  linkedFileTarget.current = null;
                  if (file && target) onRelinkSmartObject(target, file);
                }}
              />
              <Button
                disabled={
                  busy ||
                  dom.selectedLayers.length !== 1 ||
                  isLocked(viewDocument, selected.id)
                }
                onClick={() => {
                  linkedFileTarget.current = selected;
                  linkedFileInput.current?.click();
                }}
              >
                {selected.linkedSource
                  ? "Relink image file"
                  : "Link image file"}
              </Button>
              {selected.linkedSource && (
                <>
                  <span className="linked-source-status">
                    <span
                      className="linked-source-name"
                      title={selected.linkedSource.name}
                    >
                      {selected.linkedSource.name}
                    </span>
                    <span>Saved snapshot; select file to refresh</span>
                  </span>
                  <Button
                    disabled={busy || isLocked(viewDocument, selected.id)}
                    onClick={() => onAttempt(() => selected.embedSource())}
                  >
                    Embed source snapshot
                  </Button>
                </>
              )}
            </>
          )}
          {selected instanceof SmartObjectLayer && onEditSmartObject && (
            <Button
              disabled={
                busy ||
                dom.selectedLayers.length !== 1 ||
                !!selected.linkedSource
              }
              onClick={() => {
                onCancelTools();
                onClearPreview();
                onEditSmartObject(selected);
              }}
            >
              Edit contents
            </Button>
          )}
          {selected instanceof SmartObjectLayer && (
            <Button
              disabled={
                busy ||
                isLocked(viewDocument, selected.id) ||
                dom.selectedLayers.length !== 1
              }
              onClick={() => {
                onCancelTools();
                onClearPreview();
                onAttempt(() => {
                  selected.duplicateIndependent();
                });
              }}
            >
              New smart object via copy
            </Button>
          )}
          <div className="layer-actions">
            <IconButton
              shortcutId="duplicate"
              label="Duplicate layer (Mod+J)"
              disabled={!selected || locked || busy}
              onClick={onDuplicateLayer}
            >
              {layerIcons.copy}
            </IconButton>
            <IconButton
              shortcutId="up"
              label="Move layer forward (Mod+])"
              disabled={!selected || locked || busy}
              onClick={onMoveLayerForward}
            >
              {layerIcons.forward}
            </IconButton>
            <IconButton
              shortcutId="down"
              label="Move layer backward (Mod+[)"
              disabled={!selected || locked || busy}
              onClick={onMoveLayerBackward}
            >
              {layerIcons.backward}
            </IconButton>
            <span className="grow" />
            <IconButton
              label="Delete layer (Delete)"
              disabled={!selected || locked || busy}
              onClick={onDeleteLayer}
            >
              {layerIcons.delete}
            </IconButton>
          </div>
        </>
      ) : (
        <div className="history-list">
          <p className="section-caption">RETAINED HISTORY</p>
          <Button disabled={busy} onClick={onInspectHistory}>Inspect retained history</Button>
          <div className="history-entry">
            <span className="history-dot" />
            Oldest retained state
          </div>
          {historyPast.map((entry, index) => (
            <div className="history-entry" key={index}>
              <span className="history-dot" />
              {entry.label}
              {index === historyPast.length - 1 && layerIcons.currentHistory}
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
