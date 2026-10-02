/**
 * Preflight inspection and import dialog for PSD files (F11).
 */

import { useState } from "react";
import { Dialog } from "./Dialog";
import { Button, IconButton } from "./controls";
import { AlertTriangle, CheckCircle, FileCode, Layers, X } from "lucide-react";
import type {
  PsdParsedDocument,
  PsdCapabilityReport,
} from "../core/interchange/psd/types";

export interface PsdImportDialogProps {
  fileName: string;
  parsedPsd: PsdParsedDocument;
  report: PsdCapabilityReport;
  onImportLayers(): void;
  onImportFlattened(): void;
  onClose(): void;
  busy?: boolean;
}

export function PsdImportDialog({
  fileName,
  parsedPsd,
  report,
  onImportLayers,
  onImportFlattened,
  onClose,
  busy = false,
}: PsdImportDialogProps) {
  const [selectedMode, setSelectedMode] = useState<"layered" | "flatten">(
    report.canImportAsLayers ? "layered" : "flatten",
  );

  const { header, layers, resolution } = parsedPsd;

  return (
    <Dialog
      titleId="psd-import-dialog-title"
      onClose={onClose}
      className="psd-import-dialog"
    >
      <div className="dialog-header">
        <h2 id="psd-import-dialog-title">
          <FileCode
            size={18}
            style={{ marginRight: 8, verticalAlign: "middle" }}
          />
          Import PSD — Preflight Inspection
        </h2>
        <IconButton label="Close" onClick={onClose} disabled={busy}>
          <X size={18} />
        </IconButton>
      </div>

      <div className="dialog-body psd-import-dialog-body">
        {/* Document Overview Metadata */}
        <div className="psd-meta-card">
          <div className="psd-meta-header">
            <strong>{fileName}</strong>
            <span className="psd-dimensions-badge">
              {header.width} × {header.height} px
            </span>
          </div>

          <div className="psd-meta-grid">
            <div className="psd-meta-item">
              <span className="psd-meta-label">Color Mode:</span>
              <span className="psd-meta-value">{report.colorMode}</span>
            </div>
            <div className="psd-meta-item">
              <span className="psd-meta-label">Bit Depth:</span>
              <span className="psd-meta-value">
                {header.depth}-bit per channel
              </span>
            </div>
            <div className="psd-meta-item">
              <span className="psd-meta-label">Channels:</span>
              <span className="psd-meta-value">{header.channels} channels</span>
            </div>
            <div className="psd-meta-item">
              <span className="psd-meta-label">Layer Count:</span>
              <span className="psd-meta-value">{report.layerCount} layers</span>
            </div>
            <div className="psd-meta-item">
              <span className="psd-meta-label">Resolution:</span>
              <span className="psd-meta-value">
                {resolution ? `${Math.round(resolution.hRes)} DPI` : "72 DPI"}
              </span>
            </div>
            <div className="psd-meta-item">
              <span className="psd-meta-label">ICC Profile:</span>
              <span className="psd-meta-value">
                {report.hasIccProfile ? "Embedded" : "None (sRGB default)"}
              </span>
            </div>
          </div>
        </div>

        {/* Warnings & Degraded Features */}
        {report.warnings.length > 0 && (
          <div className="psd-warnings-box" role="alert">
            <div className="psd-warnings-title">
              <AlertTriangle size={15} /> Format Warnings & Degradation Notice
            </div>
            <ul className="psd-warnings-list">
              {report.warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Capabilities Scorecard */}
        <div className="psd-capabilities-grid">
          <div className="psd-cap-col">
            <h4 className="psd-cap-heading preserved">
              <CheckCircle size={13} /> Preserved Features
            </h4>
            <ul className="psd-cap-list">
              {report.supportedConstructs.map((c, idx) => (
                <li key={idx}>{c}</li>
              ))}
            </ul>
          </div>

          <div className="psd-cap-col">
            <h4 className="psd-cap-heading degraded">
              <AlertTriangle size={13} /> Degraded / Omitted
            </h4>
            {report.degradedFeatures.length === 0 ? (
              <span className="psd-cap-empty">None — full fidelity import</span>
            ) : (
              <ul className="psd-cap-list muted">
                {report.degradedFeatures.map((d, idx) => (
                  <li key={idx}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Layer Tree Preview */}
        {layers.length > 0 && (
          <div className="psd-layers-preview-box">
            <h4 className="psd-layers-preview-title">
              <Layers size={14} /> Layer Records ({layers.length})
            </h4>
            <div className="psd-layers-list">
              {layers.map((l, i) => (
                <div key={i} className="psd-layer-row">
                  <span className="psd-layer-name">{l.name}</span>
                  <div className="psd-layer-badges">
                    <span className="psd-badge">
                      {l.width}×{l.height}
                    </span>
                    <span className="psd-badge blend">
                      {l.blendModeKey || "norm"}
                    </span>
                    <span className="psd-badge">
                      {Math.round((l.opacity / 255) * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Import Mode Selection */}
        <div className="psd-mode-selection">
          <label className="radio-label">
            <input
              type="radio"
              name="psdImportMode"
              value="layered"
              checked={selectedMode === "layered"}
              onChange={() => setSelectedMode("layered")}
              disabled={busy || !report.canImportAsLayers}
            />
            <span>
              <strong>Import as Separate Layers</strong> — Reconstruct raster
              layers, opacity, positions, and blend modes.
            </span>
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="psdImportMode"
              value="flatten"
              checked={selectedMode === "flatten"}
              onChange={() => setSelectedMode("flatten")}
              disabled={busy}
            />
            <span>
              <strong>Flatten to Single Composite</strong> — Safe fallback
              importing the pre-rendered full composite.
            </span>
          </label>
        </div>
      </div>

      <div className="dialog-footer psd-import-dialog-footer">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            if (selectedMode === "layered") {
              onImportLayers();
            } else {
              onImportFlattened();
            }
          }}
          disabled={busy}
        >
          {selectedMode === "layered" ? "Import Layers" : "Import Flattened"}
        </Button>
      </div>
    </Dialog>
  );
}
