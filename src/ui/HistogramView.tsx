import { useState } from "react";
import type { HistogramData } from "../core/histogram";

export type HistogramChannel = "rgb" | "red" | "green" | "blue" | "luminance";

export interface HistogramViewProps {
  histogram: HistogramData | null;
  channel?: HistogramChannel;
  compact?: boolean;
  height?: number;
  onChannelChange?(channel: HistogramChannel): void;
}

export function HistogramView({
  histogram,
  channel: controlledChannel,
  compact = false,
  height = 100,
  onChannelChange,
}: HistogramViewProps) {
  const [internalChannel, setInternalChannel] =
    useState<HistogramChannel>("rgb");
  const [hoverBin, setHoverBin] = useState<number | null>(null);

  const activeChannel = controlledChannel ?? internalChannel;

  const handleSelectChannel = (ch: HistogramChannel) => {
    setInternalChannel(ch);
    onChannelChange?.(ch);
  };

  const maxCount = histogram?.maxCount ?? 1;

  // Build SVG path data for a given 256-bin channel
  const buildPath = (
    bins: Uint32Array | undefined,
    baseline = height,
  ): string => {
    if (!bins || bins.length !== 256 || maxCount <= 0)
      return `M 0,${baseline} L 255,${baseline} Z`;
    const points: string[] = [`M 0,${baseline}`];
    for (let x = 0; x < 256; x++) {
      const normalized = Math.min(1, bins[x] / maxCount);
      const y = Math.round(baseline - normalized * (baseline - 2));
      points.push(`L ${x},${y}`);
    }
    points.push(`L 255,${baseline} Z`);
    return points.join(" ");
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * 256);
    if (x >= 0 && x < 256) {
      setHoverBin(x);
    }
  };

  const handleMouseLeave = () => {
    setHoverBin(null);
  };

  const redPath = buildPath(histogram?.red, height);
  const greenPath = buildPath(histogram?.green, height);
  const bluePath = buildPath(histogram?.blue, height);
  const lumPath = buildPath(histogram?.luminance, height);

  return (
    <div className="histogram-view">
      {!compact && (
        <div className="histogram-header">
          <div
            className="histogram-channel-selector"
            role="group"
            aria-label="Histogram channel"
          >
            {(
              [
                ["rgb", "RGB"],
                ["luminance", "Lum"],
                ["red", "R"],
                ["green", "G"],
                ["blue", "B"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`histogram-tab ${activeChannel === key ? "active" : ""}`}
                aria-pressed={activeChannel === key}
                onClick={() => handleSelectChannel(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {hoverBin !== null && histogram && (
            <div className="histogram-hover-info">
              <span>Level: {hoverBin}</span>
              <span className="text-muted">
                Count:{" "}
                {activeChannel === "red"
                  ? histogram.red[hoverBin]
                  : activeChannel === "green"
                    ? histogram.green[hoverBin]
                    : activeChannel === "blue"
                      ? histogram.blue[hoverBin]
                      : histogram.luminance[hoverBin]}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="histogram-graph-container" style={{ height }}>
        <svg
          className="histogram-svg"
          viewBox={`0 0 256 ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Tonal histogram graph"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Background grid */}
          <line
            x1="64"
            y1="0"
            x2="64"
            y2={height}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="2,2"
          />
          <line
            x1="128"
            y1="0"
            x2="128"
            y2={height}
            stroke="rgba(255,255,255,0.08)"
          />
          <line
            x1="192"
            y1="0"
            x2="192"
            y2={height}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="2,2"
          />

          {/* Histogram Paths */}
          {activeChannel === "rgb" && (
            <>
              <path
                d={lumPath}
                fill="rgba(255,255,255,0.15)"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="1"
              />
              <path
                d={redPath}
                fill="rgba(224, 93, 82, 0.25)"
                stroke="#e05d52"
                strokeWidth="1"
              />
              <path
                d={greenPath}
                fill="rgba(82, 183, 136, 0.25)"
                stroke="#52b788"
                strokeWidth="1"
              />
              <path
                d={bluePath}
                fill="rgba(87, 144, 200, 0.25)"
                stroke="#5790c8"
                strokeWidth="1"
              />
            </>
          )}

          {activeChannel === "luminance" && (
            <path
              d={lumPath}
              fill="rgba(213, 231, 155, 0.3)"
              stroke="#d5e79b"
              strokeWidth="1.5"
            />
          )}

          {activeChannel === "red" && (
            <path
              d={redPath}
              fill="rgba(224, 93, 82, 0.4)"
              stroke="#e05d52"
              strokeWidth="1.5"
            />
          )}

          {activeChannel === "green" && (
            <path
              d={greenPath}
              fill="rgba(82, 183, 136, 0.4)"
              stroke="#52b788"
              strokeWidth="1.5"
            />
          )}

          {activeChannel === "blue" && (
            <path
              d={bluePath}
              fill="rgba(87, 144, 200, 0.4)"
              stroke="#5790c8"
              strokeWidth="1.5"
            />
          )}

          {/* Hover cursor line */}
          {hoverBin !== null && (
            <line
              x1={hoverBin}
              y1="0"
              x2={hoverBin}
              y2={height}
              stroke="var(--color-accent, #d5e79b)"
              strokeWidth="1"
            />
          )}
        </svg>
      </div>

      {!compact && histogram && (
        <div className="histogram-stats">
          <div className="stat-item">
            <span className="stat-label">Mean</span>
            <span className="stat-value">{histogram.mean.toFixed(1)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Std Dev</span>
            <span className="stat-value">{histogram.stdDev.toFixed(1)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Median</span>
            <span className="stat-value">{histogram.median}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Range</span>
            <span className="stat-value">
              {histogram.min}–{histogram.max}
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Pixels</span>
            <span className="stat-value">
              {histogram.totalPixels.toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
