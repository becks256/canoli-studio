import { useState, useRef, useCallback } from "react";
import type { CurvePoint, CurvesAdjustmentData } from "../core/adjustments";
import {
  evaluateMonotoneCubicSpline,
  defaultCurvePoints,
} from "../core/adjustments";
import type { HistogramData } from "../core/histogram";
import { HistogramView } from "./HistogramView";
import { NumberField, IconButton } from "./controls";
import { RotateCcw, Trash2 } from "lucide-react";

export interface CurvesEditorProps {
  value: CurvesAdjustmentData;
  histogram?: HistogramData | null;
  disabled?: boolean;
  onPreview?(value: CurvesAdjustmentData): void;
  onCommit(value: CurvesAdjustmentData): void;
}

type CurveChannel = "rgb" | "red" | "green" | "blue";

export function CurvesEditor({
  value,
  histogram,
  disabled = false,
  onPreview,
  onCommit,
}: CurvesEditorProps) {
  const [activeChannel, setActiveChannel] = useState<CurveChannel>("rgb");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const getPointsForChannel = useCallback(
    (ch: CurveChannel): CurvePoint[] => {
      switch (ch) {
        case "rgb":
          return value.rgb;
        case "red":
          return value.red ?? defaultCurvePoints();
        case "green":
          return value.green ?? defaultCurvePoints();
        case "blue":
          return value.blue ?? defaultCurvePoints();
      }
    },
    [value],
  );

  const currentPoints = getPointsForChannel(activeChannel);

  const updateChannelPoints = useCallback(
    (ch: CurveChannel, points: CurvePoint[], commit: boolean) => {
      const updated: CurvesAdjustmentData = {
        ...value,
        [ch]: points,
      };
      if (commit) {
        onCommit(updated);
      } else {
        onPreview?.(updated);
      }
    },
    [value, onCommit, onPreview],
  );

  // Compute LUT for the active channel to draw the curve path
  const lut = evaluateMonotoneCubicSpline(currentPoints);

  // Build SVG path
  let pathD = `M 0,${255 - lut[0]}`;
  for (let x = 1; x < 256; x++) {
    pathD += ` L ${x},${255 - lut[x]}`;
  }

  // Pointer interaction for dragging / adding points
  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clickX = Math.round(
      Math.max(0, Math.min(255, ((e.clientX - rect.left) / rect.width) * 255)),
    );
    const clickY = Math.round(
      Math.max(
        0,
        Math.min(255, 255 - ((e.clientY - rect.top) / rect.height) * 255),
      ),
    );

    // Check if clicked close to an existing point (within 10 px radius)
    let hitIndex = -1;
    for (let i = 0; i < currentPoints.length; i++) {
      const p = currentPoints[i];
      const dx = Math.abs(p.x - clickX);
      const dy = Math.abs(p.y - clickY);
      if (dx <= 10 && dy <= 10) {
        hitIndex = i;
        break;
      }
    }

    if (hitIndex !== -1) {
      setSelectedIndex(hitIndex);
      setDraggingIndex(hitIndex);
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } else {
      // Add a new point if under limit of 32
      if (currentPoints.length < 32) {
        let insertIdx = 0;
        while (
          insertIdx < currentPoints.length &&
          currentPoints[insertIdx].x < clickX
        ) {
          insertIdx++;
        }
        // Ensure strictly increasing x
        const prevX = insertIdx > 0 ? currentPoints[insertIdx - 1].x : -1;
        const nextX =
          insertIdx < currentPoints.length ? currentPoints[insertIdx].x : 256;
        if (clickX > prevX && clickX < nextX) {
          const newPoints = [...currentPoints];
          newPoints.splice(insertIdx, 0, { x: clickX, y: clickY });
          setSelectedIndex(insertIdx);
          setDraggingIndex(insertIdx);
          updateChannelPoints(activeChannel, newPoints, true);
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingIndex === null || disabled || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    let x = Math.round(
      Math.max(0, Math.min(255, ((e.clientX - rect.left) / rect.width) * 255)),
    );
    const y = Math.round(
      Math.max(
        0,
        Math.min(255, 255 - ((e.clientY - rect.top) / rect.height) * 255),
      ),
    );

    const points = [...currentPoints];
    if (draggingIndex === 0) {
      x = 0; // First point locked to x = 0
    } else if (draggingIndex === points.length - 1) {
      x = 255; // Last point locked to x = 255
    } else {
      const minX = points[draggingIndex - 1].x + 1;
      const maxX = points[draggingIndex + 1].x - 1;
      x = Math.max(minX, Math.min(maxX, x));
    }

    points[draggingIndex] = { x, y };
    updateChannelPoints(activeChannel, points, false);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingIndex !== null) {
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        // Ignore pointer release errors
      }
      setDraggingIndex(null);
      updateChannelPoints(activeChannel, currentPoints, true);
    }
  };

  const handleDeleteSelected = () => {
    if (
      selectedIndex === null ||
      selectedIndex === 0 ||
      selectedIndex === currentPoints.length - 1 ||
      disabled
    ) {
      return;
    }
    const newPoints = currentPoints.filter((_, i) => i !== selectedIndex);
    setSelectedIndex(null);
    updateChannelPoints(activeChannel, newPoints, true);
  };

  const handleResetChannel = () => {
    if (disabled) return;
    updateChannelPoints(activeChannel, defaultCurvePoints(), true);
    setSelectedIndex(null);
  };

  const selectedPoint =
    selectedIndex !== null ? currentPoints[selectedIndex] : null;

  const channelColor =
    activeChannel === "red"
      ? "#e05d52"
      : activeChannel === "green"
        ? "#52b788"
        : activeChannel === "blue"
          ? "#5790c8"
          : "var(--color-accent, #d5e79b)";

  return (
    <div className="curves-editor">
      <div className="curves-header">
        <div
          className="curves-channel-selector"
          role="group"
          aria-label="Curves channel"
        >
          {(
            [
              ["rgb", "RGB"],
              ["red", "Red"],
              ["green", "Green"],
              ["blue", "Blue"],
            ] as const
          ).map(([ch, label]) => (
            <button
              key={ch}
              type="button"
              className={`curves-tab ${activeChannel === ch ? "active" : ""}`}
              aria-pressed={activeChannel === ch}
              disabled={disabled}
              onClick={() => {
                setActiveChannel(ch);
                setSelectedIndex(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <IconButton
          label={`Reset ${activeChannel} curve`}
          disabled={
            disabled ||
            (currentPoints.length === 2 &&
              currentPoints[0].y === 0 &&
              currentPoints[1].y === 255)
          }
          onClick={handleResetChannel}
        >
          <RotateCcw size={13} />
        </IconButton>
      </div>

      <div className="curves-graph-wrapper">
        {/* Background Histogram */}
        {histogram && (
          <div className="curves-histogram-backdrop">
            <HistogramView
              histogram={histogram}
              channel={activeChannel === "rgb" ? "luminance" : activeChannel}
              compact
              height={200}
            />
          </div>
        )}

        <svg
          ref={svgRef}
          className="curves-svg"
          viewBox="0 0 255 255"
          role="img"
          aria-label={`${activeChannel} curve graph`}
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Grid lines */}
          <line
            x1="64"
            y1="0"
            x2="64"
            y2="255"
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="3,3"
          />
          <line
            x1="128"
            y1="0"
            x2="128"
            y2="255"
            stroke="rgba(255,255,255,0.12)"
          />
          <line
            x1="192"
            y1="0"
            x2="192"
            y2="255"
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="3,3"
          />

          <line
            x1="0"
            y1="64"
            x2="255"
            y2="64"
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="3,3"
          />
          <line
            x1="0"
            y1="128"
            x2="255"
            y2="128"
            stroke="rgba(255,255,255,0.12)"
          />
          <line
            x1="0"
            y1="192"
            x2="255"
            y2="192"
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="3,3"
          />

          {/* Neutral diagonal */}
          <line
            x1="0"
            y1="255"
            x2="255"
            y2="0"
            stroke="rgba(255,255,255,0.15)"
            strokeDasharray="4,4"
          />

          {/* Spline curve */}
          <path
            d={pathD}
            fill="none"
            stroke={channelColor}
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Control point handles */}
          {currentPoints.map((point, index) => {
            const isSelected = selectedIndex === index;
            return (
              <g key={index}>
                <circle
                  cx={point.x}
                  cy={255 - point.y}
                  r={isSelected ? 6 : 4}
                  fill={isSelected ? "var(--color-accent, #d5e79b)" : "#181c1b"}
                  stroke={isSelected ? "#202d17" : channelColor}
                  strokeWidth="2"
                  className="curve-point"
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected Point Numeric Inputs */}
      {selectedPoint && (
        <div className="curves-point-controls">
          <div className="curves-inputs">
            <NumberField
              label="Input"
              value={selectedPoint.x}
              min={0}
              max={255}
              disabled={
                disabled ||
                selectedIndex === 0 ||
                selectedIndex === currentPoints.length - 1
              }
              onCommit={(val) => {
                if (
                  selectedIndex === null ||
                  selectedIndex === 0 ||
                  selectedIndex === currentPoints.length - 1
                )
                  return;
                const points = [...currentPoints];
                const minX = points[selectedIndex - 1].x + 1;
                const maxX = points[selectedIndex + 1].x - 1;
                points[selectedIndex] = {
                  ...points[selectedIndex],
                  x: Math.max(minX, Math.min(maxX, val)),
                };
                updateChannelPoints(activeChannel, points, true);
              }}
            />
            <NumberField
              label="Output"
              value={selectedPoint.y}
              min={0}
              max={255}
              disabled={disabled}
              onCommit={(val) => {
                if (selectedIndex === null) return;
                const points = [...currentPoints];
                points[selectedIndex] = {
                  ...points[selectedIndex],
                  y: Math.max(0, Math.min(255, val)),
                };
                updateChannelPoints(activeChannel, points, true);
              }}
            />
          </div>
          {selectedIndex !== 0 &&
            selectedIndex !== currentPoints.length - 1 && (
              <IconButton
                label="Delete point"
                disabled={disabled}
                onClick={handleDeleteSelected}
              >
                <Trash2 size={13} />
              </IconButton>
            )}
        </div>
      )}
    </div>
  );
}
