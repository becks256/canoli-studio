import {LayerAlignmentControls} from './LayerAlignmentControls';
import type {AlignmentTarget,LayerAlignment} from '../core/layer-layout';
import { LayerTreeRow } from "./LayerTreeRow";
import type { RasterEditing } from "../raster-editing";
import { LayerFilterBar } from "./LayerFilterBar";
import { emptyLayerFilter, filterLayers } from "./layer-filter";
import { useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent, SyntheticEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FolderPlus,
  Layers,
  SquarePlus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  SmartObjectLayer,
  type Document,
  type Layer,
  type LayerGroup,
} from "../dom";
import type { DocumentData, LayerData } from "../core/model";
import { allLayers, findLayer, isLocked } from "../core/model";
import { Button, IconButton, Slider } from "./controls";

// These glyphs have no row state or handlers. Retain their elements so a text
// edit does not rebuild every unchanged icon in the layer list. State-dependent
// controls still choose the appropriate glyph on every render.
const layerIcons = {
  adjustment: <SlidersHorizontal size={15} />,
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
  onAlign?(alignment:LayerAlignment,target:AlignmentTarget):void;
  alignmentKeyId?:string;
  onAlignmentKeyChange?(id:string):void;
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
  onAlign,
  alignmentKeyId,
  onAlignmentKeyChange,
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
  const selectionKey = JSON.stringify(dom.getSnapshot().selectedIds);
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

  function eventRow(event:SyntheticEvent<HTMLDivElement>) {
    const target=event.target instanceof Element?event.target:event.target instanceof Node?event.target.parentElement:null;
    const row=target?.closest<HTMLDivElement>('.layer-row[data-layer-id]');
    return row&&event.currentTarget.contains(row)?{row,target,id:row.dataset.layerId!}:null;
  }

  function clickRow(event:MouseEvent<HTMLDivElement>) {
    const hit=eventRow(event);if(!hit)return;
    const node=findLayer(viewDocument,hit.id);if(!node)return;
    if(hit.target?.closest('img.pixel-thumb')&&(event.ctrlKey||event.metaKey)&&!busy&&onLoadTransparency){
      event.preventDefault();event.stopPropagation();onLoadTransparency(hit.id);return;
    }
    const button=hit.target?.closest<HTMLButtonElement>('button[data-layer-action]');
    if(!button||!hit.row.contains(button)||button.disabled)return;
    const action=button.dataset.layerAction;
    if(action==='toggle'){
      setCollapsed(old=>{const next=new Set(old);if(next.has(hit.id))next.delete(hit.id);else next.add(hit.id);return next;});
    }else if(action==='select'){
      onCancelTools();onClearPreview();
      const object=dom.getLayer(hit.id);
      if(object)onSelectLayer(object,event.ctrlKey||event.metaKey||event.shiftKey);
    }else if(action==='lock'||action==='visibility'){
      onAttempt(()=>{
        const object=dom.getLayer(hit.id);if(!object)return;
        if(action==='lock')object.locked=!node.locked;else object.visible=!node.visible;
      });
    }
  }

  function startRowDrag(event:DragEvent<HTMLDivElement>) {
    const hit=eventRow(event);if(!hit||!hit.row.draggable)return;
    onCancelTools();event.dataTransfer.setData('application/x-luma-layer',hit.id);
    event.dataTransfer.effectAllowed='move';setDraggedLayer(hit.id);
  }
  function overRowDrag(event:DragEvent<HTMLDivElement>) {
    const hit=eventRow(event);if(!hit||!draggedLayer||draggedLayer===hit.id)return;
    const node=findLayer(viewDocument,hit.id);if(!node)return;
    event.preventDefault();event.stopPropagation();
    const box=hit.row.getBoundingClientRect(),y=(event.clientY-box.top)/box.height;
    setDropTarget({id:hit.id,placement:node.kind==='group'&&y>0.25&&y<0.75?'inside':y<0.5?'after':'before'});
  }
  function dropRow(event:DragEvent<HTMLDivElement>) {
    const hit=eventRow(event);if(hit)dropLayer(event,hit.id,dropTarget?.id===hit.id?dropTarget.placement:'after');
  }

  function renderLayers(nodes:LayerData[],depth=0) {
    return [...nodes].reverse().filter(node=>filtered.included.has(node.id)).map(node=>{
      const thumbnailPixels=node.kind==='raster'||node.kind==='paint'?pixels:undefined;
      return <div key={node.id}>
        <LayerTreeRow node={node} depth={depth} selected={dom.getSnapshot().selectedIds.includes(node.id)}
          locked={isLocked(viewDocument,node.id)} busy={busy} filterContext={filtered.active&&!filtered.matches.has(node.id)}
          filtered={filtered.active} collapsed={isCollapsed(node.id)} dropPlacement={dropTarget?.id===node.id?dropTarget.placement:undefined}
          pixels={thumbnailPixels} thumbnailDocument={thumbnailPixels?dom.getSnapshot().document:undefined}
          paused={!!thumbnailPixels&&deferThumbnails} fallback={node.kind==='raster'?getThumbnail(node.assetId):undefined}/>
        {node.kind==='group'&&!isCollapsed(node.id)&&renderLayers(node.children,depth+1)}
      </div>;
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
            disabled={busy||dom.precision==='float32'}
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
          <div className="layer-list" onClick={clickRow} onDragStart={startRowDrag} onDragOver={overRowDrag} onDrop={dropRow} onDragEnd={()=>{setDraggedLayer(null);setDropTarget(null);}}>
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
          <LayerAlignmentControls document={dom} viewDocument={viewDocument} busy={busy} keyLayerId={alignmentKeyId} onKeyChange={onAlignmentKeyChange} onAlign={(alignment,target)=>{
            if(onAlign)onAlign(alignment,target);else{onCancelTools();onClearPreview();onAttempt(()=>dom.layerSelection.align(alignment,target.type==='layer'?dom.getLayer(target.id)!:target.type));}
          }}/>
          {dom.selectedLayers.length>0&&<div className="layer-extra-controls" role="region" aria-label="Additional layer controls" tabIndex={0} onKeyDown={event=>{
            if(event.target===event.currentTarget&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))event.stopPropagation();
          }}>
          {dom.selectedLayers.length > 1 && (
            <div className="layer-filter-bar">
              <span>{dom.selectedLayers.length} layers selected</span>
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
          </div>}
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
