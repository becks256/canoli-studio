import {PaletteColorInput} from "./PaletteColorControl";
import type {VectorGradientData} from '../core/vector-gradient';
import {VectorGradientControls} from './VectorGradientControls';
import {VectorStrokeControls} from './VectorStrokeControls';
import type { Tool, ToolController, ToolSettings } from "../tools";
import type { VectorLayer, VectorPath } from "../dom";
import type { EditorCommand } from "../core/commands";
import { Button, Slider, Select } from "./controls";
import { InspectorSection } from "./InspectorSection";

export function ToolOptions({
  tool,
  moveTarget,
  hasMask,
  hasPaintMask,
  hasFilterMask = false,
  hasVectorMask,
  onMoveTarget,
  snapEnabled = false,
  onSnapEnabled,
  snapArtwork = false,
  onSnapArtwork,
  controller,
  settings,
  hasSelection,
  disabled,
  onAction,
  onOpenImageSize,
  onOpenArtboard,
  onOpenCrop,
  documentBusy,
  onModifySelection,
  onColorRange,
  onPressureCurve,
  onBrushTip,
  onBrushTexture,
  onBrushSymmetry,
  onBrushPresets,
}: {
  tool: Tool;
  moveTarget: "layer" | "mask";
  hasMask: boolean;
  hasPaintMask: boolean;
  hasFilterMask?: boolean;
  hasVectorMask: boolean;
  snapArtwork?: boolean;
  onSnapArtwork?(enabled: boolean): void;
  snapEnabled?: boolean;
  onSnapEnabled?(enabled: boolean): void;
  onMoveTarget(target: "layer" | "mask"): void;
  controller: ToolController;
  settings: ToolSettings;
  hasSelection: boolean;
  disabled: boolean;
  onAction(action: () => void): void;
  onOpenImageSize?(): void;
  onOpenArtboard?(): void;
  onOpenCrop?(): void;
  documentBusy: boolean;
  onModifySelection?(): void;
  onColorRange?(): void;
  onPressureCurve?(): void;
  onBrushTip?(): void;
  onBrushTexture?(): void;
  onBrushSymmetry?(): void;
  onBrushPresets?(): void;
}) {
  const wet=tool==="smudge"||tool==="mixer";
  const tonal = tool === "dodge" || tool === "burn";
  const brush =
    wet || tonal ||
    tool === "heal" ||
    tool === "brush" ||
    tool === "pencil" ||
    tool === "clone" ||
    tool === "eraser";
  return (
    <div className="tool-options" aria-label="Tool options">
      <strong>
        {
          {
            wand: "Magic wand",
            'quick-select':'Quick selection',
            move: "Move",
            hand: "Hand",
            artboard: "Artboard",
            crop: "Crop",
            brush: "Brush",
            smudge: "Smudge",
            mixer: "Mixer brush",
            dodge: "Dodge",
            burn: "Burn",
            pencil: "Pencil",
            eraser: "Eraser",
            pen: "Pen",
            marquee: "Marquee",
            lasso: settings.lassoMode === "polygon" ? "Polygonal lasso" : "Freeform lasso",
            clone: "Clone",
            patch: "Patch",
            heal: "Spot Healing",
            text: "Text",
            fill: "Paint bucket",
          }[tool]
        }
      </strong>
      {(tool === "patch" || tool === "heal") && (
        <>
          {tool === "patch" && (
            <Select
              label="Patch mode"
              value={settings.patchDirection}
              disabled={disabled || documentBusy}
              options={[
                { value: "source", label: "Source" },
                { value: "destination", label: "Destination" },
              ]}
              onChange={(value) =>
                controller.configure({
                  patchDirection: value as ToolSettings["patchDirection"],
                })
              }
            />
          )}
          <Select
            label="Patch sampling"
            value={settings.patchSampling}
            disabled={disabled || documentBusy}
            options={[
              { value: "all-layers", label: "All layers" },
              { value: "current-and-below", label: "Current and below" },
              { value: "current-layer", label: "Current layer" },
            ]}
            onChange={(e) =>
              controller.configure({
                patchSampling: e as ToolSettings["patchSampling"],
              })
            }
          />
          <Select
            label="Patch detail"
            value={settings.patchMode}
            disabled={disabled || documentBusy}
            options={[
              { value: "source", label: "Donor detail" },
              { value: "mixed", label: "Preserve stronger detail" },
            ]}
            onChange={(e) =>
              controller.configure({
                patchMode: e as ToolSettings["patchMode"],
              })
            }
          />
          {tool === "heal" && (
            <Slider
              label="Search radius"
              value={settings.healingRadius}
              min={1}
              max={1024}
              step={1}
              suffix="px"
              disabled={disabled || documentBusy}
              onPreview={(value) =>
                controller.configure({ healingRadius: value })
              }
              onCommit={(value) =>
                controller.configure({ healingRadius: value })
              }
            />
          )}
          {tool === "patch" && (
            <span>
              {hasSelection
                ? settings.patchDirection === "destination"
                  ? "Drag the selected donor to the repair region. Escape cancels."
                  : "Drag toward the donor region; release to patch. Escape cancels."
                : "Create a marquee selection first (M)."}
            </span>
          )}
        </>
      )}
      {tool === "move" && (
        <>
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
          {moveTarget === "layer" && onSnapEnabled && (
            <label
              className="tool-snap-toggle"
              title="Snap to canvas edges, center and document guides; hold Alt to bypass"
            >
              <input
                type="checkbox"
                checked={snapEnabled}
                onChange={(event) => onSnapEnabled(event.target.checked)}
              />
              Snap to canvas and guides
            </label>
          )}
          {moveTarget === "layer" && snapEnabled && onSnapArtwork && (
            <label className="tool-snap-toggle">
              <input
                type="checkbox"
                checked={snapArtwork}
                onChange={(event) => onSnapArtwork(event.target.checked)}
              />
              Include artwork
            </label>
          )}
          {moveTarget === "mask" && (
            <span className="section-caption">
              Drag to move the selected mask · Arrow keys to nudge
            </span>
          )}
        </>
      )}
      {((brush && !tonal && tool !== "eraser" && tool !== "heal" && (!wet || settings.paintTarget==='layer')) ||
        (tool === "pen" && settings.penEditTarget === "layer") ||
        tool === "marquee" ||
        tool === "fill") && (
        <label className="tool-color">
          <PaletteColorInput
            label="Foreground color"
            value={settings.color}
            disabled={disabled}
            onChange={(color) => controller.configure({ color: color })}
          />
          <span>{settings.color.toUpperCase()}</span>
        </label>
      )}
      {(tool === "brush" || tool === "pencil" || tool === "eraser" || wet) &&
        (hasPaintMask || hasFilterMask || wet) && (
          <Select
            label="Paint target"
            value={settings.paintTarget}
            disabled={disabled}
            options={[
              { value: "layer", label: "Layer" },
              ...(hasPaintMask
                ? [
                    { value: "mask-hide", label: "Mask · Hide" },
                    { value: "mask-reveal", label: "Mask · Reveal" },
                  ]
                : []),
              ...(hasFilterMask
                ? [
                    { value: "filter-mask-hide", label: "Filter mask · Hide" },
                    {
                      value: "filter-mask-reveal",
                      label: "Filter mask · Reveal",
                    },
                  ]
                : []),
            ]}
            onChange={(value) =>
              controller.configure({
                paintTarget: value as ToolSettings["paintTarget"],
              })
            }
          />
        )}
      {wet && <><span className="section-caption">{settings.paintTarget==='layer'?'Edits layer pixels.':'Edits raw mask coverage; color is ignored. Hide/Reveal sets the initial foreground coverage.'}</span>{(["load","wetness","pickup"] as const).map(key=><Slider key={key} label={key==="load"?(settings.paintTarget==='layer'?"Initial foreground load":"Initial coverage load"):key==="wetness"?"Wetness":"Pickup"} suffix="%" value={settings[tool][key]*100} min={0} max={100} disabled={disabled||documentBusy} onPreview={value=>controller.configure({[tool]:{...settings[tool],[key]:value/100}})} onCommit={value=>controller.configure({[tool]:{...settings[tool],[key]:value/100}})}/>)}</>}
      {tonal && (
        <>
          <Select
            label="Tonal range"
            value={settings.tonalRange}
            disabled={disabled}
            options={[
              { value: "shadows", label: "Shadows" },
              { value: "midtones", label: "Midtones" },
              { value: "highlights", label: "Highlights" },
            ]}
            onChange={(value) =>
              controller.configure({
                tonalRange: value as ToolSettings["tonalRange"],
              })
            }
          />
          <Slider
            label="Exposure"
            suffix="%"
            value={settings.tonalExposure * 100}
            min={0}
            max={100}
            disabled={disabled}
            onPreview={(value) =>
              controller.configure({ tonalExposure: value / 100 })
            }
            onCommit={(value) =>
              controller.configure({ tonalExposure: value / 100 })
            }
          />
          <label className="check-field">
            <input
              type="checkbox"
              checked={settings.protectTones}
              disabled={disabled}
              onChange={(event) =>
                controller.configure({ protectTones: event.target.checked })
              }
            />
            Protect tones
          </label>
        </>
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
          {(wet || tonal || tool === "brush" || tool === "eraser") && (
            <Slider
              label="Flow"
              suffix="%"
              value={settings.flow * 100}
              min={1}
              max={100}
              disabled={disabled}
              onPreview={(v) => controller.configure({ flow: v / 100 })}
              onCommit={(v) => controller.configure({ flow: v / 100 })}
            />
          )}
          <Slider
            label="Spacing"
            suffix="%"
            value={settings.spacing * 100}
            min={1}
            max={1000}
            disabled={disabled}
            onPreview={(v) => controller.configure({ spacing: v / 100 })}
            onCommit={(v) => controller.configure({ spacing: v / 100 })}
          />
          <Slider
            label="Smoothing"
            suffix="%"
            value={settings.smoothing * 100}
            min={0}
            max={90}
            disabled={disabled}
            onPreview={(v) => controller.configure({ smoothing: v / 100 })}
            onCommit={(v) => controller.configure({ smoothing: v / 100 })}
          />
          {onBrushPresets&&<Button disabled={documentBusy} onClick={onBrushPresets}>Brush presets…</Button>}
          {onBrushSymmetry&&<Button disabled={documentBusy} onClick={onBrushSymmetry}>Symmetry…</Button>}
          {onBrushTip&&<Button disabled={documentBusy} onClick={onBrushTip}>Brush tip…</Button>}
          {onBrushTexture&&<Button disabled={documentBusy} onClick={onBrushTexture}>{settings.texture?'Texture on…':'Texture…'}</Button>}
          {onPressureCurve&&<Button disabled={disabled} onClick={onPressureCurve}>Pressure response…</Button>}
          <label className="check-field">
            <input
              type="checkbox"
              aria-label="Pressure controls size"
              checked={settings.pressureSize}
              onChange={(e) =>
                controller.configure({ pressureSize: e.target.checked })
              }
            />
            Pressure size
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              aria-label="Pressure controls opacity"
              checked={settings.pressureOpacity}
              onChange={(e) =>
                controller.configure({ pressureOpacity: e.target.checked })
              }
            />
            Pressure opacity
          </label>
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
      {tool === "pen" && hasVectorMask && (
        <Select
          label="Pen target"
          value={settings.penEditTarget}
          disabled={disabled}
          options={[
            { value: "layer", label: "Layer paths" },
            { value: "mask", label: "Mask paths" },
          ]}
          onChange={(value) =>
            controller.configure({ penEditTarget: value as "layer" | "mask" })
          }
        />
      )}
      {tool === "pen" && settings.penEditTarget === "mask" && (
        <div className="mask-contour-actions">
          {controller.drawingMaskContour ? (
            <>
              <button
                className="button subtle compact"
                disabled={disabled || !controller.maskContourPointCount}
                onClick={() => onAction(() => controller.finishPath())}
              >
                Close contour
              </button>
              <button
                className="button subtle compact"
                onClick={() => controller.cancel()}
              >
                Cancel contour
              </button>
            </>
          ) : (
            <>
              <button
                className="button subtle compact"
                disabled={disabled}
                onClick={() => onAction(() => controller.startMaskContour())}
              >
                New contour
              </button>
              <button
                className="button subtle compact"
                disabled={disabled || !controller.selectedMaskAnchor}
                onClick={() => onAction(() => controller.insertMaskAnchor())}
              >
                Insert midpoint
              </button>
            </>
          )}
        </div>
      )}
      {tool === "pen" && settings.penEditTarget === "layer" && (
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
          <button
            className="button subtle compact"
            disabled={disabled}
            onClick={() => onAction(() => controller.addShape("rectangle"))}
          >
            + Rectangle
          </button>
          <button
            className="button subtle compact"
            disabled={disabled}
            onClick={() => onAction(() => controller.addShape("ellipse"))}
          >
            + Ellipse
          </button>
          <button
            className="button subtle compact"
            disabled={disabled}
            onClick={() => onAction(() => controller.addShape("polygon"))}
          >
            + Polygon
          </button>
        </>
      )}
      {tool==='quick-select'&&<>
        <Slider label="Quick selection diameter" value={settings.quickSize} min={.5} max={512} step={.5} suffix="px" disabled={documentBusy} onPreview={value=>controller.configure({quickSize:value})} onCommit={value=>controller.configure({quickSize:value})}/>
        <Slider label="Color tolerance" value={settings.quickTolerance} min={0} max={255} step={1} disabled={documentBusy} onPreview={value=>controller.configure({quickTolerance:value})} onCommit={value=>controller.configure({quickTolerance:value})}/>
        <Slider label="Edge threshold" value={settings.quickEdgeThreshold} min={0} max={255} step={1} disabled={documentBusy} onPreview={value=>controller.configure({quickEdgeThreshold:value})} onCommit={value=>controller.configure({quickEdgeThreshold:value})}/>
        <Select label="Quick selection source" value={settings.quickSampling} disabled={documentBusy} options={[{value:'merged',label:'Visible composite'},{value:'layer',label:'Selected layer'}]} onChange={value=>controller.configure({quickSampling:value as ToolSettings['quickSampling']})}/>
        <Select label="Quick selection operation" value={settings.quickSelectionMode} disabled={documentBusy} options={['replace','add','subtract','intersect']} onChange={value=>controller.configure({quickSelectionMode:value as ToolSettings['quickSelectionMode']})}/>
        {controller.getSnapshot().quickSelectionProgress&&<>
          <progress aria-label="Quick Selection progress" max={controller.getSnapshot().quickSelectionProgress!.total} value={controller.getSnapshot().quickSelectionProgress!.completed}/>
          <button type="button" className="button subtle compact" onClick={()=>controller.cancel()}>Cancel Quick Selection</button>
        </>}
      </>}
      {tool === "wand" && <>
        <Slider label="Wand tolerance" value={settings.wandTolerance} min={0} max={255} step={1}
          onPreview={value => controller.configure({ wandTolerance: value })} onCommit={value => controller.configure({ wandTolerance: value })} />
        <label><input type="checkbox" checked={settings.wandContiguous} onChange={event => controller.configure({ wandContiguous: event.target.checked })} /> Contiguous</label>
      <span className="tool-hint">Sample selected image · Shift adds · Alt subtracts</span>
      </>}
      {(tool === "marquee" || tool === "wand" || tool === "lasso") && (
        <>
          {tool === "lasso" && <>
            <select
              aria-label="Lasso mode"
              value={settings.lassoMode}
              disabled={documentBusy}
              onChange={event => controller.configure({ lassoMode: event.target.value as ToolSettings["lassoMode"] })}
            >
              <option value="freeform">Freeform</option>
              <option value="polygon">Polygonal</option>
            </select>
            {settings.lassoMode === "polygon" && <button
              type="button"
              className="button subtle compact"
              disabled={documentBusy || controller.polygonLassoPointCount < 3}
              onClick={() => onAction(() => controller.finishPolygonLasso())}
            >Finish selection</button>}
          </>}
          {tool === "marquee" && <select
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
          </select>}
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
      {onColorRange&&['move','marquee','lasso','wand'].includes(tool)&&<button type="button" className="button subtle compact" disabled={documentBusy} onClick={onColorRange}>Color Range…</button>}
      {hasSelection && tool !== "crop" && (
        <button type="button" className="button subtle compact" disabled={documentBusy} onClick={onModifySelection}>Modify selection…</button>
      )}
      {hasSelection && tool !== "crop" && (
        <button
          className="button subtle compact"
          disabled={disabled}
          onClick={() => onAction(() => controller.fillSelection())}
        >
          Fill selection
        </button>
      )}
      {tool === "crop" && (
        <div className="crop-actions">
          <button
            className="button subtle compact"
            disabled={documentBusy}
            onClick={() => onAction(() => controller.crop.start(null))}
          >
            New frame
          </button>
          <button
            className="button subtle compact"
            disabled={documentBusy}
            onClick={onOpenCrop}
          >
            Precise bounds…
          </button>
          <button
            className="button primary compact"
            disabled={documentBusy || !controller.crop.bounds}
            onClick={() => onAction(() => controller.crop.apply())}
          >
            Apply crop
          </button>
          <button
            className="button subtle compact"
            disabled={documentBusy || !controller.crop.active}
            onClick={() => controller.cancel()}
          >
            Cancel crop
          </button>
        </div>
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
        {onOpenImageSize && <button type="button" className="button subtle compact" disabled={documentBusy} onClick={onOpenImageSize}>Image size…</button>}
      <span className="tool-hint">
        {tool==='quick-select'?'Paint inside the region · Release to grow along colors/edges · Alt subtracts · Esc cancels':tool === "lasso" ? settings.lassoMode === "polygon"
          ? "Click corners · Click the first corner or Enter to finish · Backspace removes a corner · Esc cancels"
          : "Drag to select · Shift adds · Alt subtracts · Shift+Alt intersects · Esc cancels" : tool === "crop"
          ? "Drag a frame or its handles · Enter applies · Esc cancels · Shift constrains corners"
          : tool === "artboard"
            ? "Change canvas bounds without scaling artwork"
            : tool === "text"
              ? "Click on the canvas to place a text layer"
              : tool === "move"
                ? "Drag artwork or layer rows"
                : tool === "hand"
                  ? "Drag to pan · Scroll to zoom"
                  : tool === "clone"
                    ? "Alt/Option-click to sample"
                    : tool === "pen"
                      ? settings.penEditTarget === "mask"
                        ? controller.drawingMaskContour
                          ? "Click/drag anchors · Enter or first anchor closes · Esc cancels"
                          : "Click curve to add · Alt frees handles · Arrows nudge"
                        : "Click anchors · Drag curves · Click start to close"
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
  anchorCount,
  disabled,
  onAction,
  onPreview,
  previewStrokeWidth,
  previewGradient,
}: {
  layer: VectorLayer;
  path: VectorPath | null;
  anchorCount: number;
  disabled: boolean;
  onAction(action: () => void): void;
  onPreview(command: EditorCommand): void;
  previewStrokeWidth?: number;
  previewGradient?:VectorGradientData|null;
}) {
  if (!path)
    return (
      <InspectorSection title="Vector paths">
        <p className="section-description">
          Choose the Pen tool to draw a path.
        </p>
      </InspectorSection>
    );
  return (
    <InspectorSection
      title="Vector path"
      badge={
        <span className="section-caption">{layer.paths.length} PATHS</span>
      }
    >
      <label className="check-field">
        <input
          type="checkbox"
          aria-label="Closed path"
          checked={path.closed}
          disabled={disabled || path.subpaths.length > 0}
          onChange={(e) =>
            onAction(() => {
              path.closed = e.target.checked;
            })
          }
        />
        Closed path
      </label>
      <Select label="Path fill rule" value={path.fillRule} options={["nonzero", "evenodd"]} disabled={disabled} onChange={value => onAction(() => { path.fillRule = value as "nonzero" | "evenodd"; })} />
      {path.subpaths.length > 0 && <details><summary>{path.subpaths.length + 1} editable contours</summary>
        <p className="section-description">Use the Pen tool to move any contour's anchors and handles. All contours share this path's paint.</p>
        {[...path.subpaths].map((contour, index) => <Button key={contour.id} variant="subtle" size="sm" disabled={disabled} onClick={() => onAction(() => contour.remove())}>Remove contour {index + 2}</Button>)}
      </details>}
      <div className="style-color-row">
        <label className="check-field">
          <input
            type="checkbox"
            aria-label="Path fill enabled"
            checked={!!(path.fill||path.fillGradient)}
            disabled={disabled}
            onChange={(e) =>
              onAction(() => {
                path.update({fill:e.target.checked?"#d5e79b":null,fillGradient:null});
              })
            }
          />
          Fill
        </label>
        <PaletteColorInput
          label="Path fill color"
          value={path.fill ?? "#d5e79b"}
          disabled={disabled || !path.fill || !!path.fillGradient}
          onChange={(color) =>
            onAction(() => {
              path.fill = color;
            })
          }
        />
      </div>
      <VectorGradientControls key={`gradient:${path.id}`} path={path} disabled={disabled} onAction={onAction} previewGradient={previewGradient} onPreview={fillGradient=>onPreview({type:"path.update",id:layer.id,pathId:path.id,patch:{fillGradient}})}/>
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
        <PaletteColorInput
          label="Path stroke color"
          value={path.stroke ?? "#d5e79b"}
          disabled={disabled || !path.stroke}
          onChange={(color) =>
            onAction(() => {
              path.stroke = color;
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
        onPreview={(value) =>
          onPreview({
            type: "path.update",
            id: layer.id,
            pathId: path.id,
            patch: { strokeWidth: value },
          })
        }
        onCommit={(value) =>
          onAction(() => {
            path.strokeWidth = value;
          })
        }
      />
      <VectorStrokeControls key={`stroke:${path.id}`} path={path} disabled={disabled} onAction={onAction}/>
      <p className="section-description">
        {anchorCount} anchors · Pen tool moves anchors and handles.
        Alt/Option moves one handle independently.
      </p>
      <button
        className="button subtle compact"
        disabled={disabled}
        onClick={() => onAction(() => path.remove())}
      >
        Delete path
      </button>
    </InspectorSection>
  );
}
