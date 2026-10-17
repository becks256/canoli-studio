import type { WhiteBalanceAdjustmentData } from "../core/white-balance";
import { Slider } from "./controls";

export function WhiteBalanceControls({ adjustment, disabled, onPreview, onCommit }: {
  adjustment: WhiteBalanceAdjustmentData; disabled: boolean;
  onPreview(value: WhiteBalanceAdjustmentData): void;
  onCommit(value: WhiteBalanceAdjustmentData): void;
}) {
  return <>
    {(["temperature", "tint"] as const).map(key => <Slider key={key}
      label={key === "temperature" ? "Temperature" : "Tint"} value={adjustment[key]}
      min={key === "temperature" ? 2000 : -100} max={key === "temperature" ? 25000 : 100}
      step={1} suffix={key === "temperature" ? "K" : ""} disabled={disabled}
      onPreview={value => onPreview({ ...adjustment, [key]: value })}
      onCommit={value => onCommit({ ...adjustment, [key]: value })} />)}
    <p className="section-description">Higher temperature warms the correction; positive tint adds magenta. Neutral: 6504 K, tint 0.</p>
  </>;
}
