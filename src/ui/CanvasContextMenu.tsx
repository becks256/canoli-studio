import { useShortcutHint } from "./ShortcutHints";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Crop,
  Hand,
  MousePointer2,
  Paintbrush,
  PaintBucket,
  Pencil,
  PenTool,
  Scan,
  Stamp,
  Type,
  X,
  Sparkles,
} from "lucide-react";
import type { Tool, ToolController, ToolSettings } from "../tools";
import type { Layer } from "../dom";
import { Slider, Select, IconButton } from "./controls";
import { formatShortcut } from "./shortcuts";

export interface CanvasContextMenuProps {
  x: number;
  y: number;
  tool: Tool;
  settings: ToolSettings;
  controller: ToolController;
  disabled: boolean;
  hasSelection: boolean;
  hasMask: boolean;
  hasVectorMask: boolean;
  moveTarget: "layer" | "mask";
  onMoveTarget(target: "layer" | "mask"): void;
  selectedLayer: Layer | null;
  locked: boolean;
  onChooseTool(tool: Tool): void;
  onAddLayer(): void;
  onAddAdjustmentLayer(kind: "curves" | "levels" | "tone" | "hsl" | "color-balance" | "vibrance" | "gradient-map" | "white-balance" | "lut" | "red-eye"): void;
  onFrequencySeparation?(): void;
  onGenerateLayer?(): void;
  onGenerativeFill?(): void;
  onDuplicateLayer(): void;
  onDeleteLayer(): void;
  onSelectAll(): void;
  onDeselect(): void;
  onFillSelection(): void;
  onSelectSubject?(): void;
  onRemoveBackground?(): void;
  onRefineEdge?(): void;
  onFit(): void;
  onActualSize(): void;
  onClose(): void;
}

const TOOL_DEFINITIONS: Array<{
  id: Tool;
  name: string;
  key: string;
  icon: typeof MousePointer2;
}> = [
  { id: "move", name: "Move", key: "V", icon: MousePointer2 },
  { id: "hand", name: "Hand", key: "H", icon: Hand },
  { id: "marquee", name: "Marquee", key: "M", icon: Scan },
  { id: "fill", name: "Bucket", key: "G", icon: PaintBucket },
  { id: "brush", name: "Brush", key: "B", icon: Paintbrush },
  { id: "pencil", name: "Pencil", key: "N", icon: Pencil },
  { id: "pen", name: "Pen", key: "P", icon: PenTool },
  { id: "text", name: "Text", key: "T", icon: Type },
  { id: "clone", name: "Clone", key: "S", icon: Stamp },
  { id: "crop", name: "Crop", key: "C", icon: Crop },
];

export function CanvasContextMenu({
  x,
  y,
  tool,
  settings,
  controller,
  disabled,
  hasSelection,
  hasMask,
  hasVectorMask,
  moveTarget,
  onMoveTarget,
  selectedLayer,
  locked,
  onChooseTool,
  onAddLayer,
  onAddAdjustmentLayer,
  onFrequencySeparation,
  onGenerateLayer,
  onGenerativeFill,
  onDuplicateLayer,
  onDeleteLayer,
  onSelectAll,
  onDeselect,
  onFillSelection,
  onSelectSubject,
  onRemoveBackground,
  onRefineEdge,
  onFit,
  onActualSize,
  onClose,
}: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x, y });

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 12;
    let nextX = Math.max(margin, x);
    let nextY = Math.max(margin, y);
    if (nextX + rect.width > window.innerWidth - margin) {
      nextX = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (nextY + rect.height > window.innerHeight - margin) {
      nextY = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setCoords({ x: nextX, y: nextY });
  }, [x, y, tool]);

  useEffect(() => {
    menuRef.current?.focus();
    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  const isBrushLike = tool === "brush" || tool === "pencil" || tool === "clone";

  return (
    <div
      ref={menuRef}
      tabIndex={-1}
      className="canvas-context-menu"
      role="region"
      aria-label="Canvas context menu"
      style={{ left: coords.x, top: coords.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="context-menu-header">
        <span>Tools & Options</span>
        <IconButton label="Close menu (Esc)" onClick={onClose}>
          <X size={13} />
        </IconButton>
      </div>

      <div
        className="context-tools-grid"
        role="toolbar"
        aria-label="Quick tools"
      >
        {TOOL_DEFINITIONS.map(({ id, name, key, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`context-tool-btn ${tool === id ? "active" : ""}`}
            title={`${name} (${key})`}
            aria-label={`${name} (${key})`}
            aria-pressed={tool === id}
            onClick={() => onChooseTool(id)}
          >
            <Icon size={16} />
            <span className="context-tool-key">{key}</span>
          </button>
        ))}
      </div>

      {/* Active tool options */}
      <div className="context-tool-options" aria-label="Tool options">
        <div className="context-tool-options-title">
          <span>
            {TOOL_DEFINITIONS.find((t) => t.id === tool)?.name ?? tool} Options
          </span>
          {(isBrushLike ||
            (tool === "pen" && settings.penEditTarget === "layer") ||
            tool === "fill") && (
            <label className="context-color-chip" title="Foreground color">
              <input
                type="color"
                aria-label="Context foreground color"
                value={settings.color}
                disabled={disabled}
                onChange={(e) =>
                  controller.configure({ color: e.target.value })
                }
              />
              <span style={{ backgroundColor: settings.color }} />
            </label>
          )}
        </div>

        {isBrushLike && (
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
              label="Opacity"
              suffix="%"
              value={settings.opacity * 100}
              min={0}
              max={100}
              disabled={disabled}
              onPreview={(v) => controller.configure({ opacity: v / 100 })}
              onCommit={(v) => controller.configure({ opacity: v / 100 })}
            />
            {tool === "clone" && (
              <label className="context-check-field">
                <input
                  type="checkbox"
                  aria-label="Aligned clone source"
                  checked={settings.cloneAligned}
                  onChange={(e) =>
                    controller.configure({ cloneAligned: e.target.checked })
                  }
                />
                Aligned source
              </label>
            )}
          </>
        )}

        {tool === "pen" && (
          <>
            {hasVectorMask && (
              <Select
                label="Target"
                value={settings.penEditTarget}
                disabled={disabled}
                options={[
                  { value: "layer", label: "Layer paths" },
                  { value: "mask", label: "Mask paths" },
                ]}
                onChange={(value) =>
                  controller.configure({
                    penEditTarget: value as "layer" | "mask",
                  })
                }
              />
            )}
            {settings.penEditTarget === "layer" && (
              <>
                <Slider
                  label="Width"
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
                <div className="context-row">
                  <label className="context-check-field">
                    <input
                      type="checkbox"
                      aria-label="Fill paths"
                      checked={settings.penFill}
                      onChange={(e) =>
                        controller.configure({ penFill: e.target.checked })
                      }
                    />
                    Fill
                  </label>
                  <button
                    type="button"
                    className="button subtle button-sm"
                    onClick={() => {
                      controller.finishPath();
                      onClose();
                    }}
                  >
                    Finish path
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {tool === "marquee" && (
          <div className="context-select-group">
            <Select
              label="Shape"
              value={settings.selectionShape}
              options={[
                { value: "rectangle", label: "Rectangle" },
                { value: "ellipse", label: "Ellipse" },
              ]}
              onChange={(value) =>
                controller.configure({
                  selectionShape: value as ToolSettings["selectionShape"],
                })
              }
            />
            <Select
              label="Mode"
              value={settings.selectionMode}
              options={[
                { value: "replace", label: "Replace" },
                { value: "add", label: "Add" },
                { value: "subtract", label: "Subtract" },
                { value: "intersect", label: "Intersect" },
              ]}
              onChange={(value) =>
                controller.configure({
                  selectionMode: value as ToolSettings["selectionMode"],
                })
              }
            />
          </div>
        )}

        {tool === "fill" && (
          <Slider
            label="Opacity"
            suffix="%"
            value={settings.opacity * 100}
            min={0}
            max={100}
            disabled={disabled}
            onPreview={(v) => controller.configure({ opacity: v / 100 })}
            onCommit={(v) => controller.configure({ opacity: v / 100 })}
          />
        )}

        {tool === "move" && (
          <Select
            label="Move target"
            value={moveTarget}
            disabled={disabled}
            options={
              hasMask
                ? [
                    { value: "layer", label: "Layer" },
                    { value: "mask", label: "Mask" },
                  ]
                : [{ value: "layer", label: "Layer" }]
            }
            onChange={(value) => onMoveTarget(value as "layer" | "mask")}
          />
        )}

        {tool === "crop" && (
          <div className="context-button-row">
            <button
              type="button"
              className="button subtle button-sm"
              onClick={() => {
                controller.crop.start(null);
                onClose();
              }}
            >
              New frame
            </button>
            <button
              type="button"
              className="button primary button-sm"
              disabled={!controller.crop.bounds}
              onClick={() => {
                controller.crop.apply();
                onClose();
              }}
            >
              Apply crop
            </button>
          </div>
        )}

        {tool === "hand" && (
          <div className="context-hint">Space + drag to pan canvas view</div>
        )}

        {tool === "text" && (
          <div className="context-hint">
            Click on canvas to create or edit text
          </div>
        )}
      </div>

      <div className="context-menu-divider" />

      {/* Context Actions */}
      <div className="context-actions-list" role="menu">
        <span className="context-section-label">Selection</span>
        <button
          type="button"
          className="context-action-btn"
          role="menuitem"
          disabled={!hasSelection}
          onClick={() => {
            onDeselect();
            onClose();
          }}
        >
          <span>Deselect</span>
          <span className="context-shortcut">
            <ShortcutHint id="deselect" fallback={formatShortcut("Mod+d")} />
          </span>
        </button>
        <button
          type="button"
          className="context-action-btn"
          role="menuitem"
          onClick={() => {
            onSelectAll();
            onClose();
          }}
        >
          <span>Select all</span>
          <span className="context-shortcut">
            <ShortcutHint id="select-all" fallback={formatShortcut("Mod+a")} />
          </span>
        </button>
        {hasSelection && (
          <button
            type="button"
            className="context-action-btn"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              onFillSelection();
              onClose();
            }}
          >
            <span>Fill selection</span>
          </button>
        )}
        {hasSelection && (onGenerativeFill || onGenerateLayer) && (
          <button
            type="button"
            className="context-action-btn"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              (onGenerativeFill ?? onGenerateLayer)?.();
              onClose();
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={14} />
              Generative fill...
            </span>
          </button>
        )}
        {onSelectSubject && (
          <button
            type="button"
            className="context-action-btn"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              onSelectSubject();
              onClose();
            }}
          >
            <span>Select subject</span>
          </button>
        )}
        {onRemoveBackground && (
          <button
            type="button"
            className="context-action-btn"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              onRemoveBackground();
              onClose();
            }}
          >
            <span>Remove background</span>
          </button>
        )}
        {onRefineEdge && (
          <button
            type="button"
            className="context-action-btn"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              onRefineEdge();
              onClose();
            }}
          >
            <span>Refine edge...</span>
          </button>
        )}

        <div className="context-menu-divider" />
        <span className="context-section-label">View</span>
        <button
          type="button"
          className="context-action-btn"
          role="menuitem"
          onClick={() => {
            onFit();
            onClose();
          }}
        >
          <span>Fit canvas</span>
          <span className="context-shortcut">
            <ShortcutHint id="fit" fallback={formatShortcut("Mod+0")} />
          </span>
        </button>
        <button
          type="button"
          className="context-action-btn"
          role="menuitem"
          onClick={() => {
            onActualSize();
            onClose();
          }}
        >
          <span>Actual size 100%</span>
          <span className="context-shortcut">
            <ShortcutHint id="actual" fallback={formatShortcut("Mod+1")} />
          </span>
        </button>

        <div className="context-menu-divider" />
        <span className="context-section-label">Layers</span>
        {onFrequencySeparation && (
          <button
            type="button"
            className="context-action-btn"
            role="menuitem"
            disabled={disabled}
            onClick={() => { onFrequencySeparation(); onClose(); }}
          >
            Frequency separation…
          </button>
        )}
        <button
          type="button"
          className="context-action-btn"
          role="menuitem"
          disabled={disabled}
          onClick={() => {
            onAddLayer();
            onClose();
          }}
        >
          <span>New paint layer</span>
          <span className="context-shortcut">
            <ShortcutHint
              id="new-layer"
              fallback={formatShortcut("Mod+Shift+n")}
            />
          </span>
        </button>
        <div
          className="context-sub-row"
          role="group"
          aria-label="Adjustment layers"
        >
          <span className="context-sub-label">Adjustment:</span>
          <button
            type="button"
            className="button subtle button-sm"
            onClick={() => {
              onAddAdjustmentLayer("curves");
              onClose();
            }}
          >
            Curves
          </button>
          <button
            type="button"
            className="button subtle button-sm"
            onClick={() => {
              onAddAdjustmentLayer("levels");
              onClose();
            }}
          >
            Levels
          </button>
          <button
            type="button"
            className="button subtle button-sm"
            onClick={() => {
              onAddAdjustmentLayer("tone");
              onClose();
            }}
          >
            Tone
          </button>
          <button
            type="button"
            className="button subtle button-sm"
            disabled={disabled}
            onClick={() => {
              onAddAdjustmentLayer("hsl");
              onClose();
            }}
          >
            HSL
          </button>
          {(["color-balance","vibrance","gradient-map","white-balance","lut","red-eye"] as const).map(kind=><button key={kind} type="button" className="button subtle button-sm" disabled={disabled}
            onClick={()=>{onAddAdjustmentLayer(kind);onClose();}}>{kind==="color-balance"?"Color Balance":kind==="gradient-map"?"Gradient Map":kind==="white-balance"?"White Balance":kind==="lut"?"Color Lookup (LUT)":kind==="red-eye"?"Red Eye":"Vibrance"}</button>)}
        </div>
        {onGenerateLayer && (
          <button
            type="button"
            className="context-action-btn"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              onGenerateLayer();
              onClose();
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={14} />
              Generate layer...
            </span>
          </button>
        )}
        <button
          type="button"
          className="context-action-btn"
          role="menuitem"
          disabled={!selectedLayer || locked}
          onClick={() => {
            onDuplicateLayer();
            onClose();
          }}
        >
          <span>Duplicate layer</span>
          <span className="context-shortcut">
            <ShortcutHint id="duplicate" fallback={formatShortcut("Mod+j")} />
          </span>
        </button>
        <button
          type="button"
          className="context-action-btn danger"
          role="menuitem"
          disabled={!selectedLayer || locked}
          onClick={() => {
            onDeleteLayer();
            onClose();
          }}
        >
          <span>Delete layer</span>
          <span className="context-shortcut">
            <ShortcutHint id="delete" fallback="Del" />
          </span>
        </button>
      </div>
    </div>
  );
}

function ShortcutHint({ id, fallback }: { id: string; fallback: string }) {
  return <>{useShortcutHint(id, fallback)}</>;
}
