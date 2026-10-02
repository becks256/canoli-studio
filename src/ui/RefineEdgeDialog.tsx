/**
 * Refine Edge / Matting Dialog (T19 / A04).
 * Provides interactive edge refinement preview with 5 view modes,
 * mathematical local KNN alpha matting, and color decontamination.
 */

import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { Button, IconButton, Select } from "./controls";
import { Eye, Sparkles, X } from "lucide-react";
import type { EditorApplication } from "../editor";
import { RasterLayer } from "../dom";
import type {
  MattingViewMode,
  RefineEdgeOptions,
} from "../intelligence/matting/types";
import {
  detectSalientSubject,
  generateTrimapFromMask,
  erodeMask,
  dilateMask,
} from "../intelligence/matting/segmentation";
import {
  solveAlphaMatte,
  decontaminateColors,
} from "../intelligence/matting/engine";
import { rasterizeSelection } from "../ai/diff/engine";
import { createCanvas, release } from "../engine/canvas";

export interface RefineEdgeDialogProps {
  editor: EditorApplication;
  onClose(): void;
  onApply(options: RefineEdgeOptions): void;
}

export function RefineEdgeDialog({
  editor,
  onClose,
  onApply,
}: RefineEdgeDialogProps) {
  const selected = editor.document.selectedLayer;
  const isRaster = selected instanceof RasterLayer;

  const [viewMode, setViewMode] = useState<MattingViewMode>("overlay");
  const [radius, setRadius] = useState<number>(10);
  const [smooth, setSmooth] = useState<number>(10);
  const [feather, setFeather] = useState<number>(0);
  const [contrast, setContrast] = useState<number>(0);
  const [shiftEdge, setShiftEdge] = useState<number>(0);
  const [decontaminate, setDecontaminate] = useState<boolean>(false);
  const [decontaminateAmount, setDecontaminateAmount] = useState<number>(100);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageRef = useRef<ImageData | null>(null);
  const initialMaskRef = useRef<Uint8Array | null>(null);

  // Initialize source image data and initial mask on mount
  useEffect(() => {
    if (!isRaster || !selected) return;

    try {
      const asset = editor.assetStore.get(selected.assetId);
      const canvas = createCanvas(asset.width, asset.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(asset.bitmap, 0, 0);
      const imgData = ctx.getImageData(0, 0, asset.width, asset.height);
      release(canvas);
      sourceImageRef.current = imgData;

      // Extract initial mask
      if (editor.document.selection) {
        const selData = editor.document.selection
          .translated(-selected.x, -selected.y)
          .toJSON();
        initialMaskRef.current = rasterizeSelection(
          selData,
          asset.width,
          asset.height,
        );
      } else {
        const seg = detectSalientSubject(imgData);
        initialMaskRef.current = seg.mask;
      }
    } catch (err) {
      console.error("Failed to load source layer image:", err);
    }
  }, [editor, selected, isRaster]);

  // Re-render preview whenever parameters or viewMode change
  useEffect(() => {
    const imgData = sourceImageRef.current;
    const initMask = initialMaskRef.current;
    const canvas = canvasRef.current;
    if (!imgData || !initMask || !canvas) return;

    setIsProcessing(true);

    try {
      // 1. Shift edge if requested
      let workingMask = initMask;
      if (shiftEdge > 0) {
        workingMask = dilateMask(
          initMask,
          imgData.width,
          imgData.height,
          Math.round(shiftEdge / 10),
        );
      } else if (shiftEdge < 0) {
        workingMask = erodeMask(
          initMask,
          imgData.width,
          imgData.height,
          Math.round(-shiftEdge / 10),
        );
      }

      // 2. Generate trimap
      const trimap = generateTrimapFromMask(
        workingMask,
        imgData.width,
        imgData.height,
        radius,
      );

      // 3. Solve alpha matte
      const matte = solveAlphaMatte(imgData, trimap, {
        radius,
        smooth,
        feather,
        contrast,
        shiftEdge,
      });

      // 4. Optionally decontaminate colors
      let previewRgba: Uint8Array | Uint8ClampedArray = imgData.data;
      if (decontaminate) {
        previewRgba = decontaminateColors(
          imgData,
          matte.alpha,
          decontaminateAmount / 100,
        );
      }

      // 5. Render onto preview canvas
      canvas.width = imgData.width;
      canvas.height = imgData.height;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const previewImg = ctx.createImageData(canvas.width, canvas.height);
      const out = previewImg.data;
      const numPixels = canvas.width * canvas.height;

      if (viewMode === "marching-ants") {
        // Black and white silhouette
        for (let i = 0; i < numPixels; i++) {
          const a = matte.alpha[i];
          out[i * 4] = a;
          out[i * 4 + 1] = a;
          out[i * 4 + 2] = a;
          out[i * 4 + 3] = 255;
        }
      } else if (viewMode === "overlay") {
        // Ruby overlay on masked regions
        for (let i = 0; i < numPixels; i++) {
          const a = matte.alpha[i] / 255;
          const r = previewRgba[i * 4];
          const g = previewRgba[i * 4 + 1];
          const b = previewRgba[i * 4 + 2];
          // Tint non-foreground red
          const bgWeight = (1 - a) * 0.6;
          out[i * 4] = Math.round(r * a + 255 * bgWeight);
          out[i * 4 + 1] = Math.round(g * a);
          out[i * 4 + 2] = Math.round(b * a);
          out[i * 4 + 3] = 255;
        }
      } else if (viewMode === "on-black") {
        for (let i = 0; i < numPixels; i++) {
          const a = matte.alpha[i] / 255;
          out[i * 4] = Math.round(previewRgba[i * 4] * a);
          out[i * 4 + 1] = Math.round(previewRgba[i * 4 + 1] * a);
          out[i * 4 + 2] = Math.round(previewRgba[i * 4 + 2] * a);
          out[i * 4 + 3] = 255;
        }
      } else if (viewMode === "on-white") {
        for (let i = 0; i < numPixels; i++) {
          const a = matte.alpha[i] / 255;
          const bg = (1 - a) * 255;
          out[i * 4] = Math.round(previewRgba[i * 4] * a + bg);
          out[i * 4 + 1] = Math.round(previewRgba[i * 4 + 1] * a + bg);
          out[i * 4 + 2] = Math.round(previewRgba[i * 4 + 2] * a + bg);
          out[i * 4 + 3] = 255;
        }
      } else {
        // on-transparency
        for (let i = 0; i < numPixels; i++) {
          const a = matte.alpha[i];
          out[i * 4] = previewRgba[i * 4];
          out[i * 4 + 1] = previewRgba[i * 4 + 1];
          out[i * 4 + 2] = previewRgba[i * 4 + 2];
          out[i * 4 + 3] = a;
        }
      }

      ctx.putImageData(previewImg, 0, 0);
    } finally {
      setIsProcessing(false);
    }
  }, [
    viewMode,
    radius,
    smooth,
    feather,
    contrast,
    shiftEdge,
    decontaminate,
    decontaminateAmount,
  ]);

  const handleApply = () => {
    onApply({
      radius,
      smooth,
      feather,
      contrast,
      shiftEdge,
      viewMode,
      decontaminate,
      decontaminateAmount: decontaminate ? decontaminateAmount / 100 : 0,
    });
    onClose();
  };

  return (
    <Dialog
      titleId="refine-edge-title"
      className="refine-edge-dialog"
      onClose={onClose}
    >
      <div className="refine-edge-header">
        <div className="refine-edge-title-row">
          <Sparkles size={18} className="text-accent" />
          <h2 id="refine-edge-title">Refine Edge / Matting</h2>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      {!isRaster ? (
        <div className="refine-edge-error">
          <p>Please select a raster layer in the document to refine edges.</p>
          <div className="refine-edge-actions">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="refine-edge-body">
          {/* Canvas Preview Area */}
          <div
            className={`refine-edge-canvas-container ${viewMode === "on-transparency" ? "checkerboard-bg" : ""}`}
          >
            <canvas
              ref={canvasRef}
              data-testid="refine-edge-preview-canvas"
              className="refine-edge-preview-canvas"
            />
            {isProcessing && (
              <div className="refine-edge-processing-indicator">
                <span>Refining matte...</span>
              </div>
            )}
          </div>

          {/* Controls Sidebar */}
          <div className="refine-edge-controls">
            {/* View Mode */}
            <div className="refine-edge-group">
              <label className="refine-edge-label">
                <Eye size={14} />
                <span>View Mode</span>
              </label>
              <Select
                label="View Mode"
                hideLabel
                value={viewMode}
                options={[
                  { value: "overlay", label: "Overlay / Ruby" },
                  { value: "on-black", label: "On Black" },
                  { value: "on-white", label: "On White" },
                  { value: "on-transparency", label: "On Transparency" },
                  { value: "marching-ants", label: "Black & White" },
                ]}
                onChange={(val) => setViewMode(val as MattingViewMode)}
              />
            </div>

            {/* Edge Detection */}
            <div className="refine-edge-group">
              <div className="refine-edge-group-title">Edge Detection</div>
              <div className="refine-edge-slider-row">
                <label htmlFor="refine-radius">Radius ({radius} px)</label>
                <input
                  id="refine-radius"
                  type="range"
                  min="1"
                  max="50"
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Adjust Edge */}
            <div className="refine-edge-group">
              <div className="refine-edge-group-title">Adjust Edge</div>
              <div className="refine-edge-slider-row">
                <label htmlFor="refine-smooth">Smooth ({smooth})</label>
                <input
                  id="refine-smooth"
                  type="range"
                  min="0"
                  max="100"
                  value={smooth}
                  onChange={(e) => setSmooth(Number(e.target.value))}
                />
              </div>
              <div className="refine-edge-slider-row">
                <label htmlFor="refine-feather">Feather ({feather} px)</label>
                <input
                  id="refine-feather"
                  type="range"
                  min="0"
                  max="50"
                  value={feather}
                  onChange={(e) => setFeather(Number(e.target.value))}
                />
              </div>
              <div className="refine-edge-slider-row">
                <label htmlFor="refine-contrast">Contrast ({contrast}%)</label>
                <input
                  id="refine-contrast"
                  type="range"
                  min="-100"
                  max="100"
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                />
              </div>
              <div className="refine-edge-slider-row">
                <label htmlFor="refine-shift-edge">
                  Shift Edge ({shiftEdge}%)
                </label>
                <input
                  id="refine-shift-edge"
                  type="range"
                  min="-100"
                  max="100"
                  value={shiftEdge}
                  onChange={(e) => setShiftEdge(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Output & Decontamination */}
            <div className="refine-edge-group">
              <div className="refine-edge-group-title">
                Color Decontamination
              </div>
              <label className="refine-edge-checkbox-label">
                <input
                  type="checkbox"
                  checked={decontaminate}
                  onChange={(e) => setDecontaminate(e.target.checked)}
                />
                <span>Decontaminate Colors</span>
              </label>

              {decontaminate && (
                <div className="refine-edge-slider-row mt-2">
                  <label htmlFor="refine-decontaminate-amount">
                    Amount ({decontaminateAmount}%)
                  </label>
                  <input
                    id="refine-decontaminate-amount"
                    type="range"
                    min="0"
                    max="100"
                    value={decontaminateAmount}
                    onChange={(e) =>
                      setDecontaminateAmount(Number(e.target.value))
                    }
                  />
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="refine-edge-actions">
              <Button data-testid="refine-edge-cancel" onClick={onClose}>
                Cancel
              </Button>
              <Button
                data-testid="refine-edge-apply"
                variant="primary"
                onClick={handleApply}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
