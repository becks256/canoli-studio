import { useState } from "react";
import { LayerComp, type Document } from "../dom";
import { allLayers } from "../core/model";
import type { LayerCompOptions } from "../core/layer-comps";
import { Button, TextInput } from "./controls";
import { InspectorSection } from "./InspectorSection";

export function LayerCompsPanel({
  document,
  disabled,
  onAttempt,
}: {
  document: Document;
  disabled: boolean;
  onAttempt(action: () => void): void;
}) {
  const [name, setName] = useState("Layout 1");
  const [options, setOptions] = useState<LayerCompOptions>({
    visibility: true,
    position: true,
    appearance: true,
  });
  const [message, setMessage] = useState("");
  const comps = document.layerComps.items;
  const ids = new Set(
    allLayers(document.getSnapshot().document.children).map(
      (layer) => layer.id,
    ),
  );
  return (
    <InspectorSection
      title="Layer comps"
      defaultCollapsed
      badge={comps.length}
      className="layer-comps-panel"
    >
      <div className="layer-comps-controls">
        <p className="layer-comps-hint">
          Save visibility, position and appearance for alternate layouts.
        </p>
        <TextInput
          label="New comp name"
          value={name}
          onChange={setName}
          disabled={disabled}
        />
        <fieldset className="layer-comps-categories" disabled={disabled}>
          <legend>Capture</legend>
          {(["visibility", "position", "appearance"] as const).map((key) => (
            <label className="checkbox-field" key={key}>
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(event) =>
                  setOptions({ ...options, [key]: event.target.checked })
                }
              />
              {key[0].toUpperCase() + key.slice(1)}
            </label>
          ))}
        </fieldset>
        <Button
          disabled={
            disabled || !name.trim() || !Object.values(options).some(Boolean)
          }
          onClick={() =>
            onAttempt(() => {
              document.layerComps.add(
                new LayerComp({ name: name.trim(), ...options }),
              );
              setMessage(`Captured ${name.trim()}.`);
              setName(`Layout ${comps.length + 2}`);
            })
          }
        >
          Capture layer comp
        </Button>
        {!comps.length && (
          <p className="layer-comps-hint">No saved comps yet.</p>
        )}
        {comps.map((comp) => {
          const missing = comp
            .toJSON()
            .layers.filter((layer) => !ids.has(layer.id)).length;
          return (
            <div
              className="layer-comp-entry"
              role="group"
              aria-label={`${comp.name} layer comp`}
              key={comp.id}
            >
              <TextInput
                label="Comp name"
                value={comp.name}
                disabled={disabled}
                onCommit={(name) =>
                  onAttempt(() => {
                    comp.name = name.trim();
                  })
                }
              />
              <p className="layer-comps-hint">
                {Object.entries(comp.options)
                  .filter(([, enabled]) => enabled)
                  .map(([key]) => key)
                  .join(" · ")}
              </p>
              {missing > 0 && (
                <p className="layer-comps-hint">
                  {missing} removed {missing === 1 ? "layer" : "layers"} will be
                  skipped.
                </p>
              )}
              <div className="layer-comp-actions">
                <Button
                  disabled={disabled}
                  onClick={() =>
                    onAttempt(() => {
                      const result = comp.apply();
                      setMessage(
                        `Applied ${comp.name}.${result.missingLayerIds.length ? ` Skipped ${result.missingLayerIds.length} removed layers.` : ""}`,
                      );
                    })
                  }
                >
                  Apply
                </Button>
                <Button
                  disabled={disabled}
                  title="Replace this comp with the current layout"
                  onClick={() =>
                    onAttempt(() => {
                      comp.recapture();
                      setMessage(`Updated ${comp.name}.`);
                    })
                  }
                >
                  Update
                </Button>
                <Button
                  disabled={disabled}
                  onClick={() =>
                    onAttempt(() => {
                      const name = comp.name;
                      comp.remove();
                      setMessage(`Removed ${name}.`);
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          );
        })}
        <div role="status" className="layer-comps-hint">
          {message}
        </div>
      </div>
    </InspectorSection>
  );
}
