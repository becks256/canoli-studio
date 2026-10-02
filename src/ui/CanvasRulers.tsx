import { useEffect, useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import { Document, Guide } from "../dom";

export function rulerTicks(length: number, origin: number, zoom: number) {
  const magnitude = 10 ** Math.floor(Math.log10(60 / zoom));
  const step = [1, 2, 5, 10]
    .map((value) => value * magnitude)
    .find((value) => value * zoom >= 60)!;
  const start = Math.ceil(-origin / zoom / step);
  const count = Math.ceil(length / (step * zoom)) + 1;
  return Array.from({ length: count }, (_, index) => {
    const value = (start + index) * step;
    return { value, pixel: origin + value * zoom };
  });
}

export function CanvasRulers({
  viewport,
  document,
  zoom,
  pan,
  revision,
  editable,
  onAttempt,
}: {
  viewport: RefObject<HTMLDivElement | null>;
  document: Document;
  zoom: number;
  pan: { x: number; y: number };
  revision: number;
  editable: boolean;
  onAttempt(action: () => void): void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [preview, setPreview] = useState<{
    orientation: "horizontal" | "vertical";
    position: number;
  } | null>(null);
  const drag = useRef<{
    orientation: "horizontal" | "vertical";
    pointer: number;
    revision: number;
  } | null>(null);
  const cancel = () => {
    drag.current = null;
    setPreview(null);
  };
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const update = () =>
      setSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [viewport]);
  useEffect(cancel, [
    document,
    revision,
    zoom,
    pan.x,
    pan.y,
    editable,
    size.width,
    size.height,
  ]);
  const origin = {
    x: size.width / 2 + pan.x - (document.width * zoom) / 2,
    y: size.height / 2 + pan.y - (document.height * zoom) / 2,
  };
  const point = (event: PointerEvent) => {
    const bounds = viewport.current!.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - origin.x) / zoom,
      y: (event.clientY - bounds.top - origin.y) / zoom,
    };
  };
  return (
    <>
      {(["horizontal", "vertical"] as const).map((orientation) => {
        const horizontal = orientation === "horizontal";
        const ticks = rulerTicks(
          horizontal ? size.width : size.height,
          horizontal ? origin.x : origin.y,
          zoom,
        );
        return (
          <button
            key={orientation}
            type="button"
            className={`canvas-ruler ${orientation}`}
            aria-label={`${horizontal ? "Horizontal" : "Vertical"} ruler`}
            disabled={!editable}
            title={`Drag into the canvas to add a ${orientation} guide; Enter adds a centered guide`}
            onClick={(event) => {
              if (event.detail === 0)
                onAttempt(() =>
                  document.guides.add(
                    new Guide({
                      orientation,
                      position:
                        (horizontal ? document.height : document.width) / 2,
                    }),
                  ),
                );
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || !editable) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.focus();
              drag.current = {
                orientation,
                pointer: event.pointerId,
                revision: document.getSnapshot().revision,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!drag.current || drag.current.pointer !== event.pointerId)
                return;
              event.stopPropagation();
              if (drag.current.revision !== document.getSnapshot().revision) {
                cancel();
                return;
              }
              const p = point(event);
              setPreview({ orientation, position: horizontal ? p.y : p.x });
            }}
            onPointerUp={(event) => {
              if (!drag.current || drag.current.pointer !== event.pointerId)
                return;
              event.stopPropagation();
              const valid =
                editable &&
                drag.current.revision === document.getSnapshot().revision;
              const p = point(event);
              cancel();
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
              if (
                valid &&
                p.x >= 0 &&
                p.y >= 0 &&
                p.x <= document.width &&
                p.y <= document.height
              ) {
                onAttempt(() =>
                  document.guides.add(
                    new Guide({
                      orientation,
                      position: horizontal ? p.y : p.x,
                    }),
                  ),
                );
              }
            }}
            onPointerCancel={(event) => {
              event.stopPropagation();
              cancel();
            }}
            onLostPointerCapture={cancel}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancel();
              }
            }}
          >
            <svg width="100%" height="100%" aria-hidden="true">
              {ticks.map(({ value, pixel }) => (
                <g key={value}>
                  <line
                    x1={horizontal ? pixel : 14}
                    y1={horizontal ? 14 : pixel}
                    x2={horizontal ? pixel : 20}
                    y2={horizontal ? 20 : pixel}
                  />
                  <text
                    x={horizontal ? pixel + 3 : 3}
                    y={horizontal ? 11 : pixel + 11}
                  >
                    {Number(value.toPrecision(10))}
                  </text>
                </g>
              ))}
            </svg>
          </button>
        );
      })}
      {preview && (
        <div
          className={`ruler-guide-preview ${preview.orientation}`}
          style={
            preview.orientation === "vertical"
              ? { left: origin.x + preview.position * zoom }
              : { top: origin.y + preview.position * zoom }
          }
        />
      )}
    </>
  );
}
