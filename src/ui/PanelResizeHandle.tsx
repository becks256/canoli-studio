import { useRef } from "react";

/** Focusable splitter with transient pointer preview and a single release commit. */
export function PanelResizeHandle({
  label,
  value,
  min,
  max,
  direction,
  disabled,
  onStart,
  onPreview,
  onCommit,
  onCancel,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  direction: 1 | -1;
  disabled: boolean;
  onStart(): void;
  onPreview(value: number): void;
  onCommit(value: number): void;
  onCancel(): void;
  onReset(): void;
}) {
  const drag = useRef<{ x: number; value: number; current: number } | null>(
    null,
  );
  const clamp = (value: number) =>
    Math.round(Math.max(min, Math.min(max, value)));
  const cancel = () => {
    if (drag.current) {
      drag.current = null;
      onCancel();
    }
  };
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className="panel-resize-handle"
      title={`${label}. Arrow keys resize; double-click resets.`}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        onStart();
        drag.current = { x: event.clientX, value, current: value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active) return;
        active.current = clamp(
          active.value + (event.clientX - active.x) * direction,
        );
        onPreview(active.current);
      }}
      onPointerUp={(event) => {
        const active = drag.current;
        if (!active) return;
        drag.current = null;
        onCommit(active.current);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onBlur={cancel}
      onDoubleClick={() => {
        if (!disabled) {
          cancel();
          onReset();
        }
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Escape") {
          event.stopPropagation();
          event.preventDefault();
          cancel();
          return;
        }
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.stopPropagation();
        event.preventDefault();
        if (drag.current) cancel();
        onStart();
        onCommit(
          clamp(
            event.key === "Home"
              ? min
              : event.key === "End"
                ? max
                : value +
                  (event.key === "ArrowRight" ? 1 : -1) *
                    direction *
                    (event.shiftKey ? 50 : 10),
          ),
        );
      }}
    />
  );
}
