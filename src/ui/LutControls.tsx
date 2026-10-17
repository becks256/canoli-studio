import { useEffect, useRef, useState } from "react";
import { primeLutCache, type CubeLutData, type LutAdjustmentData, type LutInterpolation } from "../core/lut";
import { Button, Select, Slider } from "./controls";

export function LutControls({ adjustment, disabled, onPreview, onCommit }: {
  adjustment: LutAdjustmentData; disabled: boolean;
  onPreview(value: LutAdjustmentData): void; onCommit(value: LutAdjustmentData): void;
}) {
  const input = useRef<HTMLInputElement>(null), worker = useRef<Worker | null>(null), generation = useRef(0);
  const current = useRef({ adjustment, disabled }); current.current = { adjustment, disabled };
  const [working, setWorking] = useState(false), [error, setError] = useState("");
  useEffect(() => () => { generation.current++; worker.current?.terminate(); }, []);
  function run(payload: { file?: File; lut?: CubeLutData }) {
    worker.current?.terminate(); const id = ++generation.current, baseline = adjustment;
    setWorking(true); setError("");
    const parser = new Worker(new URL("../engine/lut-import.worker.ts", import.meta.url), { type: "module" });
    worker.current = parser;
    const finish = () => { parser.terminate(); if (id === generation.current) { worker.current = null; setWorking(false); } };
    parser.onerror = () => { if (id === generation.current) setError("LUT processing failed. Try again or choose a smaller table for this device."); finish(); };
    parser.onmessage = async event => {
      if (id !== generation.current) { parser.terminate(); return; }
      try {
        if (event.data.error) throw new Error(event.data.error);
        if (event.data.lut) {
          const lut = await primeLutCache(event.data.lut, () => id !== generation.current);
          if (id !== generation.current) return;
          if (current.current.disabled || current.current.adjustment !== baseline)
            throw new Error("The adjustment changed while importing. Import again to apply the table.");
          onCommit({ ...baseline, lut });
        } else if (typeof event.data.source === "string") {
          const url = URL.createObjectURL(new Blob([event.data.source], { type: "text/plain" })), link = document.createElement("a");
          link.href = url; link.download = `${baseline.lut.title.replace(/[^a-zA-Z0-9_-]/g, "_") || "lookup"}.cube`;
          link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } catch (value) { if (id === generation.current) setError(value instanceof Error ? value.message : String(value)); }
      finally { finish(); }
    };
    parser.postMessage(payload);
  }
  const locked = disabled || working, { lut } = adjustment;
  return <div className="lut-controls">
    <p className="section-description"><strong>{lut.title || "Untitled LUT"}</strong><br />
      {lut.dimension === 1 ? `1D · ${lut.size} samples per channel` : `3D · ${lut.size} × ${lut.size} × ${lut.size}`}</p>
    <input ref={input} type="file" accept=".cube,text/plain" aria-label="LUT file" hidden disabled={locked}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) run({ file }); }} />
    <div className="lut-file-actions">
      <Button variant="subtle" disabled={locked} onClick={() => input.current?.click()}>Import .cube</Button>
      <Button variant="subtle" disabled={locked} onClick={() => run({ lut })}>Export .cube</Button>
    </div>
    {working && <div role="status">Processing LUT… <Button variant="subtle" onClick={() => {
      generation.current++; worker.current?.terminate(); worker.current = null; setWorking(false);
    }}>Cancel LUT</Button></div>}
    {error && <p role="alert">{error}</p>}
    <Slider label="LUT amount" value={adjustment.amount} min={0} max={100} step={1} suffix="%" disabled={locked}
      onPreview={amount => onPreview({ ...adjustment, amount })} onCommit={amount => onCommit({ ...adjustment, amount })} />
    <Select label="3D interpolation" value={adjustment.interpolation} disabled={locked || lut.dimension === 1}
      options={[{ value: "tetrahedral", label: "Tetrahedral" }, { value: "trilinear", label: "Trilinear" }]}
      onChange={interpolation => onCommit({ ...adjustment, interpolation: interpolation as LutInterpolation })} />
    <p className="section-description">1D tables use linear interpolation. Choose an sRGB look for rendered images; camera-log LUTs need their matching source encoding. Export .cube saves the table; amount and masks stay in the project.</p>
  </div>;
}
