import { useEffect, useRef } from "react";
import { LayerMask, type Document, type SmartObjectLayer } from "../dom";
import type { LayerMaskData } from "../core/masks";
import type { EditorCommand } from "../core/commands";
import { Button, Slider } from "./controls";
import { InspectorSection } from "./InspectorSection";

export function SmartFilterMaskPanel({
  document,
  layer,
  value,
  disabled,
  onPreview,
  onAttempt,
}: {
  document: Document;
  layer: SmartObjectLayer;
  value: LayerMaskData | null;
  disabled: boolean;
  onPreview(command: EditorCommand | null): void;
  onAttempt(action: () => void): void;
}) {
  const revision = document.getSnapshot().revision;
  const previewRevision = useRef<number | null>(null);
  const cancel = useRef(onPreview);
  cancel.current = onPreview;
  useEffect(() => () => cancel.current(null), [document, layer.id, revision]);
  const available = () =>
    !disabled &&
    layer.isAttached &&
    document.selectedLayer?.id === layer.id &&
    document.getSnapshot().revision === revision;
  const preview = (mask: LayerMaskData) => {
    if (
      !available() ||
      (previewRevision.current !== null && previewRevision.current !== revision)
    ) {
      onPreview(null);
      return;
    }
    const unchanged =
      JSON.stringify(mask) === JSON.stringify(layer.filterMask?.toJSON());
    previewRevision.current = unchanged
      ? null
      : (previewRevision.current ?? revision);
    onPreview(
      unchanged ? null : { type: "smartObject.filterMask", id: layer.id, mask },
    );
  };
  const commit = (mask: LayerMask | null) => {
    const expected = previewRevision.current ?? revision;
    previewRevision.current = null;
    onPreview(null);
    onAttempt(() => {
      if (!available() || expected !== revision)
        throw new Error(
          "The filter-mask target changed. Review the selected layer and retry.",
        );
      if (
        JSON.stringify(mask?.toJSON() ?? null) !==
        JSON.stringify(layer.filterMask?.toJSON() ?? null)
      )
        layer.filterMask = mask;
    });
  };
  const update = (
    patch: Partial<
      Pick<LayerMaskData, "enabled" | "inverted" | "density" | "feather">
    >,
  ) => {
    if (value) commit(LayerMask._fromJSON({ ...value, ...patch }));
  };
  return (
    <InspectorSection title="Filter mask" ariaLabel="Filter mask">
      <p className="section-description">
        White applies the filters; black reveals the original artwork.
      </p>
      <div className="smart-filter-add">
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => commit(new LayerMask({ base: 1 }))}
        >
          Reveal all filters
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => commit(new LayerMask({ base: 0 }))}
        >
          Hide all filters
        </Button>
      </div>
      <Button
        size="sm"
        variant="subtle"
        disabled={disabled || !document.selection?.regions.length}
        onClick={() =>
          commit(
            new LayerMask({ selection: document.selection!, linked: false }),
          )
        }
      >
        {value
          ? "Replace filter mask from selection"
          : "Filter mask from selection"}
      </Button>
      {value && (
        <>
          <p className="section-description">
            {value.linked === false
              ? "Mask stays fixed on the canvas."
              : "Mask follows the original artwork."}
          </p>
          <label className="check-field">
            <input
              type="checkbox"
              aria-label="Link filter mask to artwork"
              checked={value.linked !== false}
              disabled={disabled}
              onChange={(event) => {
                const expected = previewRevision.current ?? revision;
                previewRevision.current = null;
                onPreview(null);
                const linked = event.target.checked;
                onAttempt(() => {
                  if (!available() || expected !== revision)
                    throw new Error(
                      "The filter-mask target changed. Review the selected layer and retry.",
                    );
                  layer.setFilterMaskLinked(linked);
                });
              }}
            />
            Follow artwork
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              aria-label="Enable filter mask"
              checked={value.enabled}
              disabled={disabled}
              onChange={(event) => update({ enabled: event.target.checked })}
            />
            Enabled
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              aria-label="Invert filter mask"
              checked={value.inverted}
              disabled={disabled}
              onChange={(event) => update({ inverted: event.target.checked })}
            />
            Invert
          </label>
          <Slider
            label="Filter mask density"
            value={value.density * 100}
            min={0}
            max={100}
            step={1}
            suffix="%"
            disabled={disabled || !value.enabled}
            onPreview={(density) =>
              preview({ ...value, density: density / 100 })
            }
            onCommit={(density) => update({ density: density / 100 })}
          />
          <Slider
            label="Filter mask feather"
            value={value.feather ?? 0}
            min={0}
            max={128}
            step={0.5}
            suffix="px"
            disabled={disabled || !value.enabled}
            onPreview={(feather) => preview({ ...value, feather })}
            onCommit={(feather) => update({ feather })}
          />
          <Button
            size="sm"
            variant="subtle"
            disabled={disabled}
            onClick={() => commit(null)}
          >
            Remove filter mask
          </Button>
        </>
      )}
    </InspectorSection>
  );
}
