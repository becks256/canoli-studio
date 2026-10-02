import { RotateCcw } from "lucide-react";
import type { BlendChannel, BlendRange, LayerStyleData } from "../core/drawing";
import { defaultStyle } from "../core/drawing";
import { IconButton, Slider } from "./controls";
import { InspectorSection } from "./InspectorSection";

function RangeWindow({
  label,
  value,
  disabled,
  onPreview,
  onCommit,
}: {
  label: string;
  value: BlendRange;
  disabled: boolean;
  onPreview(value: BlendRange): void;
  onCommit(value: BlendRange): void;
}) {
  const names = [
    "Shadow cutoff",
    "Shadow feather",
    "Highlight feather",
    "Highlight cutoff",
  ];
  const update = (index: number, next: number): BlendRange => {
    const result: BlendRange = [...value];
    if (index === 0 && value[0] === value[1])
      result[0] = result[1] = Math.min(next, value[2]);
    else if (index === 3 && value[2] === value[3])
      result[2] = result[3] = Math.max(next, value[1]);
    else
      result[index] = Math.max(
        index > 0 ? value[index - 1] : 0,
        Math.min(index < 3 ? value[index + 1] : 255, next),
      );
    return result;
  };
  return (
    <div className="blend-range">
      <div className="blend-range-heading">
        <span>{label}</span>
        <output>{value.map(Math.round).join(" / ")}</output>
      </div>
      <div className="blend-track">
        {value.map((v, index) => (
          <input
            key={index}
            type="range"
            min={0}
            max={255}
            value={v}
            disabled={disabled}
            className={`blend-handle handle-${index}`}
            aria-label={`${label} ${names[index]}`}
            title={`${names[index]}: ${Math.round(v)}`}
            onChange={(event) =>
              onPreview(update(index, Number(event.target.value)))
            }
            onPointerUp={(event) =>
              onCommit(update(index, Number(event.currentTarget.value)))
            }
            onKeyUp={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                onCommit(update(index, Number(event.currentTarget.value)));
            }}
            onBlur={() => onCommit(value)}
          />
        ))}
      </div>
      <div className="blend-range-values">
        {value.map((v, index) => (
          <label key={index}>
            <span>{["Dark", "Fade in", "Fade out", "Light"][index]}</span>
            <input
              type="number"
              aria-label={`${label} ${names[index]} value`}
              min={0}
              max={255}
              value={v}
              disabled={disabled}
              onChange={(event) =>
                onPreview(update(index, Number(event.target.value)))
              }
              onBlur={(event) =>
                onCommit(update(index, Number(event.target.value)))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
export function LayerStylesPanel({
  value,
  disabled,
  onPreview,
  onCommit,
}: {
  value: LayerStyleData;
  disabled: boolean;
  onPreview(value: LayerStyleData): void;
  onCommit(value: LayerStyleData): void;
}) {
  const blend = value.blendIf;
  return (
    <>
      <InspectorSection
        title="Blend If"
        className="styles-section"
        actions={
          <IconButton
            label="Reset layer styles"
            disabled={disabled}
            onClick={() => onCommit(defaultStyle())}
          >
            <RotateCcw size={13} />
          </IconButton>
        }
      >
        <label className="check-field">
          <input
            type="checkbox"
            aria-label="Enable Blend If"
            checked={blend.enabled}
            disabled={disabled}
            onChange={(e) =>
              onCommit({
                ...value,
                blendIf: { ...blend, enabled: e.target.checked },
              })
            }
          />
          Blend by tonal range
        </label>
        <label className="field-label">
          Channel
          <select
            aria-label="Blend If channel"
            value={blend.channel}
            disabled={disabled || !blend.enabled}
            onChange={(e) =>
              onCommit({
                ...value,
                blendIf: { ...blend, channel: e.target.value as BlendChannel },
              })
            }
          >
            <option value="luminance">Luminance</option>
            <option value="red">Red</option>
            <option value="green">Green</option>
            <option value="blue">Blue</option>
          </select>
        </label>
        {(["source", "underlying"] as const).map((key) => (
          <RangeWindow
            key={key}
            label={key === "source" ? "This layer" : "Underlying layers"}
            value={blend[key]}
            disabled={disabled || !blend.enabled}
            onPreview={(range) =>
              onPreview({ ...value, blendIf: { ...blend, [key]: range } })
            }
            onCommit={(range) =>
              onCommit({ ...value, blendIf: { ...blend, [key]: range } })
            }
          />
        ))}
        <p className="section-description">
          Top handles set cutoffs. Lower handles feather the transition. Pixels
          outside the range become transparent.
        </p>
      </InspectorSection>
      <InspectorSection title="Color overlay">
        <div className="style-color-row">
          <label className="check-field">
            <input
              type="checkbox"
              aria-label="Enable color overlay"
              checked={value.colorOverlay.enabled}
              disabled={disabled}
              onChange={(e) =>
                onCommit({
                  ...value,
                  colorOverlay: {
                    ...value.colorOverlay,
                    enabled: e.target.checked,
                  },
                })
              }
            />
            Color overlay
          </label>
          <input
            type="color"
            aria-label="Overlay color"
            value={value.colorOverlay.color}
            disabled={disabled || !value.colorOverlay.enabled}
            onChange={(e) =>
              onCommit({
                ...value,
                colorOverlay: { ...value.colorOverlay, color: e.target.value },
              })
            }
          />
        </div>
        <Slider
          label="Overlay opacity"
          min={0}
          max={100}
          value={value.colorOverlay.opacity * 100}
          suffix="%"
          disabled={disabled || !value.colorOverlay.enabled}
          onPreview={(opacity) =>
            onPreview({
              ...value,
              colorOverlay: { ...value.colorOverlay, opacity: opacity / 100 },
            })
          }
          onCommit={(opacity) =>
            onCommit({
              ...value,
              colorOverlay: { ...value.colorOverlay, opacity: opacity / 100 },
            })
          }
        />
      </InspectorSection>
      <InspectorSection title="Drop shadow">
        <div className="style-color-row">
          <label className="check-field">
            <input
              type="checkbox"
              aria-label="Enable drop shadow"
              checked={value.dropShadow.enabled}
              disabled={disabled}
              onChange={(e) =>
                onCommit({
                  ...value,
                  dropShadow: {
                    ...value.dropShadow,
                    enabled: e.target.checked,
                  },
                })
              }
            />
            Drop shadow
          </label>
          <input
            type="color"
            aria-label="Shadow color"
            value={value.dropShadow.color}
            disabled={disabled || !value.dropShadow.enabled}
            onChange={(e) =>
              onCommit({
                ...value,
                dropShadow: { ...value.dropShadow, color: e.target.value },
              })
            }
          />
        </div>
        <div className="style-sliders">
          {(["x", "y", "blur"] as const).map((key) => (
            <Slider
              key={key}
              label={`Shadow ${key}`}
              min={key === "blur" ? 0 : -256}
              max={key === "blur" ? 128 : 256}
              value={value.dropShadow[key]}
              disabled={disabled || !value.dropShadow.enabled}
              onPreview={(next) =>
                onPreview({
                  ...value,
                  dropShadow: { ...value.dropShadow, [key]: next },
                })
              }
              suffix="px"
              onCommit={(next) =>
                onCommit({
                  ...value,
                  dropShadow: { ...value.dropShadow, [key]: next },
                })
              }
            />
          ))}
        </div>
        <Slider
          label="Shadow opacity"
          min={0}
          max={100}
          value={value.dropShadow.opacity * 100}
          suffix="%"
          disabled={disabled || !value.dropShadow.enabled}
          onPreview={(opacity) =>
            onPreview({
              ...value,
              dropShadow: { ...value.dropShadow, opacity: opacity / 100 },
            })
          }
          onCommit={(opacity) =>
            onCommit({
              ...value,
              dropShadow: { ...value.dropShadow, opacity: opacity / 100 },
            })
          }
        />
      </InspectorSection>
    </>
  );
}
