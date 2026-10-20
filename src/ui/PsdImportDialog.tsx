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
import type {PhotoshopInspection,PhotoshopImportProgress} from '../core/photoshop-import';

function PsdMessages({items,className,label}:{items:string[];className:string;label:string}){
 const [page,setPage]=useState(0);
 return <><ul className={className}>{items.slice(page*100,(page+1)*100).map((value,index)=><li key={index}>{value}</li>)}</ul>{items.length>100&&<div><p>{label} {page*100+1}–{Math.min(items.length,(page+1)*100)} of {items.length}</p><Button disabled={page===0} onClick={()=>setPage(value=>value-1)}>Previous {label.toLowerCase()}</Button><Button disabled={(page+1)*100>=items.length} onClick={()=>setPage(value=>value+1)}>Next {label.toLowerCase()}</Button></div>}</>;
}

export interface PsdImportDialogProps {
  fileName: string;
  parsedPsd: Pick<PsdParsedDocument,'header'|'resolution'|'layers'>|PhotoshopInspection;
  report: PsdCapabilityReport;
  onImportLayers(): void;
  onImportFlattened(): void;
  onClose(): void;
  busy?: boolean;
  progress?:PhotoshopImportProgress|null;
  error?:string;
}

export function PsdImportDialog({
  fileName,
  parsedPsd,
  report,
  onImportLayers,
  onImportFlattened,
  onClose,
  busy = false,
  progress=null,error='',
}: PsdImportDialogProps) {
  const [selectedMode, setSelectedMode] = useState<"layered" | "flatten">(
    report.canImportAsLayers ? "layered" : "flatten",
  );

  const { header, layers, resolution } = parsedPsd;
  const [layerPage,setLayerPage]=useState(0);

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
          Import {header.version===2?'PSB':'PSD'} — Preflight Inspection
        </h2>
        <IconButton label="Close" onClick={onClose}>
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
            <PsdMessages items={report.warnings} className="psd-warnings-list" label="Warnings"/>
          </div>
        )}

        {/* Capabilities Scorecard */}
        <div className="psd-capabilities-grid">
          <div className="psd-cap-col">
            <h4 className="psd-cap-heading preserved">
              <CheckCircle size={13} /> Preserved Features
            </h4>
            <PsdMessages items={report.supportedConstructs} className="psd-cap-list" label="Reported features"/>
          </div>

          <div className="psd-cap-col">
            <h4 className="psd-cap-heading degraded">
              <AlertTriangle size={13} /> Degraded / Omitted
            </h4>
            {report.degradedFeatures.length === 0 ? (
              <span className="psd-cap-empty">No additional reported losses in this supported subset</span>
            ) : (
              <PsdMessages items={report.degradedFeatures} className="psd-cap-list muted" label="Reported losses"/>
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
              {layers.slice(layerPage*100,(layerPage+1)*100).map((l, i) => (
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
            {layers.length>100&&<div><p>Layer records {layerPage*100+1}–{Math.min(layers.length,(layerPage+1)*100)} of {layers.length}</p><Button disabled={layerPage===0||busy} onClick={()=>setLayerPage(value=>value-1)}>Previous layer records</Button><Button disabled={(layerPage+1)*100>=layers.length||busy} onClick={()=>setLayerPage(value=>value+1)}>Next layer records</Button></div>}
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
              disabled={busy||!report.hasComposite}
            />
            <span>
              <strong>Flatten to Single Composite</strong> — Import the
              pre-rendered merged pixels; the reported color limits still apply.
            </span>
          </label>
        </div>
      </div>

      {busy&&<div role="status"><p>{progress?.phase==='encoding'?'Preparing editing pixels…':progress?.phase==='installing'?'Opening image sources…':'Decoding Photoshop pixels…'}</p><progress aria-label="Photoshop import progress" max={1} value={progress?.fraction??undefined}/></div>}
      {error&&<p role="alert">{error}</p>}

      <div className="dialog-footer psd-import-dialog-footer">
        <Button variant="secondary" onClick={onClose}>
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
          disabled={busy||(selectedMode==='flatten'?!report.hasComposite:!report.canImportAsLayers)}
        >
          {selectedMode === "layered" ? "Import Layers" : "Import Flattened"}
        </Button>
      </div>
    </Dialog>
  );
}
