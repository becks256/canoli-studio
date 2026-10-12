import type { ExportControl, ExportProgress } from "../engine/export-control";
import { exportFontFamilies, fontAvailability } from "./font-availability";
import { useState, useMemo, useEffect, useRef } from "react";
import { Dialog } from "./Dialog";
import { Button, IconButton, Select, Slider, ColorField } from "./controls";
import { AlertTriangle, CheckCircle, Info, X } from "lucide-react";
import type { DocumentData } from "../core/model";
import type { ExportFormat, ExportOptions } from "../engine/export";
import { getExportCapabilityReport } from "../engine/export";

export interface ExportDialogProps {
  document: DocumentData;
  onExport(options: ExportOptions, control?: ExportControl): Promise<void>;
  onClose(): void;
  busy?: boolean;
}

export function ExportDialog({
  document,
  onExport,
  onClose,
  busy = false,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("png");
  const [quality, setQuality] = useState(90);
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const dismiss = () => { controller.current?.abort(); onClose(); };
  const fontKey = JSON.stringify(exportFontFamilies(document));
  const [fontReport, setFontReport] = useState<{
    key: string;
    warnings: string[];
  } | null>(null);
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    const changed = () => setFontRevision((value) => value + 1);
    globalThis.document.fonts?.addEventListener("loadingdone", changed);
    globalThis.document.fonts?.addEventListener("loadingerror", changed);
    return () => {
      globalThis.document.fonts?.removeEventListener("loadingdone", changed);
      globalThis.document.fonts?.removeEventListener("loadingerror", changed);
    };
  }, []);
  const reportKey = `${fontRevision}:${fontKey}`;
  const checkingFonts = fontReport?.key !== reportKey;
  useEffect(() => {
    let cancelled = false;
    const families = JSON.parse(fontKey) as string[];
    void Promise.all(
      families.map(async (family) => ({
        family,
        status: await fontAvailability(family),
      })),
    ).then((results) => {
      if (cancelled) return;
      setFontReport({
        key: reportKey,
        warnings: results
          .filter((item) => item.status !== "available")
          .map((item) =>
            item.status === "unavailable"
              ? `Font “${item.family}” could not be loaded locally; exported text may use a fallback.`
              : `Font availability could not be verified for “${item.family}”.`,
          ),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [fontKey, reportKey]);

  const report = useMemo(() => {
    return getExportCapabilityReport(document, {
      format,
      quality: quality / 100,
      backgroundColor,
    });
  }, [document, format, quality, backgroundColor]);

  const handleExport = async () => {
    const run = new AbortController();
    controller.current = run;
    setProgress(null);
    setExporting(true);
    try {
      await onExport({
        format,
        quality: quality / 100,
        backgroundColor,
      }, {signal:run.signal,onProgress:setProgress});
      if (!run.signal.aborted) onClose();
    } finally {
      controller.current = null;
      setExporting(false);
    }
  };

  const extension = format === "jpeg" ? "jpg" : format;

  return (
    <Dialog
      titleId="export-dialog-title"
      onClose={dismiss}
      className="export-dialog"
    >
      <div className="dialog-header">
        <h2 id="export-dialog-title">Export Document</h2>
        <IconButton
          label="Close"
          onClick={dismiss}
          disabled={busy && !exporting}
        >
          <X size={18} />
        </IconButton>
      </div>

      <div className="dialog-body export-dialog-body">
        <Select
          label="Format"
          layout="stacked"
          value={format}
          disabled={busy || exporting}
          options={[
            { value: "png", label: "PNG — Lossless raster with transparency" },
            {
              value: "jpeg",
              label: "JPEG — High compression photo (flattened background)",
            },
            { value: "webp", label: "WebP — Modern efficient web image" },
            { value: "svg", label: "SVG — Scalable Bézier vector paths" },
            {
              value: "psd",
              label:
                "PSD — Adobe Photoshop layered interchange with ICC profile",
            },
          ]}
          onChange={(val) => setFormat(val as ExportFormat)}
        />

        <div className="export-dimension-info">
          <span>
            Resolution: {document.width} × {document.height} px
          </span>
          <span>Target: .{extension}</span>
        </div>

        {format === "jpeg" && (
          <>
            <ColorField
              label="Background color (replaces alpha)"
              ariaLabel="JPEG background color"
              value={backgroundColor}
              disabled={busy || exporting}
              onChange={setBackgroundColor}
            />
            <Slider
              label="Quality"
              value={quality}
              min={1}
              max={100}
              suffix="%"
              disabled={busy || exporting}
              onPreview={setQuality}
              onCommit={setQuality}
            />
          </>
        )}

        {format === "webp" && (
          <Slider
            label="Quality"
            value={quality}
            min={1}
            max={100}
            suffix="%"
            disabled={busy || exporting}
            onPreview={setQuality}
            onCommit={setQuality}
          />
        )}

        {checkingFonts && <p role="status">Checking font availability…</p>}
        {!checkingFonts && fontReport.warnings.length > 0 && (
          <div className="export-warnings" role="alert">
            {fontReport.warnings.map((warning) => (
              <div className="export-warning-item" key={warning}>
                <AlertTriangle size={15} />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}
        {report.warnings.length > 0 && (
          <div className="export-warnings" role="alert">
            {report.warnings.map((warning, index) => (
              <div key={index} className="export-warning-item">
                <AlertTriangle size={15} className="export-warning-icon" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}

        <div className="export-capabilities-grid">
          <div>
            <strong className="export-capability-heading preserved">
              <CheckCircle size={13} /> Preserved Features
            </strong>
            <ul className="export-capability-list">
              {report.featuresPreserved.map((feature, i) => (
                <li key={i}>{feature}</li>
              ))}
            </ul>
          </div>
          <div>
            <strong className="export-capability-heading degraded">
              <Info size={13} /> Degraded / Omitted
            </strong>
            {report.featuresDegradedOrOmitted.length === 0 ? (
              <span className="export-capability-empty">None</span>
            ) : (
              <ul className="export-capability-list muted">
                {report.featuresDegradedOrOmitted.map((feature, i) => (
                  <li key={i}>{feature}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {exporting && <div className="export-progress" role="status" aria-live="polite">
        <span>{progress?.phase === 'encoding' ? 'Encoding file…' : 'Rendering image…'}</span>
        <progress aria-label="Export progress" max={1} value={progress?.fraction ?? undefined} />
      </div>}
      <div className="dialog-footer export-dialog-footer">
        <Button
          variant="secondary"
          onClick={() => exporting ? controller.current?.abort() : onClose()}
          disabled={busy && !exporting}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleExport}
          disabled={busy || exporting || checkingFonts}
        >
          {exporting ? "Exporting..." : `Export .${extension}`}
        </Button>
      </div>
    </Dialog>
  );
}
