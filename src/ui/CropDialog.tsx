import { useState } from "react";
import { X } from "lucide-react";
import { cropBoundsSchema, cropFromSelection } from "../core/crop";
import type { CropBounds } from "../core/crop";
import type { SelectionData } from "../core/drawing";
import { Dialog } from "./Dialog";
import { Button, IconButton, NumberField } from "./controls";

export function CropDialog({
  width,
  height,
  selection,
  initialBounds,
  documentStamp,
  onCrop,
  onClose,
}: {
  width: number;
  height: number;
  selection: SelectionData | null;
  initialBounds?: CropBounds | null;
  documentStamp: string;
  onCrop(bounds: CropBounds): void;
  onClose(): void;
}) {
  const rectangle = cropFromSelection(selection);
  const [bounds, setBounds] = useState<CropBounds>(
    initialBounds ?? rectangle ?? { x: 0, y: 0, width, height },
  );
  const [initialStamp] = useState(documentStamp);
  const [error, setError] = useState("");
  const valid = cropBoundsSchema.safeParse(bounds).success;
  const unchanged =
    bounds.x === 0 &&
    bounds.y === 0 &&
    bounds.width === width &&
    bounds.height === height;
  return (
    <Dialog titleId="crop-title" className="artboard-dialog" onClose={onClose}>
      <div className="dialog-heading">
        <div>
          <span className="section-caption">CANVAS</span>
          <h2 id="crop-title">Crop canvas</h2>
        </div>
        <IconButton label="Close crop canvas" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      <p className="script-description">
        Set the new canvas bounds. Artwork outside the crop and original image
        data stay in the project. Bounds may extend beyond the current canvas.
      </p>
      <form
        className="artboard-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || unchanged) return;
          try {
            if (initialStamp !== documentStamp)
              throw new Error(
                "The document changed. Close and reopen Crop canvas before applying.",
              );
            onCrop(bounds);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <div className="field-grid">
          {(["x", "y", "width", "height"] as const).map((key) => (
            <NumberField
              key={key}
              label={`Crop ${key === "x" || key === "y" ? key.toUpperCase() : key}`}
              value={bounds[key]}
              min={key === "x" || key === "y" ? -Number.MAX_SAFE_INTEGER : 1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              suffix="px"
              autoFocus={key === "x"}
              onChange={(value) =>
                setBounds((current) => ({ ...current, [key]: value }))
              }
              onCommit={(value) =>
                setBounds((current) => ({ ...current, [key]: value }))
              }
            />
          ))}
        </div>
        <div className="artboard-info">
          <span>
            Current canvas: {width} × {height} px
          </span>
        </div>
        <div className="artboard-presets">
          <Button
            variant="subtle"
            onClick={() => setBounds({ x: 0, y: 0, width, height })}
          >
            Reset crop bounds
          </Button>
          <Button
            variant="subtle"
            disabled={!rectangle}
            onClick={() => rectangle && setBounds(rectangle)}
          >
            Use rectangular selection
          </Button>
        </div>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="artboard-actions">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!valid || unchanged}
          >
            Apply crop
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
