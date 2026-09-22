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
  VectorLayer,
  TextLayer,
  LayerStyle,
} from "../dom";
import type { Layer } from "../dom";
import type { BlendMode, DocumentData, LayerData } from "../core/model";
import { BLEND_MODES, allLayers, findParent, toneOf } from "../core/model";
import { defaultStyle } from "../core/drawing";
import type { EditorCommand } from "../core/commands";
import {
  IconButton,
  NumberField,
  Select,
  Slider,
  TextInput,
} from "./controls";
import { PathProperties } from "./ToolOptions";
import { LayerStylesPanel } from "./LayerStylesPanel";
import { TextProperties } from "./TypographyPanel";

export interface InspectorPanelProps {
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
}

export function InspectorPanel({
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
}: InspectorPanelProps) {
  const tone = selected?.kind === "raster" ? toneOf(selected) : null;

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
          <section>
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
          </section>
          <section>
            <h2>Layout</h2>
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
                        if (layer instanceof RasterLayer)
                          layer.width = width;
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
                        if (layer instanceof RasterLayer)
                          layer.height = height;
                      })
                    }
                  />
                </>
              )}
            </div>
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
          </section>
          <section>
            <h2>Appearance</h2>
            <Select
              label="Blend mode"
              hideLabel
              className="wide-select"
              value={selected.blendMode}
              disabled={locked || busy}
              options={BLEND_MODES.map((mode) => ({
                value: mode,
                label:
                  mode[0].toUpperCase() +
                  mode.slice(1).replaceAll("-", " "),
              }))}
              onChange={(val) =>
                onSelectedAction((layer) => {
                  layer.blendMode = val as BlendMode;
                })
              }
            />
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
          </section>
          <section>
            <Slider
              label="Fill opacity"
              value={(selected.fillOpacity ?? 1) * 100}
              min={0}
              max={100}
              suffix="%"
              disabled={locked || busy}
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
          </section>
          {selectedObject instanceof VectorLayer && (
            <PathProperties
              layer={selectedObject}
              path={
                selectedObject.paths.get(
                  selectedPathId ?? "",
                ) ??
                selectedObject.paths.at(selectedObject.paths.length - 1)
              }
              disabled={locked || busy}
              onAction={(action) => onAttempt(() => { onPreview(null); action(); })}
              onPreview={onPreview}
              previewStrokeWidth={preview?.type === "path.update" && preview.id === selected.id ? preview.patch.strokeWidth : undefined}
            />
          )}
          {selectedObject instanceof TextLayer && (
            <TextProperties
              layer={selectedObject}
              disabled={locked || busy}
              onAction={(action) => onAttempt(() => { onPreview(null); action(); })}
              onPreview={onPreview}
            />
          )}
          {selected.kind === "paint" && (
            <section>
              <h2>Paint operations</h2>
              <p className="section-description">
                {selected.strokes.length} editable strokes and fills. Source
                images stay untouched.
              </p>
            </section>
          )}
          <LayerStylesPanel
            value={selected.styles ?? defaultStyle()}
            disabled={locked || busy}
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
          {tone && (
            <section>
              <h2>
                Adjustments
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
              </h2>
              <p className="section-description">
                Explore a different tone.
                <br />
                Your original image stays untouched.
              </p>
              {(["exposure", "contrast", "saturation"] as const).map(
                (key) => (
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
                ),
              )}
            </section>
          )}
        </div>
      ) : (
        <div className="inspector-empty">
          <MousePointer2 size={24} />
          <h3>A closer look.</h3>
          <p>
            Select a layer to adjust its position, appearance, and tone.
          </p>
        </div>
      )}
      <div className="inspector-bottom">
        <span>Made for a little experimentation.</span>
        <button onClick={onOpenHelp}>
          View keyboard shortcuts <ChevronRight size={12} />
        </button>
      </div>
    </aside>
  );
}
