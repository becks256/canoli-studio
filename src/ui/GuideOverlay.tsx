import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { GuideData } from "../core/guides";
import type { Document } from "../dom";

export function GuideOverlay({
  guide,
  document,
  zoom,
  editable,
  revision,
  onAttempt,
}: {
  guide: GuideData;
  document: Document;
  zoom: number;
  editable: boolean;
  revision: number;
  onAttempt(action: () => void): void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<{
    pointer: number;
    start: number;
    position: number;
    revision: number;
  } | null>(null);
  const cancel = () => {
    drag.current = null;
    setPreview(null);
  };
  useEffect(() => {
    cancel();
  }, [document, revision, editable, zoom]);
  const vertical = guide.orientation === "vertical";
  const coordinate = (event: PointerEvent) =>
    vertical ? event.clientX : event.clientY;
  const positionAt = (event: PointerEvent) => {
    const state = drag.current;
    if (
      !state ||
      !editable ||
      state.revision !== document.getSnapshot().revision
    )
      return null;
    const position = state.position + (coordinate(event) - state.start) / zoom;
    return Number.isFinite(position) &&
      Math.abs(position) <= Number.MAX_SAFE_INTEGER
      ? position
      : null;
  };
  return (
    <button
      type="button"
      className={`document-guide ${guide.orientation} ${editable ? "editable" : ""}`}
      aria-label={`${guide.orientation === "vertical" ? "Vertical" : "Horizontal"} guide at ${guide.position} pixels`}
      title="Drag guide · Arrow keys nudge · Shift for 10 pixels · Escape cancels"
      tabIndex={editable ? 0 : -1}
      aria-disabled={!editable}
      style={
        vertical
          ? {
              left: (preview ?? guide.position) * zoom,
              height: document.height * zoom,
            }
          : {
              top: (preview ?? guide.position) * zoom,
              width: document.width * zoom,
            }
      }
      onPointerDown={(event) => {
        if (!editable || event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = {
          pointer: event.pointerId,
          start: coordinate(event),
          position: guide.position,
          revision: document.getSnapshot().revision,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointer !== event.pointerId) return;
        event.stopPropagation();
        const position = positionAt(event);
        if (position === null) cancel();
        else setPreview(position);
      }}
      onPointerUp={(event) => {
        if (!drag.current || drag.current.pointer !== event.pointerId) return;
        event.stopPropagation();
        const position = positionAt(event);
        cancel();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        if (position !== null && position !== guide.position)
          onAttempt(() => document.guides.update(guide.id, { position }));
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        cancel();
      }}
      onLostPointerCapture={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          event.preventDefault();
          cancel();
          return;
        }
        if (!editable || drag.current) return;
        const delta = vertical
          ? { ArrowLeft: -1, ArrowRight: 1 }
          : { ArrowUp: -1, ArrowDown: 1 };
        const direction = delta[event.key as keyof typeof delta];
        if (direction) {
          event.preventDefault();
          event.stopPropagation();
          onAttempt(() =>
            document.guides.update(guide.id, {
              position: guide.position + direction * (event.shiftKey ? 10 : 1),
            }),
          );
        }
      }}
    />
  );
}
