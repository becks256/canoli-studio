import { useState } from "react";
import { allLayers } from "../core/model";
import type { Document, Layer } from "../dom";
import { LayerMask, MarqueeSelection, VectorLayer } from "../dom";
import type { LayerMaskData } from "../core/masks";
import { Button, Slider, Select, NumberField } from "./controls";
import { InspectorSection } from "./InspectorSection";

export function LayerMaskPanel({
  document,
  layer,
  value,
  disabled,
  onAttempt,
  onPreview,
}: {
  document: Document;
  layer: Layer;
  value: LayerMaskData | null;
  disabled: boolean;
  onAttempt(action: () => void): void;
  onPreview(value: LayerMaskData | null): void;
}) {
  const [sourceId, setSourceId] = useState("");
  const sources = allLayers(document.getSnapshot().document.children).filter(
    (node) =>
      node.kind === "vector" &&
      node.paths.length > 0 &&
      node.paths.every((path) => path.closed),
  );
  const currentSource = sources.some((node) => node.id === sourceId)
    ? sourceId
    : (sources[0]?.id ?? "");
  const commit = (
    patch: Partial<
      Pick<
        LayerMaskData,
        "enabled" | "inverted" | "density" | "feather" | "x" | "y"
      >
    >,
  ) => {
    onPreview(null);
    onAttempt(() => {
      if (layer.mask) layer.mask = layer.mask.with(patch);
    });
  };
  return (
    <InspectorSection title="Layer mask" ariaLabel="Layer mask">
      <Button
        disabled={disabled || !document.selection?.regions.length}
        variant="subtle"
        onClick={() =>
          onAttempt(() => layer.maskFromSelection(document.selection!))
        }
      >
        {value ? "Replace mask from selection" : "Mask from selection"}
      </Button>
      {sources.length > 0 && (
        <>
          <Select
            label="Mask path source"
            value={currentSource}
            disabled={disabled}
            options={sources.map((node) => ({
              value: node.id,
              label: node.name,
            }))}
            onChange={setSourceId}
          />
          <Button
            disabled={disabled || !currentSource}
            variant="subtle"
            onClick={() =>
              onAttempt(() => {
                const source = document.getLayer(currentSource);
                if (source instanceof VectorLayer) layer.maskFromPaths(source);
              })
            }
          >
            {value ? "Replace mask from paths" : "Mask from paths"}
          </Button>
          <p className="section-caption">
            Copies closed paths. Later source edits do not change the mask.
          </p>
        </>
      )}
      {!value && (
        <Button
          disabled={disabled}
          variant="subtle"
          onClick={() =>
            onAttempt(() => {
              layer.mask = new LayerMask({
                selection: new MarqueeSelection(),
                inverted: true,
              });
            })
          }
        >
          Add reveal-all mask
        </Button>
      )}
      {!value && (
        <>
          <Button
            disabled={disabled}
            variant="subtle"
            onClick={() =>
              onAttempt(() => {
                layer.mask = new LayerMask({ paths: [] });
              })
            }
          >
            Add Bézier mask
          </Button>
          <p className="section-caption">
            Starts empty. Draw its outline with Pen → Mask paths → New contour
            to reveal content.
          </p>
        </>
      )}
      {value?.kind !== "paint" && (
        <Button
          disabled={disabled}
          variant="subtle"
          onClick={() =>
            onAttempt(() => {
              layer.mask = new LayerMask({ base: 1 });
            })
          }
        >
          {value ? "Replace with painted mask" : "Add painted mask"}
        </Button>
      )}
      {value && (
        <>
          <p className="section-caption">
            {value.kind === "raster-erasures" ? "Raster erasure coverage" : value.kind === "vector"
              ? "Bézier path mask"
              : value.kind === "paint"
                ? "Painted mask"
                : "Selection mask"}
          </p>
          {value.kind === "vector" && (
            <Select
              label="Mask fill rule"
              value={value.fillRule}
              disabled={disabled}
              options={[
                { value: "evenodd", label: "Even-odd (nested holes)" },
                { value: "nonzero", label: "Nonzero winding" },
              ]}
              onChange={(fillRule) =>
                onAttempt(() => {
                  if (layer.mask)
                    layer.mask = layer.mask.with({
                      fillRule: fillRule as "evenodd" | "nonzero",
                    });
                })
              }
            />
          )}

          <p className="section-caption">
            Use Brush or Pencil to hide or reveal. Mask geometry stays editable.
          </p>
          <label className="check-field">
            <input
              type="checkbox"
              checked={value.linked ?? true}
              disabled={disabled}
              onChange={(event) => {
                onPreview(null);
                onAttempt(() => layer.setMaskLinked(event.target.checked));
              }}
            />
            Link mask to layer
          </label>
          <div className="field-grid">
            <NumberField
              label="Mask X"
              value={value.x ?? 0}
              min={-Number.MAX_SAFE_INTEGER}
              max={Number.MAX_SAFE_INTEGER}
              disabled={disabled}
              onCommit={(x) => commit({ x })}
            />
            <NumberField
              label="Mask Y"
              value={value.y ?? 0}
              min={-Number.MAX_SAFE_INTEGER}
              max={Number.MAX_SAFE_INTEGER}
              disabled={disabled}
              onCommit={(y) => commit({ y })}
            />
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={value.enabled}
              disabled={disabled}
              onChange={(event) => commit({ enabled: event.target.checked })}
            />
            Enable layer mask
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={value.inverted}
              disabled={disabled}
              onChange={(event) => commit({ inverted: event.target.checked })}
            />
            Invert layer mask
          </label>
          <Slider
            label="Mask density"
            value={value.density * 100}
            min={0}
            max={100}
            suffix="%"
            disabled={disabled}
            onPreview={(density) =>
              onPreview({ ...value, density: density / 100 })
            }
            onCommit={(density) => commit({ density: density / 100 })}
          />
          <Slider
            label="Mask feather"
            value={value.feather ?? 0}
            min={0}
            max={128}
            step={0.1}
            suffix="px"
            disabled={disabled}
            onPreview={(feather) => onPreview({ ...value, feather })}
            onCommit={(feather) => commit({ feather })}
          />
          <Button
            disabled={disabled}
            variant="subtle"
            onClick={() => {
              onPreview(null);
              onAttempt(() => {
                layer.mask = null;
              });
            }}
          >
            Remove layer mask
          </Button>
          <p className="section-caption">
            {value.linked === false
              ? "Mask stays fixed on the canvas."
              : "Mask moves with this layer."}{" "}
            Source pixels stay intact.
          </p>
        </>
      )}
    </InspectorSection>
  );
}
