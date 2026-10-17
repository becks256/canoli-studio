import type { GradientMapAdjustmentData, GradientStop } from "../core/gradient-map";
import { Button, NumberField } from "./controls";
import { ColorInput } from "./ColorInput";

export function GradientMapControls({ adjustment, disabled, onPreview, onCommit, onCancel }: {
  adjustment: GradientMapAdjustmentData;
  disabled: boolean;
  onPreview(value: GradientMapAdjustmentData): void;
  onCommit(value: GradientMapAdjustmentData): void;
  onCancel(): void;
}) {
  const { stops } = adjustment;
  const replace = (index: number, patch: Partial<GradientStop>) => ({
    ...adjustment, stops: stops.map((stop, i) => i === index ? { ...stop, ...patch } : stop),
  });
  const gaps = stops.slice(1).map((stop, i) => ({
    index: i, width: stop.position - stops[i].position,
    position: (stop.position + stops[i].position) / 2,
  })).filter(gap => gap.position > stops[gap.index].position && gap.position < stops[gap.index + 1].position);
  const gap = gaps.sort((a, b) => b.width - a.width)[0];
  return <div className="gradient-map-controls">
    <div className="gradient-map-ramp" role="img" aria-label="Gradient map colors from dark to light"
      style={{ background: `linear-gradient(to ${adjustment.reverse ? "left" : "right"}, ${stops.map(stop => `${stop.color} ${stop.position * 100}%`).join(", ")})` }} />
    <p className="section-description">Maps encoded RGB brightness to these colors. Positions run from dark (0%) to light (100%).</p>
    {stops.map((stop, index) => <div className="gradient-map-stop" key={index}>
      <ColorInput label={`Stop ${index + 1} color`} value={stop.color} disabled={disabled}
        onPreview={color => onPreview(replace(index, { color }))}
        onCommit={color => onCommit(replace(index, { color }))} onCancel={onCancel} />
      <NumberField label={`Stop ${index + 1} position`} value={stop.position * 100}
        min={index === 0 ? 0 : Math.min(stop.position * 100, stops[index - 1].position * 100 + Number.EPSILON * 100)}
        max={index === stops.length - 1 ? 100 : Math.max(stop.position * 100, stops[index + 1].position * 100 - Number.EPSILON * 100)} suffix="%"
        disabled={disabled} onCommit={position => onCommit({
          ...adjustment, stops: replace(index, { position: position / 100 }).stops.sort((a, b) => a.position - b.position),
        })} />
      <Button variant="subtle" aria-label={`Remove stop ${index + 1}`} disabled={disabled || stops.length <= 2}
        onClick={() => onCommit({ ...adjustment, stops: stops.filter((_, i) => i !== index) })}>×</Button>
    </div>)}
    <Button variant="subtle" disabled={disabled || stops.length >= 32 || !gap} onClick={() => {
      if (!gap) return;
      const left = stops[gap.index], right = stops[gap.index + 1];
      const color = "#" + [1, 3, 5].map(offset => Math.round((parseInt(left.color.slice(offset, offset + 2), 16) +
        parseInt(right.color.slice(offset, offset + 2), 16)) / 2).toString(16).padStart(2, "0")).join("");
      onCommit({ ...adjustment, stops: [...stops.slice(0, gap.index + 1), { position: gap.position, color }, ...stops.slice(gap.index + 1)] });
    }}>Add gradient stop</Button>
    <label className="context-check-field"><input type="checkbox" aria-label="Reverse gradient map"
      checked={adjustment.reverse} disabled={disabled}
      onChange={event => onCommit({ ...adjustment, reverse: event.target.checked })} /> Reverse brightness mapping</label>
  </div>;
}
