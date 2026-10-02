import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { DiffViewMode, ProtectedInvariantReport } from "../ai/diff/types";

export interface ResultDiffInspectorProps {
  referenceThumbnail?: string;
  referenceBuffer?: Uint8Array;
  candidateThumbnail?: string;
  afterLabel?: string;
  candidateBuffer?: Uint8Array;
  diffReport?: ProtectedInvariantReport;
  width?: number;
  height?: number;
  initialMode?: DiffViewMode;
  onModeChange?(mode: DiffViewMode): void;
  onOverrideChange?(override: boolean): void;
  overrideAllowed?: boolean;
  overrideChecked?: boolean;
}

export function ResultDiffInspector({
  referenceThumbnail,
  candidateThumbnail,
  afterLabel = "Candidate",
  diffReport,
  width = 512,
  height = 512,
  initialMode = "split",
  onModeChange,
  onOverrideChange,
  overrideAllowed = true,
  overrideChecked = false,
}: ResultDiffInspectorProps) {
  const [mode, setMode] = useState<DiffViewMode>(initialMode);
  const [splitPercent, setSplitPercent] = useState(50);
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null);

  // Sync mode changes with parent
  const handleModeSelect = (newMode: DiffViewMode) => {
    setMode(newMode);
    onModeChange?.(newMode);
  };

  // Draw heatmap buffer to canvas when diff mode is active
  useEffect(() => {
    if (!diffReport?.heatmapBuffer || !heatmapCanvasRef.current) return;
    const canvas = heatmapCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      const imgData = ctx.createImageData(width, height);
      imgData.data.set(diffReport.heatmapBuffer);
      ctx.putImageData(imgData, 0, 0);
    } catch {
      // Fallback
    }
  }, [diffReport, width, height, mode]);

  // Pointer drag handler for Split Wiper
  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateSplitFromPointer(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    updateSplitFromPointer(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const updateSplitFromPointer = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const clampedX = Math.max(0, Math.min(rect.width, relativeX));
    const percent = Math.round((clampedX / rect.width) * 100);
    setSplitPercent(percent);
  };

  // Keyboard navigation for split slider
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSplitPercent((p) => Math.max(0, p - (e.shiftKey ? 10 : 2)));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setSplitPercent((p) => Math.min(100, p + (e.shiftKey ? 10 : 2)));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSplitPercent(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setSplitPercent(100);
    }
  };

  const isPassed = diffReport?.passed ?? true;

  return (
    <div className="result-diff-inspector" ref={containerRef}>
      {/* Top Header & Invariant Scorecard */}
      <div className="diff-header-bar">
        <div className="diff-status-pill">
          {isPassed ? (
            <div
              className="status-badge passed"
              role="status"
              aria-label="Protected Invariant Verified"
            >
              <ShieldCheck size={16} />
              <span>Protected Invariant: Verified (Δ = 0)</span>
            </div>
          ) : (
            <div
              className="status-badge violation"
              role="alert"
              aria-label="Protected Invariant Violated"
            >
              <ShieldAlert size={16} />
              <span>
                Protected Invariant: VIOLATION (
                {diffReport?.violatedPixelCount ?? 0} pixels altered)
              </span>
            </div>
          )}
        </div>

        {/* View Mode Switcher */}
        <div
          className="diff-mode-tabs"
          role="tablist"
          aria-label="Diff view mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "split"}
            className={`mode-tab-btn ${mode === "split" ? "active" : ""}`}
            onClick={() => handleModeSelect("split")}
          >
            Split Wiper
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "diff"}
            className={`mode-tab-btn ${mode === "diff" ? "active" : ""}`}
            onClick={() => handleModeSelect("diff")}
          >
            Diff Heatmap
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "side-by-side"}
            className={`mode-tab-btn ${mode === "side-by-side" ? "active" : ""}`}
            onClick={() => handleModeSelect("side-by-side")}
          >
            Side by Side
          </button>
        </div>
      </div>

      {/* Main View Area */}
      <div
        className="diff-viewport-stage"
        onPointerDown={mode === "split" ? handlePointerDown : undefined}
        onPointerMove={mode === "split" ? handlePointerMove : undefined}
        onPointerUp={mode === "split" ? handlePointerUp : undefined}
        aria-label="Result diff visual inspection viewport"
      >
        {mode === "split" && (
          <div className="split-view-container">
            {/* After (Candidate) underneath */}
            <div className="split-layer after-layer">
              {candidateThumbnail ? (
                <img
                  src={candidateThumbnail}
                  alt={`${afterLabel} result (After)`}
                  className="split-img"
                />
              ) : (
                <div className="placeholder-diff-box">Candidate</div>
              )}
              <span className="split-tag after-tag">After</span>
            </div>

            {/* Before (Reference) clipped on top */}
            <div
              className="split-layer before-layer"
              style={{
                clipPath: `polygon(0% 0%, ${splitPercent}% 0%, ${splitPercent}% 100%, 0% 100%)`,
              }}
            >
              {referenceThumbnail ? (
                <img
                  src={referenceThumbnail}
                  alt="Reference source (Before)"
                  className="split-img"
                />
              ) : (
                <div className="placeholder-diff-box">Reference</div>
              )}
              <span className="split-tag before-tag">Before</span>
            </div>

            {/* Draggable Divider Handle */}
            <div
              className="split-divider-line"
              style={{ left: `${splitPercent}%` }}
              role="slider"
              tabIndex={0}
              onKeyDown={handleKeyDown}
              aria-valuenow={splitPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Before/After Split Wiper"
            >
              <div className="divider-handle">
                <SlidersHorizontal size={14} />
                <span className="divider-percent">{splitPercent}%</span>
              </div>
            </div>
          </div>
        )}

        {mode === "diff" && (
          <div className="diff-heatmap-container">
            {/* Underlay candidate */}
            {candidateThumbnail && (
              <img
                src={candidateThumbnail}
                alt="Candidate background"
                className="heatmap-underlay"
              />
            )}
            {/* Canvas heatmap */}
            <canvas
              ref={heatmapCanvasRef}
              width={width}
              height={height}
              className="diff-heatmap-canvas"
            />
            {/* Legend Overlay */}
            <div className="diff-legend-overlay">
              <div className="legend-item">
                <span className="legend-swatch edit-swatch" />
                <span>Generative Edit</span>
              </div>
              <div className="legend-item">
                <span className="legend-swatch violation-swatch" />
                <span>Protected Violation (Δ &gt; 0)</span>
              </div>
              <div className="legend-item">
                <span className="legend-swatch preserved-swatch" />
                <span>Preserved (Δ = 0)</span>
              </div>
            </div>
          </div>
        )}

        {mode === "side-by-side" && (
          <div className="side-by-side-container">
            <div className="side-pane before-pane">
              <div className="pane-header">Before (Reference)</div>
              {referenceThumbnail ? (
                <img
                  src={referenceThumbnail}
                  alt="Pre-edit reference"
                  className="pane-img"
                />
              ) : (
                <div className="placeholder-diff-box">Reference</div>
              )}
            </div>
            <div className="side-pane after-pane">
              <div className="pane-header">After ({afterLabel})</div>
              {candidateThumbnail ? (
                <img
                  src={candidateThumbnail}
                  alt={`Post-edit ${afterLabel.toLowerCase()}`}
                  className="pane-img"
                />
              ) : (
                <div className="placeholder-diff-box">Candidate</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quantitative Verification Scorecard */}
      {diffReport && (
        <div className="diff-scorecard-grid">
          <div className="score-item">
            <span className="score-label">Protected Area</span>
            <strong className="score-value">
              {diffReport.totalProtectedPixels.toLocaleString()} px
            </strong>
          </div>
          <div
            className={`score-item ${diffReport.violatedPixelCount > 0 ? "violation" : ""}`}
          >
            <span className="score-label">Violations (Δ &gt; 0)</span>
            <strong className="score-value">
              {diffReport.violatedPixelCount.toLocaleString()} px
            </strong>
          </div>
          <div
            className={`score-item ${diffReport.maxChannelDifference > 0 ? "violation" : ""}`}
          >
            <span className="score-label">Max Channel Δ</span>
            <strong className="score-value">
              {diffReport.maxChannelDifference} / 255
            </strong>
          </div>
          <div className="score-item">
            <span className="score-label">Preserved</span>
            <strong className="score-value">
              {diffReport.preservedPercentage.toFixed(1)}%
            </strong>
          </div>
          <div className="score-item">
            <span className="score-label">Edit Area MSE</span>
            <strong className="score-value">
              {diffReport.editRegionMeanSquaredError.toFixed(1)}
            </strong>
          </div>
        </div>
      )}

      {/* Invariant Violation Alert & Manual Override Checkbox */}
      {!isPassed && (
        <div className="diff-violation-alert" role="alert">
          <div className="alert-content">
            <AlertTriangle size={18} className="alert-icon" />
            <div className="alert-text">
              <strong>Protected Region Invariant Violated</strong>
              <p>
                {afterLabel} modified {diffReport?.violatedPixelCount} protected
                pixels outside the permitted writable region.
              </p>
              {overrideAllowed && onOverrideChange && (
                <label className="override-checkbox-label">
                  <input
                    type="checkbox"
                    checked={overrideChecked}
                    onChange={(e) => onOverrideChange(e.target.checked)}
                  />
                  <span>Acknowledge violation and authorize override</span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
