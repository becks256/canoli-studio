import type { RedEyeAdjustmentData } from "../core/red-eye";
import { Slider } from "./controls";

export function RedEyeControls({ adjustment, disabled, onPreview, onCommit }: {
  adjustment: RedEyeAdjustmentData; disabled: boolean;
  onPreview(value: RedEyeAdjustmentData): void;
  onCommit(value: RedEyeAdjustmentData): void;
}) {
  return <>
    <Slider label="Red excess threshold" value={adjustment.threshold} min={0} max={255} step={1}
      disabled={disabled} onPreview={threshold => onPreview({ ...adjustment, threshold })}
      onCommit={threshold => onCommit({ ...adjustment, threshold })} />
    <Slider label="Correction strength" value={adjustment.strength} min={0} max={100} step={1} suffix="%"
      disabled={disabled} onPreview={strength => onPreview({ ...adjustment, strength })}
      onCommit={strength => onCommit({ ...adjustment, strength })} />
    <p className="section-description">Use the mask to isolate pupils. Lower the threshold to include weaker red casts; raise it to protect other colors. This corrects red-dominant pixels and does not detect eyes.</p>
  </>;
}
