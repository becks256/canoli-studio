import { CROP_HANDLES, cropHandlePoint } from "../crop-controller";
import type { CropHandle } from "../crop-controller";
import type { CropBounds } from "../core/crop";
const labels: Record<CropHandle, string> = {
  nw: "top-left",
  n: "top",
  ne: "top-right",
  e: "right",
  se: "bottom-right",
  s: "bottom",
  sw: "bottom-left",
  w: "left",
};
export function CropOverlay({
  bounds,
  width,
  height,
  zoom,
  onNudge,
}: {
  bounds: CropBounds;
  width: number;
  height: number;
  zoom: number;
  onNudge(handle: CropHandle, dx: number, dy: number): void;
}) {
  const { x, y, width: w, height: h } = bounds;
  return (
    <>
      <svg
        className="crop-shade"
        width={width * zoom}
        height={height * zoom}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      >
        <path
          fill="rgba(0,0,0,.5)"
          fillRule="evenodd"
          d={`M0 0H${width}V${height}H0Z M${x} ${y}H${x + w}V${y + h}H${x}Z`}
        />
      </svg>
      <div
        className="crop-frame"
        role="group"
        aria-label="Crop frame"
        style={{
          left: x * zoom,
          top: y * zoom,
          width: w * zoom,
          height: h * zoom,
        }}
      >
        <span className="crop-dimensions">
          {w} × {h} px
        </span>
        <div className="crop-thirds" aria-hidden="true" />
        {CROP_HANDLES.map((handle) => {
          const p = cropHandlePoint(
            { x: 0, y: 0, width: w, height: h },
            handle,
          );
          return (
            <button
              key={handle}
              type="button"
              data-crop-handle={handle}
              className={`crop-handle crop-handle-${handle}`}
              aria-label={`Crop ${labels[handle]} handle`}
              title="Drag or use arrow keys; Shift changes by 10 px"
              style={{ left: p.x * zoom, top: p.y * zoom }}
              onKeyDown={(event) => {
                const delta: Record<string, [number, number]> = {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowUp: [0, -1],
                  ArrowDown: [0, 1],
                };
                const direction = delta[event.key];
                if (!direction) return;
                event.preventDefault();
                event.stopPropagation();
                const step = event.shiftKey ? 10 : 1;
                onNudge(handle, direction[0] * step, direction[1] * step);
              }}
            />
          );
        })}
      </div>
    </>
  );
}
