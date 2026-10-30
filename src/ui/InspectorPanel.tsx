import { LutControls } from "./LutControls";
import {PerspectiveControls} from './PerspectiveControls';
import {clippingBaseFor} from '../core/clipping';
import { RedEyeControls } from "./RedEyeControls";
import { WhiteBalanceControls } from "./WhiteBalanceControls";
import { GradientMapControls } from "./GradientMapControls";
import { LayerCompsPanel } from "./LayerCompsPanel";
import {ParagraphStylesPanel} from './ParagraphStylesPanel';
import { AlphaChannelsPanel } from './AlphaChannelsPanel';
import { ChromaticAdjustmentControls } from "./ChromaticAdjustmentControls";
import { SmartFilterMaskPanel } from "./SmartFilterMaskPanel";
import { SmartFiltersPanel } from "./SmartFiltersPanel";
import {FrequencyRadiusControls} from './FrequencyRadiusControls';
import {frequencyRadiusOwner} from '../core/frequency-separation';
import { GuidesPanel } from "./GuidesPanel";
import { AffineTransform } from "../core/affine";
import { layerBounds, layerTransform, parentId } from "../core/spatial";
import { CanvasRenderer } from "../engine/renderer";
import { useEffect, useState } from "react";
import { LayerMaskPanel } from "./LayerMaskPanel";
import { AssetInfoPanel } from "./AssetInfoPanel";
import type { AssetStore } from "../core/assets";
import {
  ChevronRight,
  LockKeyhole,
  MousePointer2,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import {
  Document,
  LayerGroup,
  RasterLayer,
  SmartObjectLayer,
  VectorLayer,
  TextLayer,
  LayerStyle,
  AdjustmentLayer,
} from "../dom";
import type { Layer } from "../dom";
import {GROUP_BLEND_MODES, type LayerBlendMode, type DocumentData, type LayerData} from "../core/model";
import { BLEND_MODES, allLayers, findParent, toneOf } from "../core/model";
import { defaultStyle } from "../core/drawing";
import type { EditorCommand } from "../core/commands";
import { Button, IconButton, NumberField, Select, Slider, TextInput } from "./controls";
import { InspectorSection } from "./InspectorSection";
import { PathProperties } from "./ToolOptions";
import { LayerStylesPanel } from "./LayerStylesPanel";
import { TextProperties } from "./TypographyPanel";
import { CurvesEditor } from "./CurvesEditor";
import { LevelsEditor } from "./LevelsEditor";
import { HistogramView } from "./HistogramView";
import {
  defaultCurvesAdjustment,
  defaultHslAdjustment,
  defaultColorBalanceAdjustment,
  defaultVibranceAdjustment,
  defaultGradientMapAdjustment,
  defaultWhiteBalanceAdjustment,
  defaultRedEyeAdjustment,
  defaultLutAdjustment,
  defaultLevelsAdjustment,
  defaultToneAdjustment,
} from "../core/adjustments";
import { computeHistogram,computeFloatHistogram, adjustmentBackdrop } from "../core/histogram";
import type { HistogramData } from "../core/histogram";

export interface InspectorPanelProps {
  perspectiveEditing:boolean;canEditPerspective:boolean;onTogglePerspective():void;
  guidesVisible: boolean;
  onGuidesVisible(value: boolean): void;
  assets: AssetStore;
  document: Document;
  viewDocument: DocumentData;
  selected: LayerData | undefined;
  selectedObject: Layer | null;
  selectedPathId?: string | null;
  locked: boolean;
  busy: boolean;
  wasmReady: boolean;
  preview: EditorCommand | null;
  onPreview(preview: EditorCommand | null): void;
  onAttempt(action: () => void): void;
  onSelectedAction(action: (layer: Layer) => void): void;
  onOpenHelp(): void;
  onCombinePaths(): void;
  onManageFonts():void;
  onDevelopRaw(layer:SmartObjectLayer):void;
}

export function InspectorPanel({
  perspectiveEditing,canEditPerspective,onTogglePerspective,
  guidesVisible,
  onGuidesVisible,
  assets,
  document: dom,
  viewDocument,
  selected,
  selectedObject,
  selectedPathId,
  locked,
  busy,
  wasmReady,
  preview,
  onPreview,
  onAttempt,
  onSelectedAction,
  onOpenHelp,
  onCombinePaths,
  onManageFonts,
  onDevelopRaw,
}: InspectorPanelProps) {
  const float=dom.precision==='float32';
  const frequencyOwner=selected?frequencyRadiusOwner(viewDocument,selected.id):null;
  const frequencyGroup=frequencyOwner?dom.getLayer(frequencyOwner.id) as LayerGroup:null;
  const tone = selected?.kind === "raster" ? toneOf(selected) : null;
  const selectedWorld = selected
    ? layerTransform(viewDocument, selected.id)
    : undefined;
  const rotation = selectedWorld
    ? (Math.atan2(selectedWorld.b, selectedWorld.a) * 180) / Math.PI
    : 0;
  const rotationBounds = selected
    ? layerBounds(viewDocument, selected.id)
    : undefined;
  const rotationPatch = (degrees: number) => {
    if (!selected) throw new Error("Select a layer to rotate.");
    const snapshot = dom.getSnapshot().document;
    const world = layerTransform(snapshot, selected.id)!;
    const bounds = layerBounds(snapshot, selected.id);
    if (!bounds) throw new Error("This layer has no geometry to rotate.");
    const delta = (degrees * Math.PI) / 180 - Math.atan2(world.b, world.a);
    const rotated = AffineTransform.rotation(delta)
      .around({
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      })
      .multiply(world);
    const parent = parentId(snapshot, selected.id);
    const local = parent
      ? layerTransform(snapshot, parent)!.inverse().multiply(rotated)
      : rotated;
    return {
      x: local.e,
      y: local.f,
      transform: { ...local.toJSON(), e: 0, f: 0 },
    };
  };

  const [histogram, setHistogram] = useState<HistogramData | null>(null);

  useEffect(() => {
    if (selected?.kind !== "adjustment") {
      setHistogram(null);
      return;
    }
    setHistogram(null);
    const backdrop = adjustmentBackdrop(viewDocument, selected.id);
    if (!backdrop) return;
    const renderer = new CanvasRenderer();
    let cancelled = false;
    void (async()=>{
      if(backdrop.precision==='float32'){
        const scale=Math.min(1,256/backdrop.width,256/backdrop.height),width=Math.max(1,Math.round(backdrop.width*scale)),height=Math.max(1,Math.round(backdrop.height*scale));
        const scene=await renderer.captureFloatScene(backdrop,assets,{isCancelled:()=>cancelled});try{const samples=await scene.read({x:0,y:0,width,height},{region:{x:0,y:0,width:backdrop.width,height:backdrop.height},width,height});if(!cancelled)setHistogram(computeFloatHistogram(samples));}finally{scene.dispose();}return;
      }
      const canvas=await renderer.render(backdrop,assets,{cache:false,readback:true,maxDimension:256,maxPixels:65536});
      try{if(!cancelled)setHistogram(computeHistogram(canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data));}finally{canvas.width=canvas.height=0;}
    })()
      .catch(() => {
        if (!cancelled) setHistogram(null);
      })
      .finally(() => renderer.dispose());
    return () => {
      cancelled = true;renderer.dispose();
    };
  }, [selected?.id, selected?.kind, viewDocument, assets]);

  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <SlidersHorizontal size={15} />
        <strong>Properties</strong>
        <span className="grow" />
        <span className="section-caption">
          {selected?.kind === "group"
            ? "GROUP"
            : selected
              ? selected.kind.toUpperCase()
              : "CANVAS"}
        </span>
      </div>
      {selected ? (
        <div className="inspector-scroll">
          {selected.kind === "raster" && selectedObject && (
            <AssetInfoPanel
              key={selected.assetId}
              asset={assets.get(selected.assetId)}
              service={assets.metadata}
              analysis={assets.analysis}
              layer={selectedObject}
              hasAuthoredMetadata={!!selected.metadata}
              document={dom}
              disabled={locked || busy}
              onAttempt={onAttempt}
            />
          )}
          <InspectorSection title="Layer">
            <TextInput
              label="Layer name"
              layout="stacked"
              key={selected.id + selected.name}
              value={selected.name}
              disabled={locked || busy}
              maxLength={240}
              onCommit={(name) => {
                onSelectedAction((layer) => {
                  layer.name = name;
                });
              }}
            />
            {locked && (
              <div className="lock-notice">
                <LockKeyhole size={13} />
                Unlock the layer or its group to edit.
              </div>
            )}
          </InspectorSection>
          {(selected.kind==='raster'||selected.kind==='smart-object')&&(selectedObject instanceof RasterLayer||selectedObject instanceof SmartObjectLayer)&&<PerspectiveControls editing={perspectiveEditing} canEdit={canEditPerspective} onToggleEditing={onTogglePerspective} layer={selectedObject} selected={selected} disabled={locked||busy} onPreview={onPreview} onAttempt={onAttempt} onSelectedAction={onSelectedAction}/>}
          <InspectorSection title="Layout">
            <div className="field-grid">
              <NumberField
                label="X"
                value={selected.x}
                min={-Number.MAX_SAFE_INTEGER}
                max={Number.MAX_SAFE_INTEGER}
                disabled={locked || busy}
                onCommit={(x) =>
                  onSelectedAction((layer) => {
                    layer.x = x;
                  })
                }
              />
              <NumberField
                label="Y"
                value={selected.y}
                min={-Number.MAX_SAFE_INTEGER}
                max={Number.MAX_SAFE_INTEGER}
                disabled={locked || busy}
                onCommit={(y) =>
                  onSelectedAction((layer) => {
                    layer.y = y;
                  })
                }
              />
              {selected.kind === "raster" && (
                <>
                  <NumberField
                    label="Width"
                    value={selected.width}
                    min={1}
                    max={Number.MAX_SAFE_INTEGER}
                    disabled={locked || busy}
                    onCommit={(width) =>
                      onSelectedAction((layer) => {
                        if (layer instanceof RasterLayer) layer.width = width;
                      })
                    }
                  />
                  <NumberField
                    label="Height"
                    value={selected.height}
                    min={1}
                    max={Number.MAX_SAFE_INTEGER}
                    disabled={locked || busy}
                    onCommit={(height) =>
                      onSelectedAction((layer) => {
                        if (layer instanceof RasterLayer) layer.height = height;
                      })
                    }
                  />
                </>
              )}
            </div>
            <Slider
              label="Rotation"
              value={Math.round(rotation * 1000) / 1000}
              min={-180}
              max={180}
              step={0.1}
              suffix="°"
              disabled={locked || busy || !rotationBounds}
              onPreview={(value) =>
                onAttempt(() =>
                  onPreview({
                    type: "layer.update",
                    id: selected.id,
                    patch: rotationPatch(value),
                  }),
                )
              }
              onCommit={(value) => {
                onPreview(null);
                onSelectedAction((layer) => layer.update(rotationPatch(value)));
              }}
            />
            <Select
              label="Parent group"
              layout="stacked"
              className="group-field"
              disabled={locked || busy}
              value={findParent(viewDocument.children, selected.id) ?? ""}
              options={[
                { value: "", label: "Document" },
                ...allLayers(viewDocument.children)
                  .filter(
                    (layer) =>
                      layer.kind === "group" &&
                      layer.id !== selected.id &&
                      !(
                        selected.kind === "group" &&
                        allLayers(selected.children).some(
                          (child) => child.id === layer.id,
                        )
                      ),
                  )
                  .map((group) => ({ value: group.id, label: group.name })),
              ]}
              onChange={(val) =>
                onSelectedAction((layer) => {
                  const parent = val ? dom.getLayer(val) : dom;
                  if (
                    parent instanceof Document ||
                    parent instanceof LayerGroup
                  )
                    layer.moveTo(parent, { preservePosition: true });
                })
              }
            />
          </InspectorSection>
          {frequencyGroup&&frequencyOwner?.frequencyRadius!=null&&<FrequencyRadiusControls key={`${dom.id}:${frequencyGroup.id}`} document={dom} group={frequencyGroup} value={frequencyOwner.frequencyRadius} busy={busy} onPreview={onPreview} onAttempt={onAttempt}/>}
          <InspectorSection title="Appearance">
            <label className="check-field"><input type="checkbox" checked={selected.clipped??false}
              disabled={locked||busy||(!selected.clipped&&!clippingBaseFor(dom._read().children,selected.id))}
              onChange={event=>{onPreview(null);const value=event.target.checked;onSelectedAction(layer=>{layer.clipped=value;});}}/>Clip to base layer</label>
            {selected.clipped&&<p className="panel-description">{clippingBaseFor(dom._read().children,selected.id)?.name??'No base layer'} controls this layer’s visible area.</p>}
            {selected.blendMode==='pass-through'&&<p className="panel-description">Pass-through blends with surrounding layers unless this group is a clipping base. Choose Normal to use group styles or fill opacity.</p>}
            <Select
              label="Blend mode"
              hideLabel
              className="wide-select"
              value={selected.blendMode}
              disabled={locked || busy}
              options={(selected.kind==='group'?GROUP_BLEND_MODES:BLEND_MODES).map((mode) => ({
                value: mode,
                label:
                  mode[0].toUpperCase() + mode.slice(1).replaceAll("-", " "),
              }))}
              onChange={(val) =>
                onSelectedAction((layer) => {
                  layer.blendMode = val as LayerBlendMode;
                })
              }
            />
            {float&&selected.blendMode!=='normal'&&selected.blendMode!=='pass-through'&&<p className="panel-description">This blend uses the normal SDR color range. Choose Normal to retain extended-range colors.</p>}
            <Slider
              label="Opacity"
              value={selected.opacity * 100}
              min={0}
              max={100}
              suffix="%"
              disabled={locked || busy}
              onPreview={(value) =>
                onPreview({
                  type: "layer.update",
                  id: selected.id,
                  patch: { opacity: value / 100 },
                })
              }
              onCommit={(value) => {
                onPreview(null);
                onSelectedAction((layer) => {
                  layer.opacity = value / 100;
                });
              }}
            />
            <Slider
              label="Fill opacity"
              value={(selected.fillOpacity ?? 1) * 100}
              min={0}
              max={100}
              suffix="%"
              disabled={locked || busy || selected.blendMode==='pass-through'}
              onPreview={(value) =>
                onPreview({
                  type: "layer.update",
                  id: selected.id,
                  patch: { fillOpacity: value / 100 },
                })
              }
              onCommit={(value) =>
                onSelectedAction((layer) => {
                  layer.fillOpacity = value / 100;
                })
              }
            />
          </InspectorSection>
          {selectedObject instanceof SmartObjectLayer&&selectedObject.rawDevelopment&&<InspectorSection title="RAW development"><Button disabled={locked||busy} onClick={()=>onDevelopRaw(selectedObject)}>Develop RAW…</Button></InspectorSection>}
          {selected.kind === "smart-object" &&
            selectedObject instanceof SmartObjectLayer && (
              <SmartFiltersPanel
                key={`${dom.id}:${selected.id}`}
                document={dom}
                layer={selectedObject}
                value={selected.smartFilters ?? []}
                sharedRadius={frequencyOwner?.frequencyRadius??undefined}
                disabled={locked || busy || !wasmReady}
                onPreview={onPreview}
                onAttempt={onAttempt}
              />
            )}
          {selected.kind === "smart-object" &&
            selectedObject instanceof SmartObjectLayer && (
              <SmartFilterMaskPanel
                key={`filter-mask:${dom.id}:${selected.id}`}
                document={dom}
                layer={selectedObject}
                value={selected.filterMask ?? null}
                disabled={locked || busy || !wasmReady}
                onPreview={onPreview}
                onAttempt={onAttempt}
              />
            )}
          {selectedObject && (
            <LayerMaskPanel
              document={dom}
              layer={selectedObject}
              value={selected.mask ?? null}
              disabled={locked || busy}
              onAttempt={onAttempt}
              onPreview={(mask) =>
                onPreview(
                  mask
                    ? { type: "layer.update", id: selected.id, patch: { mask } }
                    : null,
                )
              }
            />
          )}
          {selectedObject instanceof VectorLayer && (
            <InspectorSection title="Boolean paths"><Button disabled={busy||locked} onClick={onCombinePaths}>Combine vector paths…</Button></InspectorSection>
          )}
          {selectedObject instanceof VectorLayer && (
            <PathProperties
              layer={selectedObject}
              anchorCount={selected.kind === "vector" ?
                (() => { const path = selected.paths.find(path => path.id === selectedPathId) ?? selected.paths.at(-1); return path ? path.points.length + (path.subpaths ?? []).reduce((sum, c) => sum + c.points.length, 0) : 0; })() : 0}
              path={
                selectedObject.paths.get(selectedPathId ?? "") ??
                selectedObject.paths.at(selectedObject.paths.length - 1)
              }
              disabled={locked || busy}
              onAction={(action) =>
                onAttempt(() => {
                  onPreview(null);
                  action();
                })
              }
              onPreview={onPreview}
              previewGradient={preview?.type === "path.update" && preview.id === selected.id ? preview.patch.fillGradient : undefined}
              previewStrokeWidth={
                preview?.type === "path.update" && preview.id === selected.id
                  ? preview.patch.strokeWidth
                  : undefined
              }
            />
          )}
          {selectedObject instanceof TextLayer && (
            <>
            <ParagraphStylesPanel layer={selectedObject} disabled={locked||busy} onAction={action=>onAttempt(()=>{onPreview(null);action();})}/>
            <TextProperties
              onManageFonts={onManageFonts}
              layer={selectedObject}
              disabled={locked || busy}
              onAction={(action) =>
                onAttempt(() => {
                  onPreview(null);
                  action();
                })
              }
              onPreview={onPreview}
            />
            </>
          )}
          {selected.kind === "paint" && (
            <InspectorSection title="Paint operations">
              <p className="section-description">
                {selected.strokes.length} editable strokes and fills. Source
                images stay untouched.
              </p>
            </InspectorSection>
          )}
          <LayerStylesPanel
            key={selected.id}
            onCancel={() => onPreview(null)}
            value={selected.styles ?? defaultStyle()}
            float={float}
            shadowUnavailable={float && selected.kind === 'adjustment'}
            disabled={locked || busy || selected.blendMode==='pass-through'}
            onPreview={(styles) =>
              onPreview({
                type: "layer.update",
                id: selected.id,
                patch: { styles },
              })
            }
            onCommit={(styles) =>
              onSelectedAction((layer) => {
                layer.styles = new LayerStyle(styles);
              })
            }
          />
          {selected.kind === "adjustment" &&
            selectedObject instanceof AdjustmentLayer && (
              <InspectorSection
                title="Adjustment"
                className="adjustment-inspector-section"
                actions={
                  <IconButton
                    label="Reset adjustment"
                    disabled={locked || busy}
                    onClick={() =>
                      onSelectedAction((layer) => {
                        if (layer instanceof AdjustmentLayer) {
                          const kind = layer.adjustmentKind;
                          layer.update({
                            adjustment:
                              kind === "tonal" ? {kind:"tonal",strokes:[]} : kind === "red-eye" ? defaultRedEyeAdjustment() : kind === "curves"
                                ? defaultCurvesAdjustment()
                                : kind === "levels"
                                  ? defaultLevelsAdjustment()
                                  : kind === "hsl"
                                    ? defaultHslAdjustment()
                                    : kind === "color-balance"
                                      ? defaultColorBalanceAdjustment()
                                      : kind === "vibrance"
                                        ? defaultVibranceAdjustment()
                                        : kind === "gradient-map"
                                          ? defaultGradientMapAdjustment()
                                          : kind === "white-balance"
                                            ? defaultWhiteBalanceAdjustment()
                                            : kind === "lut" ? defaultLutAdjustment()
                                    : defaultToneAdjustment(),
                          });
                        }
                      })
                    }
                  >
                    <RotateCcw size={13} />
                  </IconButton>
                }
              >
                <p className="section-description">
                  Modifies preceding backdrop non-destructively.
                  <br />
                  Original pixels stay untouched.
                </p>

                <Select
                  label="Adjustment type"
                  value={selected.adjustment.kind}
                  disabled={locked || busy}
                  options={[
                    { value: "tonal", label: "Tonal strokes", disabled: true },
                    { value: "patch", label: "Retouch patch", disabled: true },
                    { value: "hsl", label: "Hue / Saturation / Lightness" },
                    { value: "color-balance", label: "Color Balance" },
                    { value: "vibrance", label: "Vibrance" },
                    { value: "gradient-map", label: "Gradient Map" },
                    { value: "red-eye", label: "Red Eye",disabled:float },
                    { value: "white-balance", label: "White Balance" },
                    { value: "lut", label: "Color Lookup (LUT)" },
                    { value: "curves", label: "Curves" },
                    { value: "levels", label: "Levels" },
                    { value: "tone", label: float?'Linear tone (Exposure / Contrast / Saturation)':"Tone (Exposure / Contrast)" },
                  ]}
                  onChange={(kind) => {
                    onSelectedAction((layer) => {
                      if (layer instanceof AdjustmentLayer) {
                        if (kind === "hsl")
                          layer.adjustment = defaultHslAdjustment();
                        else if (kind === "color-balance") layer.adjustment = defaultColorBalanceAdjustment();
                        else if (kind === "red-eye") layer.adjustment = defaultRedEyeAdjustment();
                        else if (kind === "white-balance") layer.adjustment = defaultWhiteBalanceAdjustment();
                        else if (kind === "lut") layer.adjustment = defaultLutAdjustment();
                        else if (kind === "gradient-map") layer.adjustment = defaultGradientMapAdjustment();
                        else if (kind === "vibrance") layer.adjustment = defaultVibranceAdjustment();
                        else if (kind === "curves")
                          layer.setCurves(defaultCurvesAdjustment());
                        else if (kind === "levels")
                          layer.setLevels(defaultLevelsAdjustment());
                        else if (kind === "tone")
                          layer.setTone(defaultToneAdjustment());
                      }
                    });
                  }}
                />

                {selected.adjustment.kind === "tonal" && (
                  <p>
                    {selected.adjustment.strokes.length} editable tonal strokes
                  </p>
                )}
                {float&&selected.adjustment.kind==='tonal'&&<p className="section-description">Linear exposure strokes preserve signed and HDR colors. Protect tones limits new highlights; turn it off to brighten HDR colors.</p>}
                {float&&(selected.adjustment.kind==='hsl'||selected.adjustment.kind==='color-balance'||selected.adjustment.kind==='vibrance')&&<p className="section-description">sRGB color controls retain float precision. Active settings need RGB from 0 to 1; neutral settings preserve extended colors.</p>}
                {float&&(selected.adjustment.kind==='curves'||selected.adjustment.kind==='levels')&&<p className="section-description">Linear RGB: 255 means 1. Curves extend their endpoint tangents; active Levels clip to their black/white range.</p>}
                {selected.adjustment.kind === "curves" && (
                  <CurvesEditor
                    linear={float}
                    value={selected.adjustment}
                    histogram={histogram}
                    disabled={locked || busy}
                    onPreview={(adjustment) =>
                      onPreview({
                        type: "layer.update",
                        id: selected.id,
                        patch: { adjustment },
                      })
                    }
                    onCommit={(adjustment) => {
                      onPreview(null);
                      onSelectedAction((layer) => {
                        if (layer instanceof AdjustmentLayer) {
                          layer.update({ adjustment });
                        }
                      });
                    }}
                  />
                )}

                {selected.adjustment.kind === "levels" && (
                  <LevelsEditor
                    value={selected.adjustment}
                    histogram={histogram}
                    disabled={locked || busy}
                    onPreview={(adjustment) =>
                      onPreview({
                        type: "layer.update",
                        id: selected.id,
                        patch: { adjustment },
                      })
                    }
                    onCommit={(adjustment) => {
                      onPreview(null);
                      onSelectedAction((layer) => {
                        if (layer instanceof AdjustmentLayer) {
                          layer.update({ adjustment });
                        }
                      });
                    }}
                  />
                )}

                {float&&selected.adjustment.kind==='lut'&&<p className="section-description">Signed sRGB lookup retains extended float colors. Table domains bound input; zero amount preserves original colors. The SDR preview and integer exports can clip.</p>}
                {selected.adjustment.kind === "lut" && <LutControls key={selected.id}
                  adjustment={selected.adjustment} disabled={locked || busy}
                  onPreview={adjustment => onPreview({type:"layer.update", id:selected.id, patch:{adjustment}})}
                  onCommit={adjustment => {onPreview(null);onSelectedAction(layer => {if(layer instanceof AdjustmentLayer) layer.adjustment = adjustment;});}} />}
                {selected.adjustment.kind === "red-eye" && <RedEyeControls key={selected.id}
                  adjustment={selected.adjustment} disabled={locked || busy}
                  onPreview={adjustment => onPreview({type:"layer.update", id:selected.id, patch:{adjustment}})}
                  onCommit={adjustment => {onPreview(null);onSelectedAction(layer => {if(layer instanceof AdjustmentLayer) layer.adjustment = adjustment;});}} />}
                {float&&selected.adjustment.kind==='white-balance'&&<p className="section-description">Adjusts linear RGB without clipping. The SDR preview and integer exports can clip extended colors.</p>}
                {selected.adjustment.kind === "white-balance" && <WhiteBalanceControls
                  adjustment={selected.adjustment} disabled={locked || busy}
                  onPreview={adjustment => onPreview({type:"layer.update", id:selected.id, patch:{adjustment}})}
                  onCommit={adjustment => {onPreview(null);onSelectedAction(layer => {if(layer instanceof AdjustmentLayer) layer.adjustment = adjustment;});}} />}
                {float&&selected.adjustment.kind==='gradient-map'&&<p className="section-description">Maps continuous sRGB luma to your palette. Extended inputs map to palette endpoints; source colors stay unchanged.</p>}
                {selected.adjustment.kind === "gradient-map" && <GradientMapControls
                  key={selected.id} adjustment={selected.adjustment} disabled={locked || busy}
                  onPreview={adjustment => onPreview({type: "layer.update", id: selected.id, patch: {adjustment}})}
                  onCancel={() => onPreview(null)}
                  onCommit={adjustment => {onPreview(null);onSelectedAction(layer => {if (layer instanceof AdjustmentLayer) layer.adjustment = adjustment;});}} />}
                {(selected.adjustment.kind === "color-balance" || selected.adjustment.kind === "vibrance") && <ChromaticAdjustmentControls
                  adjustment={selected.adjustment} disabled={locked||busy}
                  onPreview={adjustment=>onPreview({type:"layer.update",id:selected.id,patch:{adjustment}})}
                  onCommit={adjustment=>{onPreview(null);onSelectedAction(layer=>{if(layer instanceof AdjustmentLayer)layer.adjustment=adjustment;});}} />}
                {selected.adjustment.kind === "hsl" &&
                  (["hue", "saturation", "lightness"] as const).map((key) => (
                    <Slider
                      key={key}
                      label={
                        key === "hue"
                          ? "Hue"
                          : key === "saturation"
                            ? "HSL saturation"
                            : "Lightness"
                      }
                      value={
                        selected.adjustment.kind === "hsl"
                          ? selected.adjustment[key]
                          : 0
                      }
                      min={key === "hue" ? -180 : -100}
                      max={key === "hue" ? 180 : 100}
                      step={1}
                      suffix={key === "hue" ? "°" : "%"}
                      disabled={locked || busy}
                      onPreview={(value) =>
                        onPreview({
                          type: "layer.update",
                          id: selected.id,
                          patch: {
                            adjustment: {
                              ...selected.adjustment,
                              [key]: value,
                            },
                          },
                        })
                      }
                      onCommit={(value) => {
                        onPreview(null);
                        onSelectedAction((layer) => {
                          if (layer instanceof AdjustmentLayer)
                            layer.adjustment = {
                              ...selected.adjustment,
                              [key]: value,
                            };
                        });
                      }}
                    />
                  ))}

                {selected.adjustment.kind === "tone" && (
                  <div className="adjustment-tone-controls">
                    {float&&<p className="section-description">Linear RGB tone. Contrast pivots at 0.5; extended colors can exceed the SDR preview.</p>}
                    <HistogramView histogram={histogram} compact height={80} />
                    {(["exposure", "contrast", "saturation"] as const).map(
                      (key) => {
                        const toneVal = (selected.adjustment as any)[key];
                        return (
                          <Slider
                            key={key}
                            label={key[0].toUpperCase() + key.slice(1)}
                            value={toneVal}
                            min={key === "exposure" ? -3 : -100}
                            max={key === "exposure" ? 3 : 100}
                            step={key === "exposure" ? 0.05 : 1}
                            suffix={key === "exposure" ? " EV" : ""}
                            disabled={locked || busy}
                            onPreview={(val) =>
                              onPreview({
                                type: "layer.update",
                                id: selected.id,
                                patch: {
                                  adjustment: {
                                    ...selected.adjustment,
                                    [key]: val,
                                  },
                                },
                              })
                            }
                            onCommit={(val) => {
                              onPreview(null);
                              onSelectedAction((layer) => {
                                if (layer instanceof AdjustmentLayer) {
                                  layer.update({
                                    adjustment: {
                                      ...selected.adjustment,
                                      [key]: val,
                                    },
                                  });
                                }
                              });
                            }}
                          />
                        );
                      },
                    )}
                  </div>
                )}
              </InspectorSection>
            )}
          {tone && (
            <InspectorSection
              title="Adjustments"
              actions={
                <IconButton
                  label="Reset adjustments"
                  disabled={
                    locked ||
                    busy ||
                    !selected ||
                    selected.kind !== "raster" ||
                    !selected.effects.length
                  }
                  onClick={() =>
                    onSelectedAction((layer) => {
                      if (layer instanceof RasterLayer)
                        layer.resetAdjustments();
                    })
                  }
                >
                  <RotateCcw size={13} />
                </IconButton>
              }
            >
              <p className="section-description">
                {float?'Linear RGB tone. Contrast pivots at 0.5; extended colors can exceed the SDR preview.':'Explore a different tone.'}
                <br />
                Your original image stays untouched.
              </p>
              {(["exposure", "contrast", "saturation"] as const).map((key) => (
                <Slider
                  key={key}
                  label={key[0].toUpperCase() + key.slice(1)}
                  value={tone[key]}
                  min={key === "exposure" ? -3 : -100}
                  max={key === "exposure" ? 3 : 100}
                  step={key === "exposure" ? 0.05 : 1}
                  suffix={key === "exposure" ? " EV" : ""}
                  disabled={locked || busy || !wasmReady}
                  onPreview={(value) =>
                    onPreview({
                      type: "effect.tone",
                      id: selected.id,
                      values: { [key]: value },
                    })
                  }
                  onCommit={(value) => {
                    onPreview(null);
                    onSelectedAction((layer) => {
                      if (
                        layer instanceof RasterLayer &&
                        toneOf(
                          layer.toJSON() as Extract<
                            LayerData,
                            { kind: "raster" }
                          >,
                        )[key] !== value
                      )
                        layer.setTone({ [key]: value });
                    });
                  }}
                />
              ))}
            </InspectorSection>
          )}
        </div>
      ) : (
        <div className="inspector-empty">
          <MousePointer2 size={24} />
          <h3>A closer look.</h3>
          <p>Select a layer to adjust its position, appearance, and tone.</p>
        </div>
      )}
      <LayerCompsPanel
        key={dom.id}
        document={dom}
        disabled={busy}
        onAttempt={onAttempt}
      />
      <AlphaChannelsPanel key={`channels:${dom.id}`} document={dom} disabled={busy} onAttempt={onAttempt}/>
      <GuidesPanel
        document={dom}
        visible={guidesVisible}
        onVisible={onGuidesVisible}
        disabled={busy}
        onAttempt={onAttempt}
      />
      <div className="inspector-bottom">
        <span>Made for a little experimentation.</span>
        <button onClick={onOpenHelp}>
          View keyboard shortcuts <ChevronRight size={12} />
        </button>
      </div>
    </aside>
  );
}
