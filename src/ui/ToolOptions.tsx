import type { Tool, ToolController, ToolSettings } from "../tools";
import type { VectorLayer, VectorPath } from "../dom";
import type { EditorCommand } from "../core/commands";
import { Slider } from "./controls";

export function ToolOptions({
  tool,
  controller,
  settings,
  hasSelection,
  disabled,
  onAction,
  onOpenArtboard,
}: {
  tool: Tool;
  controller: ToolController;
  settings: ToolSettings;
  hasSelection: boolean;
  disabled: boolean;
  onAction(action: () => void): void;
  onOpenArtboard?(): void;
}) {
  const brush = tool === "brush" || tool === "pencil" || tool === "clone";
  return (
    <div className="tool-options" aria-label="Tool options">
      <strong>
        {
          {
            move: "Move",
            hand: "Hand",
            artboard: "Artboard",
            brush: "Brush",
            pencil: "Pencil",
            pen: "Pen",
            marquee: "Marquee",
            clone: "Clone",
            text: "Text",
            fill: "Paint bucket",
          }[tool]
        }
      </strong>
      {(brush || tool === "pen" || tool === "marquee" || tool === "fill") && (
        <label className="tool-color">
          <input
            type="color"
            aria-label="Foreground color"
            value={settings.color}
            disabled={disabled}
            onChange={(e) => controller.configure({ color: e.target.value })}
          />
          <span>{settings.color.toUpperCase()}</span>
        </label>
      )}
      {brush && (
        <>
          <Slider
            label="Size"
            value={settings.size}
            min={0.1}
            max={2048}
            step={0.1}
            suffix="px"
            scale="quadratic"
            disabled={disabled}
            onPreview={(size) => controller.configure({ size })}
            onCommit={(size) => controller.configure({ size })}
          />
          {tool !== "pencil" && (
            <Slider
              label="Hardness"
              suffix="%"
              value={settings.hardness * 100}
              min={0}
              max={100}
              disabled={disabled}
              onPreview={(v) => controller.configure({ hardness: v / 100 })}
              onCommit={(v) => controller.configure({ hardness: v / 100 })}
            />
          )}
          <Slider
            label="Tool opacity"
            suffix="%"
            value={settings.opacity * 100}
            min={0}
            max={100}
            disabled={disabled}
            onPreview={(v) => controller.configure({ opacity: v / 100 })}
            onCommit={(v) => controller.configure({ opacity: v / 100 })}
          />
          {tool === "clone" && (
            <label className="check-field">
              <input
                type="checkbox"
                aria-label="Aligned clone source"
                checked={settings.cloneAligned}
                onChange={(e) =>
                  controller.configure({ cloneAligned: e.target.checked })
                }
              />
              Aligned
            </label>
          )}
        </>
      )}
      {tool === "fill" && (
        <Slider
          label="Tool opacity"
          suffix="%"
          value={settings.opacity * 100}
          min={0}
          max={100}
          disabled={disabled}
          onPreview={(v) => controller.configure({ opacity: v / 100 })}
          onCommit={(v) => controller.configure({ opacity: v / 100 })}
        />
      )}
      {tool === "pen" && (
        <>
          <Slider
            label="Pen width"
            value={settings.penWidth}
            min={0}
            max={1024}
            step={0.1}
            suffix="px"
            scale="quadratic"
            disabled={disabled}
            onPreview={(penWidth) => controller.configure({ penWidth })}
            onCommit={(penWidth) => controller.configure({ penWidth })}
          />
          <label className="check-field">
            <input
              type="checkbox"
              aria-label="Fill new paths"
              checked={settings.penFill}
              onChange={(e) =>
                controller.configure({ penFill: e.target.checked })
              }
            />
            Fill
          </label>
          <button
            className="button subtle compact"
            onClick={() => controller.finishPath()}
          >
            Finish path ↵
          </button>
        </>
      )}
      {tool === "marquee" && (
        <>
          <select
            aria-label="Marquee shape"
            value={settings.selectionShape}
            onChange={(e) =>
              controller.configure({
                selectionShape: e.target
                  .value as ToolSettings["selectionShape"],
              })
            }
          >
            <option value="rectangle">Rectangle</option>
            <option value="ellipse">Ellipse</option>
          </select>
          <select
            aria-label="Selection operation"
            value={settings.selectionMode}
            onChange={(e) =>
              controller.configure({
                selectionMode: e.target.value as ToolSettings["selectionMode"],
              })
            }
          >
            <option value="replace">Replace</option>
            <option value="add">Add</option>
            <option value="subtract">Subtract</option>
            <option value="intersect">Intersect</option>
          </select>
        </>
      )}
      {hasSelection && (
        <button
          className="button subtle compact"
          disabled={disabled}
          onClick={() => onAction(() => controller.fillSelection())}
        >
          Fill selection
        </button>
      )}
      {tool === "artboard" && onOpenArtboard && (
        <button
          type="button"
          className="button subtle compact"
          disabled={disabled}
          onClick={onOpenArtboard}
        >
          Resize artboard...
        </button>
      )}
      <span className="tool-hint">
        {tool === "artboard"
          ? "Set canvas dimensions and scale proportionally"
          : tool === "text"
            ? "Click on the canvas to place a text layer"
            : tool === "move"
              ? "Drag artwork or layer rows"
            : tool === "hand"
              ? "Drag to pan · Scroll to zoom"
              : tool === "clone"
                ? "Alt/Option-click to sample"
                : tool === "pen"
                  ? "Click anchors · Drag curves · Click start to close"
                  : tool === "marquee"
                    ? "Shift adds · Alt subtracts"
                    : tool === "fill"
                      ? "Click to fill canvas or active selection"
                      : "Drag to draw · [ ] size"}
      </span>
    </div>
  );
}
export function PathProperties({
  layer,
  path,
  disabled,
  onAction,
  onPreview,
  previewStrokeWidth,
}: {
  layer: VectorLayer;
  path: VectorPath | null;
  disabled: boolean;
  onAction(action: () => void): void;
  onPreview(command: EditorCommand): void;
  previewStrokeWidth?: number;
}) {
  if (!path)
    return (
      <section>
        <h2>Vector paths</h2>
        <p className="section-description">
          Choose the Pen tool to draw a path.
        </p>
      </section>
    );
  return (
    <section>
      <h2>
        Vector path{" "}
        <span className="section-caption">{layer.paths.length} PATHS</span>
      </h2>
      <label className="check-field">
        <input
          type="checkbox"
          aria-label="Closed path"
          checked={path.closed}
          disabled={disabled}
          onChange={(e) =>
            onAction(() => {
              path.closed = e.target.checked;
            })
          }
        />
        Closed path
      </label>
      <div className="style-color-row">
        <label className="check-field">
          <input
            type="checkbox"
            aria-label="Path fill enabled"
            checked={!!path.fill}
            disabled={disabled}
            onChange={(e) =>
              onAction(() => {
                path.fill = e.target.checked ? "#d5e79b" : null;
              })
            }
          />
          Fill
        </label>
        <input
          type="color"
          aria-label="Path fill color"
          value={path.fill ?? "#d5e79b"}
          disabled={disabled || !path.fill}
          onChange={(e) =>
            onAction(() => {
              path.fill = e.target.value;
            })
          }
        />
      </div>
      <div className="style-color-row">
        <label className="check-field">
          <input
            type="checkbox"
            aria-label="Path stroke enabled"
            checked={!!path.stroke}
            disabled={disabled}
            onChange={(e) =>
              onAction(() => {
                path.stroke = e.target.checked ? "#d5e79b" : null;
              })
            }
          />
          Stroke
        </label>
        <input
          type="color"
          aria-label="Path stroke color"
          value={path.stroke ?? "#d5e79b"}
          disabled={disabled || !path.stroke}
          onChange={(e) =>
            onAction(() => {
              path.stroke = e.target.value;
            })
          }
        />
      </div>
      <Slider
        key={path.id}
        label="Path stroke width"
        value={previewStrokeWidth ?? path.strokeWidth}
        min={0}
        max={1024}
            step={0.1}
            suffix="px"
            scale="quadratic"
        disabled={disabled}
        onPreview={(value) => onPreview({ type: "path.update", id: layer.id, pathId: path.id, patch: { strokeWidth: value } })}
        onCommit={(value) =>
          onAction(() => {
            path.strokeWidth = value;
          })
        }
      />
      <p className="section-description">
        {path.points.length} anchors · Pen tool moves anchors and handles.
        Alt/Option moves one handle independently.
      </p>
      <button
        className="button subtle compact"
        disabled={disabled}
        onClick={() => onAction(() => path.remove())}
      >
        Delete path
      </button>
    </section>
  );
}
