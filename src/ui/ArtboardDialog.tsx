import { useState } from "react";
import { Dialog } from "./Dialog";
import { Button, IconButton, NumberField } from "./controls";
import { Link2, Link2Off, X } from "lucide-react";

export interface ArtboardDialogProps {
  currentWidth: number;
  currentHeight: number;
  onResize(width: number, height: number): void;
  onClose(): void;
}

export function ArtboardDialog({
  currentWidth,
  currentHeight,
  onResize,
  onClose,
}: ArtboardDialogProps) {
  const [width, setWidth] = useState(currentWidth);
  const [height, setHeight] = useState(currentHeight);
  const [linked, setLinked] = useState(true);
  const [ratio, setRatio] = useState(
    currentHeight > 0 ? currentWidth / currentHeight : 1,
  );

  const isValid =
    Number.isInteger(width) &&
    width > 0 &&
    width <= Number.MAX_SAFE_INTEGER &&
    Number.isInteger(height) &&
    height > 0 &&
    height <= Number.MAX_SAFE_INTEGER;

  const handleWidthChange = (val: number) => {
    setWidth(val);
    if (linked && val > 0 && ratio > 0) {
      setHeight(Math.max(1, Math.round(val / ratio)));
    }
  };

  const handleHeightChange = (val: number) => {
    setHeight(val);
    if (linked && val > 0 && ratio > 0) {
      setWidth(Math.max(1, Math.round(val * ratio)));
    }
  };

  const toggleLinked = () => {
    setLinked((prev) => {
      const next = !prev;
      if (next && height > 0) {
        setRatio(width / height);
      }
      return next;
    });
  };

  const applyPreset = (w: number, h: number) => {
    setWidth(w);
    setHeight(h);
    if (h > 0) setRatio(w / h);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValid) return;
    onResize(width, height);
    onClose();
  };

  return (
    <Dialog
      titleId="artboard-title"
      className="artboard-dialog"
      onClose={onClose}
    >
      <div className="dialog-heading">
        <div>
          <span className="section-caption">CANVAS & ARTBOARD</span>
          <h2 id="artboard-title">Resize artboard</h2>
        </div>
        <IconButton label="Close resize artboard" onClick={onClose} autoFocus>
          <X size={19} />
        </IconButton>
      </div>

      <p className="script-description">
        Change canvas dimensions and pixel bounds. Existing artwork and layers
        preserve their coordinates and contents.
      </p>

      <form onSubmit={handleSubmit} className="artboard-form">
        <div className="artboard-dimensions-row">
          <NumberField
            id="artboard-width"
            label="Width"
            className="artboard-field"
            layout="stacked"
            value={width}
            min={1}
            max={Number.MAX_SAFE_INTEGER}
            step={1}
            suffix="px"
            placeholder="Width"
            autoFocus
            onChange={handleWidthChange}
            onCommit={handleWidthChange}
          />

          <div className="artboard-link-col">
            <IconButton
              label={
                linked
                  ? "Aspect ratio locked (click to unlink)"
                  : "Aspect ratio unlocked (click to link)"
              }
              className={`artboard-link-btn ${linked ? "linked" : "unlinked"}`}
              aria-pressed={linked}
              onClick={toggleLinked}
            >
              {linked ? <Link2 size={16} /> : <Link2Off size={16} />}
            </IconButton>
          </div>

          <NumberField
            id="artboard-height"
            label="Height"
            className="artboard-field"
            layout="stacked"
            value={height}
            min={1}
            max={Number.MAX_SAFE_INTEGER}
            step={1}
            suffix="px"
            placeholder="Height"
            onChange={handleHeightChange}
            onCommit={handleHeightChange}
          />
        </div>

        <div className="artboard-info">
          <span>
            Current size: {currentWidth} × {currentHeight} px
          </span>
          {isValid && (width !== currentWidth || height !== currentHeight) && (
            <span className="artboard-change-badge">
              {width} × {height} px (
              {Math.round(((width * height) / 1000000) * 10) / 10} MP)
            </span>
          )}
        </div>

        <div className="artboard-presets">
          <span className="preset-label">Presets:</span>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={() => applyPreset(currentWidth, currentHeight)}
          >
            Reset
          </Button>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={() => {
              const size = Math.max(width, height) || 1200;
              applyPreset(size, size);
            }}
          >
            Square 1:1
          </Button>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={() => applyPreset(1920, 1080)}
          >
            1080p (16:9)
          </Button>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={() => applyPreset(1080, 1920)}
          >
            Story (9:16)
          </Button>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={() => applyPreset(3840, 2160)}
          >
            4K UHD
          </Button>
        </div>

        <div className="artboard-actions">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={
              !isValid || (width === currentWidth && height === currentHeight)
            }
          >
            Apply resize
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
