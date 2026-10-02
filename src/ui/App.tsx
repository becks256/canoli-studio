import { PanelResizeHandle } from "./PanelResizeHandle";
import { usePanelLayout } from "./hooks/usePanelLayout";
import { ShortcutHints } from "./ShortcutHints";
import {
  readShortcutBindings,
  resolveShortcutBindings,
  saveShortcutBindings,
  type ShortcutOverrides,
} from "./shortcut-bindings";
import { CanvasRulers } from "./CanvasRulers";
import { GuideOverlay } from "./GuideOverlay";
import { artworkSnapBounds, snapToCanvas } from "../core/snapping";
import { AffineTransform } from "../core/affine";
import { useDocumentViewport } from "./hooks/useDocumentViewport";
import { DocumentTabBar } from "./DocumentTabBar";
import { flushSync } from "react-dom";
import { CommandPalette } from "./CommandPalette";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronRight,
  ImagePlus,
  Maximize,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { EditorApplication } from "../editor";
import { AdjustmentLayer, LayerGroup, PaintLayer, TextLayer } from "../dom";
import {
  defaultCurvesAdjustment,
  defaultHslAdjustment,
  defaultLevelsAdjustment,
  defaultToneAdjustment,
} from "../core/adjustments";
import { execute } from "../core/commands";
import type { LayerMaskData } from "../core/masks";
import type { EditorCommand, LayerPatch } from "../core/commands";
import { allLayers, findLayer, findParent, isLocked } from "../core/model";
import {
  hitTest,
  layerBounds,
  unionBounds,
  parentSpaceDelta,
  layerTransform,
  localTransform,
  parentId,
} from "../core/spatial";
import {
  ShortcutRegistry,
  SHORTCUT_BINDINGS,
  TOOL_SHORTCUTS,
  brushSizeKeys,
  nudgeKeys,
} from "./shortcuts";
import { Button, IconButton } from "./controls";
import { CropOverlay } from "./CropOverlay";
import type { CropHandle } from "../crop-controller";
import { CropDialog } from "./CropDialog";
import { ArtboardDialog } from "./ArtboardDialog";
import { ExportDialog } from "./ExportDialog";
import { GenerateAssetDialog } from "./GenerateAssetDialog";
import { RecipeDialog } from "./RecipeDialog";
import { BatchRunnerDialog } from "./BatchRunnerDialog";
import { ColorProfileDialog } from "./ColorProfileDialog";
import { PsdImportDialog } from "./PsdImportDialog";
import { RefineEdgeDialog } from "./RefineEdgeDialog";
import {
  parsePsd,
  getPsdCapabilityReport,
} from "../core/interchange/psd/parser";
import type {
  PsdParsedDocument,
  PsdCapabilityReport,
} from "../core/interchange/psd/types";
import { STANDARD_PROFILES } from "../core/color/icc";
import type { GenerationCandidate } from "../ai/jobs/types";
import { ScriptPanel } from "./ScriptPanel";
import { PluginPanel } from "./PluginPanel";
import { ToolOptions } from "./ToolOptions";
import { TypographyPanel, TextProperties } from "./TypographyPanel";
import { ShortcutDialog } from "./ShortcutDialog";
import { TopBar } from "./TopBar";
import { ToolRail } from "./ToolRail";
import { LayersPanel } from "./LayersPanel";
import { InspectorPanel } from "./InspectorPanel";
import { CanvasOverlays } from "./CanvasOverlays";
import { CanvasContextMenu } from "./CanvasContextMenu";
import {
  useCanvasRenderer,
  useEditorShortcuts,
  useUnsavedChangesWarning,
  useViewportObserver,
  useWasmReady,
  useWheelZoom,
} from "./hooks";
import {
  calculateFitZoom,
  canvasPoint,
  computeResizePatch,
  computeVisibleRegion,
  download,
  fileName,
  modifiers,
} from "./utils";
import type { Point } from "../core/drawing";
import type { Tool } from "../tools";

import { RecoveryPanel } from "./RecoveryPanel";

export { TextProperties, TypographyPanel };

export function App({ editor }: { editor: EditorApplication }) {
  const {
    document: dom,
    state,
    assets,
    sessions,
    sessionId,
    savedRevision,
    smartObjectEdit,
  } = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const recoveryState = useSyncExternalStore(
    editor.recovery.subscribe,
    editor.recovery.getSnapshot,
  );
  const [showRecovery, setShowRecovery] = useState(false);
  const backendState = useSyncExternalStore(
    editor.renderer.subscribeBackend,
    editor.renderer.getBackendSnapshot,
  );
  const [preview, setPreview] = useState<EditorCommand | null>(null);
  const [tool, setTool] = useState<Tool>("move");
  const [guidesVisible, setGuidesVisible] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapArtwork, setSnapArtwork] = useState(false);
  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>({});
  useEffect(() => {
    if (!preview) setSnapGuides({});
  }, [preview]);
  const [moveTarget, setMoveTarget] = useState<"layer" | "mask">("layer");
  const selectedMaskKind = findLayer(state.document, state.selectedId)?.mask
    ?.kind;
  const filterMaskTarget = findLayer(state.document, state.selectedId);
  const selectedFilterMaskKind =
    filterMaskTarget?.kind === "smart-object"
      ? filterMaskTarget.filterMask?.kind
      : undefined;
  useEffect(() => {
    setMoveTarget("layer");
    editor.tools.configure({ paintTarget: "layer", penEditTarget: "layer" });
  }, [editor, dom, state.selectedId, selectedMaskKind, selectedFilterMaskKind]);
  useEffect(() => {
    if (editor.tools.drawingMaskContour || editor.tools.crop.active)
      editor.tools.cancel();
  }, [editor, dom, state.revision]);
  const toolSizes = useRef({ brush: 24, pencil: 1, eraser: 24 });
  const toolState = useSyncExternalStore(
    editor.tools.subscribe,
    editor.tools.getSnapshot,
  );
  const [cursor, setCursor] = useState<Point | null>(null);
  const pendingCursor = useRef<Point | null>(null);
  const cursorFrame = useRef<number | null>(null);
  function updateCursor(point: Point | null) {
    pendingCursor.current = point;
    if (cursorFrame.current === null)
      cursorFrame.current = requestAnimationFrame(() => {
        cursorFrame.current = null;
        setCursor(pendingCursor.current);
      });
  }
  const [spacePan, setSpacePan] = useState(false);
  const {
    zoom,
    pan,
    setZoom,
    setPan,
    initialize: initializeViewport,
  } = useDocumentViewport(
    editor.documentSessions.find((session) => session.document === dom)!,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelLayout = usePanelLayout(setError);
  const [showPalette, setShowPalette] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [shortcutPreferences, setShortcutPreferences] = useState<{
    bindings: ShortcutOverrides;
    error?: string;
  }>(() => {
    try {
      return { bindings: readShortcutBindings(localStorage) };
    } catch (error) {
      return { bindings: {}, error: String(error) };
    }
  });
  const [showScripts, setShowScripts] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showArtboardDialog, setShowArtboardDialog] = useState(false);
  const [showCropDialog, setShowCropDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showRecipeDialog, setShowRecipeDialog] = useState(false);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [showColorDialog, setShowColorDialog] = useState(false);
  const [showRefineEdgeDialog, setShowRefineEdgeDialog] = useState(false);
  const [psdPreflight, setPsdPreflight] = useState<{
    fileName: string;
    buffer: Uint8Array;
    parsed: PsdParsedDocument;
    report: PsdCapabilityReport;
  } | null>(null);
  const [generateDialogModality, setGenerateDialogModality] = useState<
    "text-to-image" | "cutout" | "texture" | "masked-edit"
  >("text-to-image");
  const [previewCandidate, setPreviewCandidate] =
    useState<GenerationCandidate | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const savedStamp = `${dom.id}:${savedRevision}`;
  const [resizingCursor, setResizingCursor] = useState<"nwse" | "nesw" | null>(
    null,
  );
  const importInput = useRef<HTMLInputElement>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const psdInputRef = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const displayHost = useRef<HTMLDivElement>(null);
  const capturedPointer = useRef<number | null>(null);
  const gesture = useRef<
    | null
    | { kind: "pan"; startX: number; startY: number; x: number; y: number }
    | {
        kind: "move";
        snapTargets?: { x: number; y: number; width: number; height: number }[];
        mask?: LayerMaskData;
        members?: { id: string; x: number; y: number }[];
        revision: number;
        documentId: string;
        startX: number;
        startY: number;
        x: number;
        y: number;
        id: string;
        dx: number;
        dy: number;
      }
    | {
        kind: "rotate" | "scale-selection";
        initialVector?: { x: number; y: number };
        center: { x: number; y: number };
        startAngle: number;
        members: {
          id: string;
          world: AffineTransform;
          parentInverse: AffineTransform;
          patch: LayerPatch;
        }[];
        revision: number;
        documentId: string;
      }
    | {
        kind: "resize";
        revision: number;
        documentId: string;
        handle: "nw" | "ne" | "sw" | "se";
        startX: number;
        startY: number;
        layerX: number;
        layerY: number;
        layerWidth: number;
        layerHeight: number;
        layerFontSize?: number;
        layerText?: string;
        layerFontFamily?: string;
        layerLineHeight?: number;
        id: string;
        layerKind: "raster" | "text";
        patch: LayerPatch;
      }
  >(null);
  useEffect(() => {
    const drag = gesture.current;
    if (
      drag &&
      drag.kind !== "pan" &&
      (drag.documentId !== dom.id || drag.revision !== state.revision)
    ) {
      gesture.current = null;
      setPreview(null);
      setSnapGuides({});
      setResizingCursor(null);
    }
  }, [dom.id, state.revision]);
  const activePreview = toolState.preview ?? preview;
  const viewDocument = useMemo(() => {
    if (!activePreview) return state.document;
    try {
      return execute(state.document, activePreview);
    } catch {
      return state.document;
    }
  }, [state.document, activePreview]);
  const selected = findLayer(viewDocument, state.selectedId);
  const movingMask =
    tool === "move" && moveTarget === "mask" && !!selected?.mask;
  const selectedObject = dom.getLayer(state.selectedId);
  const locked = selected ? isLocked(viewDocument, selected.id) : false;
  const isResizable = selected
    ? !locked && (selected.kind === "raster" || selected.kind === "text")
    : false;
  const bounds =
    state.selectedIds.length > 1
      ? unionBounds(
          state.selectedIds.flatMap((id) => {
            const b = layerBounds(viewDocument, id);
            return b ? [b] : [];
          }),
        )
      : selected
        ? layerBounds(viewDocument, selected.id)
        : undefined;
  const canRotateSelection =
    dom.layerSelection.rootLayers.length > 0 &&
    dom.layerSelection.rootLayers.every(
      (layer) =>
        !isLocked(viewDocument, layer.id) &&
        !!layerBounds(viewDocument, layer.id),
    );
  function resizeHandleStyle(right: boolean, bottom: boolean) {
    if (state.selectedIds.length > 1) return undefined;
    if (
      !bounds ||
      !selected ||
      (selected.kind !== "raster" && selected.kind !== "text")
    )
      return undefined;
    const corner = layerTransform(viewDocument, selected.id)!.point({
      x: right ? selected.width : 0,
      y: bottom ? selected.height : 0,
    });
    return {
      left: (corner.x - bounds.x) * zoom - 5,
      top: (corner.y - bounds.y) * zoom - 5,
      right: "auto",
      bottom: "auto",
    };
  }
  const stamp = `${dom.id}:${state.revision}`;
  const renderRegion = useMemo(() => {
    return computeVisibleRegion(
      { width: viewDocument.width, height: viewDocument.height },
      viewportSize,
      pan,
      zoom,
    );
  }, [viewDocument.width, viewDocument.height, viewportSize, zoom, pan]);

  function chooseTool(next: Tool) {
    editor.tools.cancel();
    setPreview(null);
    updateCursor(null);
    if (tool === "pencil")
      toolSizes.current.pencil = editor.tools.getSnapshot().settings.size;
    else if (tool === "eraser")
      toolSizes.current.eraser = editor.tools.getSnapshot().settings.size;
    else if (["brush", "clone", "heal", "dodge", "burn"].includes(tool))
      toolSizes.current.brush = editor.tools.getSnapshot().settings.size;
    if (next === "pencil")
      editor.tools.configure({ size: toolSizes.current.pencil });
    else if (next === "eraser")
      editor.tools.configure({ size: toolSizes.current.eraser });
    else if (["brush", "clone", "heal", "dodge", "burn"].includes(next))
      editor.tools.configure({ size: toolSizes.current.brush });
    if (next === "crop") editor.tools.crop.start();
    if (next === "artboard") {
      setShowArtboardDialog(true);
    }
    setMoveTarget("layer");
    setTool(next);
  }
  function notify(text: string) {
    setMessage(text);
    setTimeout(
      () => setMessage((current) => (current === text ? null : current)),
      2800,
    );
  }
  function attempt(action: () => void) {
    try {
      action();
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The operation failed.",
      );
    }
  }
  async function task(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setPreview(null);
    try {
      await action();
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The operation failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const startupRestore = useRef(false);
  useEffect(() => {
    if (startupRestore.current) return;
    startupRestore.current = true;
    void task(async () => {
      if (await editor.initializeWorkspaceRecovery())
        notify("Saved workspace restored.");
    });
  }, [editor]);

  function fit() {
    const box = viewport.current?.getBoundingClientRect();
    if (!box) return;
    setZoom(calculateFitZoom(dom, box));
    setPan({ x: 0, y: 0 });
  }
  function changeZoom(factor: number) {
    setZoom((current) =>
      Math.max(Number.MIN_VALUE, Math.min(4, current * factor)),
    );
  }
  function clearPreview() {
    editor.tools.cancel();
    setPreview(null);
  }
  function selectedAction(
    action: (layer: NonNullable<typeof selectedObject>) => void,
  ) {
    if (selectedObject)
      attempt(() => {
        clearPreview();
        action(selectedObject);
      });
  }
  function save() {
    const name = dom.name;
    void task(async () => {
      download(await editor.saveProject(), `${fileName(name)}.luma`);
      notify("Project downloaded. Keep this file to reopen your edits.");
    });
  }
  function exportPng() {
    void task(async () => {
      download(await editor.exportPng(), `${fileName(dom.name)}.png`);
      notify("PNG exported");
    });
  }
  function addLayer() {
    attempt(() => {
      const existingNames = new Set(
        allLayers(dom.toJSON().children).map((l) => l.name),
      );
      let index = 1;
      while (existingNames.has(`Layer ${index}`)) index++;
      const layer = new PaintLayer({ name: `Layer ${index}` });
      dom.transaction("New layer", () => {
        const selected = dom.selectedLayer;
        if (selected instanceof LayerGroup) {
          selected.layers.add(layer);
        } else if (selected) {
          const parent = findParent(dom.toJSON().children, selected.id);
          if (parent) {
            const parentGroup = dom.getLayer(parent) as LayerGroup;
            parentGroup.layers.add(layer);
          } else {
            dom.layers.add(layer);
          }
          layer.moveAfter(selected);
        } else {
          dom.layers.add(layer);
        }
      });
      dom.selectedLayer = layer;
    });
  }
  function addGroup() {
    attempt(() => {
      const selected = dom.selectedLayer;
      const group = new LayerGroup({ name: "Group" });
      dom.transaction("Group layers", () => {
        dom.layers.add(group);
        if (selected) selected.moveTo(group);
      });
      dom.selectedLayer = group;
    });
  }
  function addAdjustmentLayer(
    kind: "curves" | "levels" | "tone" | "hsl" = "curves",
  ) {
    attempt(() => {
      const existingNames = new Set(
        allLayers(dom.toJSON().children).map((l) => l.name),
      );
      const prefix =
        kind === "curves"
          ? "Curves"
          : kind === "levels"
            ? "Levels"
            : kind === "hsl"
              ? "HSL"
              : "Tone";
      let index = 1;
      while (existingNames.has(`${prefix} ${index}`)) index++;
      const layer = new AdjustmentLayer({
        name: `${prefix} ${index}`,
        adjustment:
          kind === "curves"
            ? defaultCurvesAdjustment()
            : kind === "levels"
              ? defaultLevelsAdjustment()
              : kind === "hsl"
                ? defaultHslAdjustment()
                : defaultToneAdjustment(),
      });
      clearPreview();
      dom.transaction(`New ${prefix.toLowerCase()} adjustment layer`, () => {
        const selected = dom.selectedLayer;
        if (selected instanceof LayerGroup) {
          selected.layers.add(layer);
        } else if (selected) {
          const parent = findParent(dom.toJSON().children, selected.id);
          if (parent) {
            const parentGroup = dom.getLayer(parent) as LayerGroup;
            parentGroup.layers.add(layer);
          } else {
            dom.layers.add(layer);
          }
          layer.moveAfter(selected);
        } else {
          dom.layers.add(layer);
        }
      });
      dom.selectedLayer = layer;
    });
  }
  function nudge(x: number, y: number) {
    if (tool === "move" && !movingMask && dom.selectedLayers.length > 0) {
      attempt(() => dom.layerSelection.translate(x, y));
      return;
    }
    if (tool === "crop") {
      attempt(() => editor.tools.crop.nudge(x, y));
      return;
    }
    if (tool === "pen" && toolState.settings.penEditTarget === "mask") {
      attempt(() => editor.tools.nudgeMaskPoint(x, y));
      return;
    }
    selectedAction((layer) => {
      if (movingMask && layer.mask) {
        layer.update(
          movePatch({
            id: layer.id,
            x: layer.mask.x,
            y: layer.mask.y,
            dx: x,
            dy: y,
            mask: layer.mask.toJSON(),
          }),
        );
      } else {
        const delta = parentSpaceDelta(dom.toJSON(), layer.id, { x, y });
        layer.update({ x: layer.x + delta.x, y: layer.y + delta.y });
      }
    });
  }

  const defaultShortcuts = new ShortcutRegistry([
    {
      id: "command-palette",
      label: "Find a command",
      keys: SHORTCUT_BINDINGS["command-palette"],
      run: () => setShowPalette(true),
    },
    {
      id: "plugins",
      label: "Open plugins",
      keys: SHORTCUT_BINDINGS.plugins,
      run: () => setShowPlugins(true),
    },
    {
      id: "move",
      label: "Move tool",
      keys: SHORTCUT_BINDINGS["move"],
      run: () => chooseTool("move"),
    },
    {
      id: "hand",
      label: "Hand tool",
      keys: SHORTCUT_BINDINGS["hand"],
      run: () => chooseTool("hand"),
    },
    ...TOOL_SHORTCUTS.map(([key, label, binding]) => ({
      id: key,
      label,
      keys: [binding],
      run: () => chooseTool(key),
    })),
    {
      id: "select-all",
      label: "Select canvas",
      keys: SHORTCUT_BINDINGS["select-all"],
      run: () => attempt(() => dom.selectAll()),
    },
    {
      id: "deselect",
      label: "Deselect pixels",
      keys: SHORTCUT_BINDINGS["deselect"],
      run: () => attempt(() => dom.deselect()),
    },
    {
      id: "finish-path",
      label: tool === "crop" ? "Apply crop" : "Finish path",
      keys: SHORTCUT_BINDINGS["finish-path"],
      run: () =>
        attempt(() =>
          tool === "crop"
            ? editor.tools.crop.apply()
            : editor.tools.finishPath(),
        ),
      enabled: () => tool === "pen" || tool === "crop",
    },
    ...([-1, 1] as const).map((direction) => ({
      id: `brush-size-${direction}`,
      label: `${direction < 0 ? "Decrease" : "Increase"} brush size`,
      keys: brushSizeKeys(direction),
      run: () =>
        editor.tools.configure({
          size: Math.max(
            1,
            Math.min(
              2048,
              toolState.settings.size +
                direction *
                  Math.max(1, Math.round(toolState.settings.size / 10)),
            ),
          ),
        }),
      enabled: () =>
        [
          "brush",
          "pencil",
          "clone",
          "eraser",
          "heal",
          "dodge",
          "burn",
        ].includes(tool),
    })),
    {
      id: "import",
      label: "Import image",
      keys: SHORTCUT_BINDINGS["import"],
      run: () => importInput.current?.click(),
    },
    {
      id: "open",
      label: "Open project",
      keys: SHORTCUT_BINDINGS["open"],
      run: () => openInput.current?.click(),
    },
    {
      id: "save",
      label: "Save project",
      keys: SHORTCUT_BINDINGS["save"],
      run: save,
    },
    {
      id: "export",
      label: "Export document",
      keys: SHORTCUT_BINDINGS["export"],
      run: () => setShowExportDialog(true),
    },
    {
      id: "undo",
      label: "Undo",
      keys: SHORTCUT_BINDINGS["undo"],
      run: () => {
        clearPreview();
        dom.undo();
      },
      enabled: () => dom.canUndo,
    },
    {
      id: "redo",
      label: "Redo",
      keys: SHORTCUT_BINDINGS["redo"],
      run: () => {
        clearPreview();
        dom.redo();
      },
      enabled: () => dom.canRedo,
    },
    {
      id: "duplicate",
      label: "Duplicate layer",
      keys: SHORTCUT_BINDINGS["duplicate"],
      run: () =>
        selectedAction((layer) => {
          dom.selectedLayer = layer.duplicate();
        }),
      enabled: () => !!selected && !locked,
    },
    {
      id: "delete",
      label: tool === "crop" ? "Clear crop frame" : "Delete layer",
      keys: SHORTCUT_BINDINGS["delete"],
      run: () =>
        attempt(() => {
          if (tool === "crop") {
            editor.tools.crop.start(null);
            return;
          }
          if (tool === "pen" && editor.tools.removeLastAnchor()) return;
          if (dom.selection && selectedObject instanceof PaintLayer)
            editor.tools.fillSelection(true);
          else if (dom.selectedLayers.length > 1) dom.layerSelection.remove();
          else selectedObject?.remove();
        }),
      enabled: () => tool === "crop" || (!!selected && !locked),
    },
    ...(["curves", "levels", "tone", "hsl"] as const).map((kind) => ({
      id: `new-${kind}-adjustment`,
      label: `New ${kind === "hsl" ? "HSL (Hue / Saturation / Lightness)" : kind[0].toUpperCase() + kind.slice(1)} adjustment layer`,
      keys: [],
      run: () => addAdjustmentLayer(kind),
      enabled: () => !busy && !locked,
    })),
    {
      id: "new-layer",
      label: "New layer",
      keys: SHORTCUT_BINDINGS["new-layer"],
      run: addLayer,
    },
    {
      id: "group",
      label: "Group selection",
      keys: SHORTCUT_BINDINGS["group"],
      run: addGroup,
      enabled: () => !locked,
    },
    {
      id: "up",
      label: "Bring layer forward",
      keys: SHORTCUT_BINDINGS["up"],
      run: () => selectedAction((layer) => layer.moveUp()),
      enabled: () => !!selected && !locked,
    },
    {
      id: "down",
      label: "Send layer backward",
      keys: SHORTCUT_BINDINGS["down"],
      run: () => selectedAction((layer) => layer.moveDown()),
      enabled: () => !!selected && !locked,
    },
    ...(["Left", "Right", "Up", "Down"] as const).flatMap((direction) =>
      [1, 10].map((distance) => ({
        id: `nudge-${direction}-${distance}`,
        label: `Nudge ${direction.toLowerCase()} ${distance}px`,
        keys: nudgeKeys(direction, distance),
        run: () =>
          nudge(
            direction === "Left"
              ? -distance
              : direction === "Right"
                ? distance
                : 0,
            direction === "Up"
              ? -distance
              : direction === "Down"
                ? distance
                : 0,
          ),
        enabled: () =>
          tool === "crop" ? !!editor.tools.crop.bounds : !!selected && !locked,
      })),
    ),
    {
      id: "fit",
      label: "Fit canvas",
      keys: SHORTCUT_BINDINGS["fit"],
      run: fit,
    },
    {
      id: "actual",
      label: "Actual size",
      keys: SHORTCUT_BINDINGS["actual"],
      run: () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      },
    },
    {
      id: "zoom-in",
      label: "Zoom in",
      keys: SHORTCUT_BINDINGS["zoom-in"],
      run: () => changeZoom(1.2),
    },
    {
      id: "zoom-out",
      label: "Zoom out",
      keys: SHORTCUT_BINDINGS["zoom-out"],
      run: () => changeZoom(1 / 1.2),
    },
    {
      id: "scripts",
      label: "Open scripts",
      keys: SHORTCUT_BINDINGS["scripts"],
      run: () => setShowScripts(true),
    },
    {
      id: "recipes",
      label: "Recipes & Automation",
      keys: SHORTCUT_BINDINGS["recipes"],
      run: () => {
        if (!busy) setShowRecipeDialog(true);
      },
    },
    {
      id: "batch",
      label: "Batch Runner & Delivery",
      keys: SHORTCUT_BINDINGS["batch"],
      run: () => {
        if (!busy) setShowBatchDialog(true);
      },
    },
    {
      id: "generate",
      label: "Generate asset as layer",
      keys: SHORTCUT_BINDINGS["generate"],
      run: () => {
        if (!busy) setShowGenerateDialog(true);
      },
    },
    {
      id: "colorSettings",
      label: "Color settings & soft-proofing",
      keys: SHORTCUT_BINDINGS["colorSettings"],
      run: () => {
        if (!busy) setShowColorDialog(true);
      },
    },
    {
      id: "psd",
      label: "Import PSD / PSB",
      keys: SHORTCUT_BINDINGS["psd"],
      run: () => {
        if (!busy) psdInputRef.current?.click();
      },
    },
    {
      id: "refineEdge",
      label: "Refine edge",
      keys: SHORTCUT_BINDINGS["refineEdge"],
      run: () => {
        if (!busy) setShowRefineEdgeDialog(true);
      },
    },
    {
      id: "selectSubject",
      label: "Select subject",
      keys: SHORTCUT_BINDINGS["selectSubject"],
      run: () => {
        if (!busy) {
          void task(async () => {
            await editor.selectSubject();
            notify("Subject selected");
          });
        }
      },
    },
    {
      id: "help",
      label: "Keyboard shortcuts",
      keys: SHORTCUT_BINDINGS["help"],
      run: () => setShowHelp(true),
    },
  ]);
  const bindingSignature = JSON.stringify(
    defaultShortcuts.actions.map(({ id, keys }) => [id, keys]),
  );
  const resolvedBindings = useMemo(() => {
    try {
      const actions = resolveShortcutBindings(
        defaultShortcuts.actions,
        shortcutPreferences.bindings,
      );
      return {
        keys: Object.fromEntries(
          actions.map((action) => [action.id, action.keys]),
        ),
        error: undefined,
      };
    } catch (error) {
      return { keys: {} as ShortcutOverrides, error: String(error) };
    }
  }, [shortcutPreferences.bindings, bindingSignature]);
  const shortcuts = new ShortcutRegistry(
    defaultShortcuts.actions.map((action) => ({
      ...action,
      keys: resolvedBindings.keys[action.id] ?? action.keys,
    })),
  );
  const activeOverrides = resolvedBindings.error
    ? {}
    : shortcutPreferences.bindings;
  function changeShortcut(id: string, keys: string[] | null) {
    const next = { ...activeOverrides };
    if (keys === null) delete next[id];
    else next[id] = keys;
    setShortcutPreferences({
      bindings: saveShortcutBindings(
        localStorage,
        defaultShortcuts.actions,
        next,
      ),
    });
  }
  function resetShortcuts() {
    setShortcutPreferences({
      bindings: saveShortcutBindings(
        localStorage,
        defaultShortcuts.actions,
        {},
      ),
    });
  }
  const wasmReady = useWasmReady(editor, setError);

  useUnsavedChangesWarning(dom, stamp, savedStamp, editor.hasUnsavedDocuments);

  useWheelZoom(viewport, (factor) => changeZoom(factor));

  useViewportObserver({
    viewportRef: viewport,
    dom,
    onResize: setViewportSize,
    onFit: () => initializeViewport(fit),
    onClearPreview: () => setPreview(null),
  });

  useEditorShortcuts({
    shortcuts,
    editor,
    busy,
    modalOpen:
      showRecovery ||
      showPalette ||
      showHelp ||
      showScripts ||
      showPlugins ||
      showArtboardDialog ||
      showCropDialog ||
      showExportDialog ||
      showGenerateDialog ||
      showRecipeDialog ||
      showBatchDialog ||
      showColorDialog ||
      showRefineEdgeDialog ||
      !!psdPreflight,
    onDismissModals: () => {
      setShowRecovery(false);
      setShowPalette(false);
      setShowHelp(false);
      setShowScripts(false);
      setShowPlugins(false);
      setShowArtboardDialog(false);
      setShowCropDialog(false);
      setShowExportDialog(false);
      setShowGenerateDialog(false);
      setShowRecipeDialog(false);
      setShowBatchDialog(false);
      setShowColorDialog(false);
      setShowRefineEdgeDialog(false);
      setPsdPreflight(null);
      setPreviewCandidate(null);
    },
    onSetSpacePan: setSpacePan,
    onClearPreview: clearPreview,
    onResetGestures: () => {
      capturedPointer.current = null;
      gesture.current = null;
      setResizingCursor(null);
    },
  });

  const { rendering, renderBackend, paintedRegion } = useCanvasRenderer({
    editor,
    viewDocument,
    assets,
    renderRegion,
    zoom,
    paintPreview: toolState.paintPreview,
    backendState,
    displayHost,
    onCleanupCursor: () => {
      if (cursorFrame.current !== null)
        cancelAnimationFrame(cursorFrame.current);
    },
    onError: setError,
  });

  function toCanvasPoint(event: { clientX: number; clientY: number }) {
    const rect = displayHost.current!.parentElement!.getBoundingClientRect();
    return canvasPoint(event, rect, zoom);
  }
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (contextMenu) setContextMenu(null);
    if (
      busy ||
      capturedPointer.current !== null ||
      ![0, 1].includes(event.button) ||
      ((event.target as HTMLElement).closest("button") &&
        !(event.target as HTMLElement).closest(
          "[data-crop-handle], [data-rotate]",
        ))
    )
      return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    capturedPointer.current = event.pointerId;
    if (tool === "hand" || spacePan || event.button === 1) {
      gesture.current = {
        kind: "pan",
        startX: event.clientX,
        startY: event.clientY,
        x: pan.x,
        y: pan.y,
      };
      return;
    }
    if (movingMask) {
      if (selected?.mask && !locked)
        gesture.current = {
          kind: "move",
          revision: dom.getSnapshot().revision,
          documentId: dom.id,
          mask: selected.mask,
          id: selected.id,
          startX: event.clientX,
          startY: event.clientY,
          x: selected.mask.x ?? 0,
          y: selected.mask.y ?? 0,
          dx: 0,
          dy: 0,
        };
      return;
    }
    if (
      tool === "move" &&
      event.button === 0 &&
      (event.target as HTMLElement).closest("[data-rotate]")
    ) {
      if (!selected || !bounds || !canRotateSelection) return;
      const point = toCanvasPoint(event);
      const center = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
      const members = dom.layerSelection.rootLayers.map((layer) => {
        const parent = parentId(state.document, layer.id);
        return {
          id: layer.id,
          world: layerTransform(state.document, layer.id)!,
          parentInverse: parent
            ? layerTransform(state.document, parent)!.inverse()
            : new AffineTransform(),
          patch: {},
        };
      });
      gesture.current = {
        kind: "rotate",
        center,
        members,
        startAngle: Math.atan2(point.y - center.y, point.x - center.x),
        revision: state.revision,
        documentId: dom.id,
      };
      return;
    }
    if (
      tool === "move" &&
      event.button === 0 &&
      state.selectedIds.length > 1 &&
      canRotateSelection &&
      bounds
    ) {
      const handle = (event.target as HTMLElement)
        .closest("[data-handle]")
        ?.getAttribute("data-handle");
      if (handle && bounds.width > 0 && bounds.height > 0) {
        const point = toCanvasPoint(event);
        const center = {
          x: bounds.x + (handle.includes("w") ? bounds.width : 0),
          y: bounds.y + (handle.includes("n") ? bounds.height : 0),
        };
        const members = dom.layerSelection.rootLayers.map((layer) => {
          const parent = parentId(state.document, layer.id);
          return {
            id: layer.id,
            world: layerTransform(state.document, layer.id)!,
            parentInverse: parent
              ? layerTransform(state.document, parent)!.inverse()
              : new AffineTransform(),
            patch: {},
          };
        });
        gesture.current = {
          kind: "scale-selection",
          center,
          members,
          startAngle: 0,
          initialVector: { x: point.x - center.x, y: point.y - center.y },
          revision: state.revision,
          documentId: dom.id,
        };
        return;
      }
    }
    if (tool === "move" && event.button === 0) {
      const handleTarget = (event.target as HTMLElement).closest(
        "[data-handle]",
      ) as HTMLElement | null;
      const handle = handleTarget?.getAttribute("data-handle") as
        "nw" | "ne" | "sw" | "se" | null;
      if (
        handle &&
        state.selectedIds.length < 2 &&
        selected &&
        !locked &&
        (selected.kind === "raster" || selected.kind === "text")
      ) {
        gesture.current = {
          kind: "resize",
          revision: dom.getSnapshot().revision,
          documentId: dom.id,
          handle,
          startX: event.clientX,
          startY: event.clientY,
          layerX: selected.x,
          layerY: selected.y,
          layerWidth: selected.width,
          layerHeight: selected.height,
          layerFontSize:
            selected.kind === "text" ? selected.fontSize : undefined,
          layerText: selected.kind === "text" ? selected.text : undefined,
          layerFontFamily:
            selected.kind === "text" ? selected.fontFamily : undefined,
          layerLineHeight:
            selected.kind === "text" ? selected.lineHeight : undefined,
          id: selected.id,
          layerKind: selected.kind,
          patch: {},
        };
        setResizingCursor(handle === "nw" || handle === "se" ? "nwse" : "nesw");
        return;
      }
    }
    const point = toCanvasPoint(event);
    updateCursor(point);
    if (tool !== "move") {
      if (tool === "text") {
        attempt(() => {
          const textLayer = new TextLayer({
            name: "Text",
            text: "Text",
            x: Math.round(point.x),
            y: Math.round(point.y),
          });
          dom.layers.add(textLayer);
          dom.selectedLayer = textLayer;
          chooseTool("move");
        });
        return;
      }
      const cropHandle = (event.target as HTMLElement)
        .closest("[data-crop-handle]")
        ?.getAttribute("data-crop-handle") as CropHandle | undefined;
      attempt(() =>
        editor.tools.begin(tool, point, modifiers(event), zoom, cropHandle),
      );
      return;
    }
    const inSelectedGroup =
      state.selectedIds.length < 2 &&
      selected?.kind === "group" &&
      bounds &&
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height;
    const hit = inSelectedGroup
      ? selected.id
      : hitTest(state.document, point.x, point.y);
    const hitLayer = dom.getLayer(hit);
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      if (hitLayer)
        dom.selectLayers(
          [hitLayer],
          dom.selectedLayers.some((layer) => layer.id === hit)
            ? "remove"
            : "add",
        );
      return;
    }
    if (
      hitLayer &&
      dom.selectedLayers.some((layer) => layer.id === hit) &&
      dom.selectedLayers.length > 1
    ) {
      const members = dom.layerSelection.rootLayers.map((layer) => ({
        id: layer.id,
        x: layer.x,
        y: layer.y,
      }));
      if (members.some((layer) => isLocked(state.document, layer.id))) return;
      gesture.current = {
        kind: "move",
        startX: event.clientX,
        startY: event.clientY,
        id: hitLayer.id,
        x: hitLayer.x,
        y: hitLayer.y,
        dx: 0,
        dy: 0,
        members,
        revision: dom.getSnapshot().revision,
        documentId: dom.id,
      };
      return;
    }
    dom.selectedLayer = dom.getLayer(hit);
    const layer = findLayer(state.document, hit);
    if (layer && !isLocked(state.document, layer.id))
      gesture.current = {
        kind: "move",
        revision: dom.getSnapshot().revision,
        documentId: dom.id,
        startX: event.clientX,
        startY: event.clientY,
        x: layer.x,
        y: layer.y,
        id: layer.id,
        dx: 0,
        dy: 0,
      };
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      capturedPointer.current !== null &&
      capturedPointer.current !== event.pointerId
    )
      return;
    const point = toCanvasPoint(event);
    updateCursor(point);
    if (editor.tools.getSnapshot().drawing) {
      attempt(() => {
        const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const sample of samples)
          editor.tools.move(toCanvasPoint(sample), modifiers(sample));
        editor.tools.move(point, modifiers(event));
      });
      return;
    }
    const drag = gesture.current;
    if (!drag) return;
    if (drag.kind === "pan") {
      setPan({
        x: drag.x + event.clientX - drag.startX,
        y: drag.y + event.clientY - drag.startY,
      });
      return;
    }
    if (
      drag.documentId !== dom.id ||
      drag.revision !== dom.getSnapshot().revision
    ) {
      gesture.current = null;
      setPreview(null);
      setSnapGuides({});
      setResizingCursor(null);
      return;
    }
    if (drag.kind === "rotate" || drag.kind === "scale-selection") {
      const point = toCanvasPoint(event);
      let delta =
        Math.atan2(point.y - drag.center.y, point.x - drag.center.x) -
        drag.startAngle;
      if (event.shiftKey)
        delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
      let rotation = AffineTransform.rotation(delta).around(drag.center);
      if (drag.kind === "scale-selection") {
        let x = Math.max(
          0.000001,
          (point.x - drag.center.x) / drag.initialVector!.x,
        );
        let y = Math.max(
          0.000001,
          (point.y - drag.center.y) / drag.initialVector!.y,
        );
        if (event.shiftKey) x = y = Math.max(x, y);
        rotation = AffineTransform.scale(x, y).around(drag.center);
      }
      for (const member of drag.members) {
        const local = member.parentInverse.multiply(
          rotation.multiply(member.world),
        );
        member.patch = {
          x: local.e,
          y: local.f,
          transform: { ...local.toJSON(), e: 0, f: 0 },
        };
      }
      setPreview({
        type: "transaction",
        label:
          drag.kind === "rotate"
            ? "Rotate selected layers"
            : "Scale selected layers",
        commands: drag.members.map((member) => ({
          type: "layer.update",
          id: member.id,
          patch: member.patch,
        })),
      });
      return;
    }
    if (drag.kind === "resize") {
      const dx = (event.clientX - drag.startX) / zoom;
      const dy = (event.clientY - drag.startY) / zoom;
      const original = findLayer(state.document, drag.id)!;
      const patch = computeResizePatch(drag, dx, dy, event.shiftKey, {
        world: layerTransform(state.document, drag.id)!,
        local: localTransform(original),
      });
      drag.patch = patch;
      setPreview({
        type: "layer.update",
        id: drag.id,
        patch,
      });
      return;
    }
    if (drag.kind !== "move") return;
    drag.dx = Math.round((event.clientX - drag.startX) / zoom);
    drag.dy = Math.round((event.clientY - drag.startY) / zoom);
    setSnapGuides({});
    if (snapEnabled && !event.altKey && !drag.mask) {
      const movingBounds = unionBounds(
        (drag.members ?? [{ id: drag.id }]).flatMap((member) => {
          const bounds = layerBounds(state.document, member.id);
          return bounds ? [bounds] : [];
        }),
      );
      if (movingBounds) {
        const artwork = snapArtwork
          ? (drag.snapTargets ??= artworkSnapBounds(
              state.document,
              (drag.members ?? [{ id: drag.id }]).map((member) => member.id),
            ))
          : [];
        const snapped = snapToCanvas(
          movingBounds,
          { x: drag.dx, y: drag.dy },
          dom.width,
          dom.height,
          6 / zoom,
          artwork,
          guidesVisible ? state.document.guides : [],
        );
        drag.dx = snapped.x;
        drag.dy = snapped.y;
        setSnapGuides(snapped.guides);
      }
    }
    setPreview(
      drag.members
        ? {
            type: "transaction",
            label: "Move selected layers",
            commands: drag.members.map((member) => ({
              type: "layer.update",
              id: member.id,
              patch: movePatch({ ...member, dx: drag.dx, dy: drag.dy }),
            })),
          }
        : { type: "layer.update", id: drag.id, patch: movePatch(drag) },
    );
  }
  function movePatch(drag: {
    id: string;
    x: number;
    y: number;
    dx: number;
    dy: number;
    mask?: LayerMaskData;
  }): LayerPatch {
    const snapshot = dom.toJSON();
    let delta = { x: drag.dx, y: drag.dy };
    if (!drag.mask) delta = parentSpaceDelta(snapshot, drag.id, delta);
    else if (drag.mask.linked !== false) {
      const inverse = layerTransform(snapshot, drag.id)!.inverse();
      delta = {
        x: inverse.a * drag.dx + inverse.c * drag.dy,
        y: inverse.b * drag.dx + inverse.d * drag.dy,
      };
    }
    const position = {
      x: Math.max(
        -Number.MAX_SAFE_INTEGER,
        Math.min(Number.MAX_SAFE_INTEGER, drag.x + delta.x),
      ),
      y: Math.max(
        -Number.MAX_SAFE_INTEGER,
        Math.min(Number.MAX_SAFE_INTEGER, drag.y + delta.y),
      ),
    };
    return drag.mask ? { mask: { ...drag.mask, ...position } } : position;
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (capturedPointer.current !== event.pointerId) return;
    if (
      ["move", "resize", "rotate", "scale-selection"].includes(
        gesture.current?.kind ?? "",
      )
    )
      pointerMove(event);
    capturedPointer.current = null;
    if (editor.tools.getSnapshot().drawing) {
      // Capture the final endpoint even if pointerup arrives before the next
      // animation frame. Pointer moves have already accumulated all samples.
      attempt(() => editor.tools.move(toCanvasPoint(event), modifiers(event)));
      void task(() => editor.tools.end());
      return;
    }
    const drag = gesture.current;
    gesture.current = null;
    setResizingCursor(null);
    setPreview(null);
    if (drag?.kind === "move" && (drag.dx || drag.dy))
      attempt(() => {
        if (drag.members) {
          if (
            dom.id !== drag.documentId ||
            dom.getSnapshot().revision !== drag.revision
          )
            throw new Error("Document changed during layer drag.");
          const members = drag.members;
          dom.transaction("Move selected layers", () => {
            for (const member of members)
              dom
                .getLayer(member.id)
                ?.update(movePatch({ ...member, dx: drag.dx, dy: drag.dy }));
          });
        } else dom.getLayer(drag.id)?.update(movePatch(drag));
      });
    else if (
      (drag?.kind === "rotate" || drag?.kind === "scale-selection") &&
      drag.members.some((member) => Object.keys(member.patch).length)
    ) {
      attempt(() => {
        if (
          dom.id !== drag.documentId ||
          dom.getSnapshot().revision !== drag.revision
        )
          throw new Error("Document changed during rotation.");
        dom.transaction(
          drag.kind === "rotate"
            ? "Rotate selected layers"
            : "Scale selected layers",
          () => {
            for (const member of drag.members)
              dom.getLayer(member.id)!.update(member.patch);
          },
        );
      });
    } else if (drag?.kind === "resize" && Object.keys(drag.patch).length > 0) {
      const hasChanged =
        drag.layerKind === "text"
          ? drag.patch.fontSize !== drag.layerFontSize ||
            drag.patch.x !== drag.layerX ||
            drag.patch.y !== drag.layerY
          : drag.patch.width !== drag.layerWidth ||
            drag.patch.height !== drag.layerHeight ||
            drag.patch.x !== drag.layerX ||
            drag.patch.y !== drag.layerY;
      if (hasChanged) {
        attempt(() => dom.getLayer(drag.id)?.update(drag.patch));
      }
    }
  }

  const handlePsdFile = async (file: File) => {
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const parsed = parsePsd(buffer);
      const report = getPsdCapabilityReport(parsed);
      setPsdPreflight({
        fileName: file.name,
        buffer,
        parsed,
        report,
      });
    } catch (err) {
      notify(
        `Failed to inspect PSD: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handlePsdImportCommit = async (mode: "layered" | "flatten") => {
    if (!psdPreflight) return;
    await task(async () => {
      try {
        await editor.openPsd(psdPreflight.buffer, { mode });
        notify(
          `Imported PSD "${psdPreflight.fileName}" (${mode === "layered" ? "as layers" : "flattened"})`,
        );
      } catch (err) {
        notify(
          `Failed to import PSD: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setPsdPreflight(null);
      }
    });
  };

  const handleSelectSubject = async () => {
    await task(async () => {
      try {
        await editor.selectSubject();
        notify("Subject selected");
      } catch (err) {
        notify(
          `Select subject failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  };

  const handleRemoveBackground = async () => {
    await task(async () => {
      try {
        await editor.removeBackground();
        notify("Background removed");
      } catch (err) {
        notify(
          `Remove background failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  };

  return (
    <ShortcutHints.Provider value={activeOverrides}>
      <div className="app-shell">
        <input
          ref={importInput}
          data-testid="import-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file)
              void task(async () => {
                await editor.importImage(file);
                notify("Image added");
              });
          }}
        />
        <input
          ref={openInput}
          data-testid="project-input"
          type="file"
          accept=".luma,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file)
              void task(async () => {
                await editor.openProject(file);
              });
          }}
        />
        <input
          ref={psdInputRef}
          data-testid="psd-input"
          type="file"
          accept=".psd,.psb"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) handlePsdFile(file);
          }}
        />
        {showRecovery && (
          <RecoveryPanel
            editor={editor}
            onClose={() => setShowRecovery(false)}
          />
        )}
        <TopBar
          documentId={dom.id}
          documentName={dom.name}
          canUndo={dom.canUndo}
          canRedo={dom.canRedo}
          hasLayers={!!dom.layers.length}
          busy={busy}
          onRename={(name) => {
            attempt(() => {
              dom.name = name;
            });
          }}
          onUndo={() => {
            setPreview(null);
            dom.undo();
          }}
          onRedo={() => {
            setPreview(null);
            dom.redo();
          }}
          onOpen={() => openInput.current?.click()}
          onSave={save}
          onExport={exportPng}
          onExportDialog={() => setShowExportDialog(true)}
          onGenerate={() => setShowGenerateDialog(true)}
          onRecipes={() => setShowRecipeDialog(true)}
          onBatch={() => setShowBatchDialog(true)}
          onColorProfile={() => setShowColorDialog(true)}
          onPsdImport={() => psdInputRef.current?.click()}
          onRefineEdge={() => setShowRefineEdgeDialog(true)}
          onSelectSubject={handleSelectSubject}
        />
        <div
          className="workspace"
          style={
            {
              "--layers-width": `${panelLayout.widths.layers}px`,
              "--inspector-width": `${panelLayout.widths.inspector}px`,
            } as import("react").CSSProperties
          }
        >
          <ToolRail
            onOpenPalette={() => setShowPalette(true)}
            tool={tool}
            spacePan={spacePan}
            busy={busy}
            onChooseTool={chooseTool}
            onImport={() => importInput.current?.click()}
            onNewDocument={() => editor.newDocument()}
            onOpenScripts={() => setShowScripts(true)}
            onOpenPlugins={() => setShowPlugins(true)}
            onOpenHelp={() => setShowHelp(true)}
            onOpenRecovery={() => setShowRecovery(true)}
          />
          <LayersPanel
            onRelinkSmartObject={(layer, file) => {
              void task(async () => {
                await editor.relinkSmartObject(layer, file);
              });
            }}
            onRasterizeSmartObject={(layer) => {
              void task(async () => {
                await layer.rasterize();
              });
            }}
            onEditSmartObject={(layer) => {
              void task(async () => {
                await editor.editSmartObject(layer);
              });
            }}
            copyTargets={(sessions ?? []).filter(
              (session) => session.document !== dom,
            )}
            onCopyToDocument={(target) => {
              void task(async () => {
                const copied = await editor.copySelectedLayersTo(target);
                notify(
                  `Copied ${copied.length} layer${copied.length === 1 ? "" : "s"} to ${target.name}.`,
                );
              });
            }}
            document={dom}
            viewDocument={viewDocument}
            selectedId={state.selectedId}
            selectedLayer={selectedObject}
            locked={locked}
            busy={busy}
            historyPast={state.past}
            historyFuture={state.future}
            getThumbnail={(assetId) => assets.get(assetId).thumbnail}
            onCancelTools={() => editor.tools.cancel()}
            onClearPreview={clearPreview}
            onAttempt={attempt}
            onSelectLayer={(layer, additive) => {
              if (additive)
                dom.selectLayers(
                  [layer],
                  dom.selectedLayers.some((item) => item.id === layer.id)
                    ? "remove"
                    : "add",
                );
              else dom.selectedLayer = layer;
            }}
            onAddLayer={addLayer}
            onAddGroup={addGroup}
            onAddAdjustmentLayer={() => addAdjustmentLayer("curves")}
            onDuplicateLayer={() =>
              selectedAction((layer) => {
                dom.selectedLayer = layer.duplicate();
              })
            }
            onMoveLayerForward={() => selectedAction((layer) => layer.moveUp())}
            onMoveLayerBackward={() =>
              selectedAction((layer) => layer.moveDown())
            }
            onDeleteLayer={() => attempt(() => dom.layerSelection.remove())}
          />
          <PanelResizeHandle
            label="Resize layers panel"
            value={panelLayout.widths.layers}
            min={190}
            max={panelLayout.max("layers")}
            direction={1}
            disabled={busy}
            onStart={() => {
              editor.tools.cancel();
              setPreview(null);
            }}
            onPreview={(value) => panelLayout.change("layers", value, false)}
            onCommit={(value) => panelLayout.change("layers", value, true)}
            onCancel={panelLayout.cancel}
            onReset={() => panelLayout.reset("layers")}
          />
          <main className="canvas-column">
            <DocumentTabBar
              sessions={sessions ?? []}
              activeId={sessionId}
              busy={busy}
              onMove={(document, index) => editor.moveDocument(document, index)}
              onNew={() => editor.newDocument()}
              onActivate={(document) => {
                clearPreview();
                gesture.current = null;
                capturedPointer.current = null;
                editor.activateDocument(document);
              }}
              onClose={(document) => {
                const dirty = editor
                  .getSnapshot()
                  .sessions.find(
                    (session) => session.document === document,
                  )?.dirty;
                if (
                  dirty &&
                  !window.confirm(
                    `Close ${document.name} and discard unsaved changes? Download a project first to keep a separate copy.`,
                  )
                )
                  return;
                void task(async () => {
                  await editor.closeDocument(document, {
                    discardChanges: !!dirty,
                  });
                });
              }}
            />
            {smartObjectEdit && (
              <div
                className="smart-object-edit-bar"
                role="region"
                aria-label="Smart-object contents"
              >
                <span>
                  {smartObjectEdit.ownerOpen
                    ? `Editing contents for ${smartObjectEdit.ownerName}.`
                    : "Source document closed. Contents remain available in this tab."}
                  {smartObjectEdit.ownerOpen &&
                    (smartObjectEdit.changed
                      ? " Changes are not applied."
                      : " No pending contents changes.")}
                </span>
                <Button
                  disabled={
                    busy ||
                    !smartObjectEdit.ownerOpen ||
                    !smartObjectEdit.changed
                  }
                  onClick={() => {
                    void task(async () => {
                      await editor.applySmartObjectContents(dom);
                      notify("Smart-object contents applied.");
                    });
                  }}
                >
                  Apply to source
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    attempt(() => editor.detachSmartObjectContents(dom))
                  }
                >
                  Keep as document
                </Button>
              </div>
            )}
            <div className="canvas-toolbar">
              <span>
                {selected ? selected.name : "Canvas"}
                <ChevronRight size={12} />
                <span className="text-muted">
                  {selected?.kind === "group"
                    ? "Group"
                    : selected
                      ? `${selected.kind[0].toUpperCase() + selected.kind.slice(1)} layer`
                      : "Document"}
                </span>
              </span>
              <button onClick={fit} title="Fit canvas">
                <Maximize size={13} />
                Fit
              </button>
            </div>
            <ToolOptions
              tool={tool}
              moveTarget={movingMask ? "mask" : "layer"}
              hasMask={!!selected?.mask}
              hasPaintMask={!!selected?.mask}
              hasFilterMask={
                selected?.kind === "smart-object" && !!selected.filterMask
              }
              hasVectorMask={selected?.mask?.kind === "vector"}
              onMoveTarget={setMoveTarget}
              snapEnabled={snapEnabled}
              onSnapEnabled={setSnapEnabled}
              snapArtwork={snapArtwork}
              onSnapArtwork={setSnapArtwork}
              controller={editor.tools}
              settings={toolState.settings}
              hasSelection={!!dom.selection}
              disabled={busy || locked}
              onAction={attempt}
              onOpenArtboard={() => setShowArtboardDialog(true)}
              onOpenCrop={() => {
                if (!busy) setShowCropDialog(true);
              }}
              documentBusy={busy}
            />
            <div
              ref={viewport}
              className={`viewport ${tool === "hand" || spacePan ? "hand" : `tool-${tool}`} ${resizingCursor ? `resizing-${resizingCursor}` : ""}`}
              tabIndex={-1}
              aria-label="Editing canvas"
              onContextMenu={(event) => {
                event.preventDefault();
                if (
                  busy ||
                  editor.tools.getSnapshot().drawing ||
                  gesture.current
                )
                  return;
                setContextMenu({ x: event.clientX, y: event.clientY });
              }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerLeave={() => updateCursor(null)}
              onLostPointerCapture={(event) => {
                if (capturedPointer.current !== event.pointerId) return;
                capturedPointer.current = null;
                editor.tools.cancel();
                gesture.current = null;
                setResizingCursor(null);
                setPreview(null);
              }}
              onPointerCancel={() => {
                capturedPointer.current = null;
                editor.tools.cancel();
                gesture.current = null;
                setResizingCursor(null);
                setPreview(null);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file)
                  void task(async () => {
                    await editor.importImage(file);
                  });
              }}
            >
              {guidesVisible && (
                <CanvasRulers
                  viewport={viewport}
                  document={dom}
                  zoom={zoom}
                  pan={pan}
                  revision={state.revision}
                  editable={!busy && !spacePan}
                  onAttempt={attempt}
                />
              )}
              <div
                className="canvas-wrap"
                style={{
                  width: viewDocument.width * zoom,
                  height: viewDocument.height * zoom,
                  transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
                }}
              >
                <span className="canvas-label">{dom.name.toUpperCase()}</span>
                <div className="artwork-clip">
                  <div
                    ref={displayHost}
                    className="artwork-host"
                    style={{
                      position: "absolute",
                      left: paintedRegion.x * zoom,
                      top: paintedRegion.y * zoom,
                      width: paintedRegion.width * zoom,
                      height: paintedRegion.height * zoom,
                    }}
                  />
                </div>
                <CanvasOverlays
                  document={viewDocument}
                  selected={selected}
                  tool={tool}
                  zoom={zoom}
                  controller={editor.tools}
                  cursor={cursor}
                />
                {previewCandidate && (
                  <div
                    className="generation-candidate-preview-overlay"
                    style={{
                      position: "absolute",
                      left:
                        Math.round((dom.width - previewCandidate.width) / 2) *
                        zoom,
                      top:
                        Math.round((dom.height - previewCandidate.height) / 2) *
                        zoom,
                      width: previewCandidate.width * zoom,
                      height: previewCandidate.height * zoom,
                      pointerEvents: "none",
                      zIndex: 20,
                    }}
                  >
                    <img
                      src={previewCandidate.asset.thumbnail}
                      alt="Generation Candidate Preview"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        opacity: 0.9,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        border: "2px dashed var(--color-accent)",
                        borderRadius: 2,
                      }}
                    />
                  </div>
                )}
                {tool === "crop" && editor.tools.crop.bounds && (
                  <CropOverlay
                    bounds={editor.tools.crop.bounds}
                    width={dom.width}
                    height={dom.height}
                    zoom={zoom}
                    onNudge={(handle, dx, dy) =>
                      attempt(() => editor.tools.crop.nudge(dx, dy, handle))
                    }
                  />
                )}
                {(guidesVisible ? (state.document.guides ?? []) : [])
                  .filter(
                    (guide) =>
                      guide.position >= 0 &&
                      guide.position <=
                        (guide.orientation === "vertical"
                          ? dom.width
                          : dom.height),
                  )
                  .map((guide) => (
                    <GuideOverlay
                      key={guide.id}
                      guide={guide}
                      document={dom}
                      zoom={zoom}
                      revision={state.revision}
                      editable={
                        tool === "move" && !busy && !spacePan && !movingMask
                      }
                      onAttempt={attempt}
                    />
                  ))}
                {snapGuides.x !== undefined && (
                  <div
                    className="snap-guide vertical"
                    aria-hidden="true"
                    style={{
                      left: snapGuides.x * zoom,
                      height: dom.height * zoom,
                    }}
                  />
                )}
                {snapGuides.y !== undefined && (
                  <div
                    className="snap-guide horizontal"
                    aria-hidden="true"
                    style={{
                      top: snapGuides.y * zoom,
                      width: dom.width * zoom,
                    }}
                  />
                )}
                {bounds &&
                  selected?.visible &&
                  tool === "move" &&
                  !movingMask && (
                    <div
                      className={`selection-outline ${locked ? "locked" : ""}`}
                      style={{
                        left: bounds.x * zoom,
                        top: bounds.y * zoom,
                        width: bounds.width * zoom,
                        height: bounds.height * zoom,
                      }}
                    >
                      {canRotateSelection && (
                        <button
                          type="button"
                          className="rotation-handle"
                          data-rotate="true"
                          aria-label="Drag to rotate layer"
                          title="Drag to rotate; hold Shift for 15° increments"
                        />
                      )}
                      {(isResizable && state.selectedIds.length < 2) ||
                      (state.selectedIds.length > 1 && canRotateSelection) ? (
                        <>
                          <i
                            className="handle handle-nw"
                            data-handle="nw"
                            style={resizeHandleStyle(false, false)}
                            title="Resize"
                          />
                          <i
                            className="handle handle-ne"
                            data-handle="ne"
                            style={resizeHandleStyle(true, false)}
                            title="Resize"
                          />
                          <i
                            className="handle handle-sw"
                            data-handle="sw"
                            style={resizeHandleStyle(false, true)}
                            title="Resize"
                          />
                          <i
                            className="handle handle-se"
                            data-handle="se"
                            style={resizeHandleStyle(true, true)}
                            title="Resize"
                          />
                        </>
                      ) : !locked ? (
                        <>
                          <i />
                          <i />
                          <i />
                          <i />
                        </>
                      ) : null}
                    </div>
                  )}
              </div>
              {!dom.layers.length &&
                !dom.guides.length &&
                (tool === "move" || tool === "hand") && (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <ImagePlus size={27} />
                    </div>
                    <h1>Make room for your next idea.</h1>
                    <p>Drop an image here, or start with a sample.</p>
                    <Button
                      variant="primary"
                      onClick={() => importInput.current?.click()}
                      disabled={busy}
                    >
                      <Plus size={15} />
                      Import image
                    </Button>
                    <button
                      className="sample-link"
                      onClick={() => void task(() => editor.openSample())}
                      disabled={busy}
                    >
                      Open sample composition <ChevronRight size={13} />
                    </button>
                    <small>
                      PNG, JPG, WEBP · Original resolution preserved
                    </small>
                  </div>
                )}
              <div className="zoom-control">
                <IconButton
                  label="Zoom out"
                  onClick={() => changeZoom(1 / 1.2)}
                >
                  <Minus size={14} />
                </IconButton>
                <button aria-label="Zoom level, click to fit" onClick={fit}>
                  {Math.round(zoom * 100)}%
                </button>
                <IconButton label="Zoom in" onClick={() => changeZoom(1.2)}>
                  <Plus size={14} />
                </IconButton>
                <span />
                <IconButton
                  shortcutId="fit"
                  label="Fit canvas (Mod+0)"
                  onClick={fit}
                >
                  <Maximize size={14} />
                </IconButton>
              </div>
            </div>
            <footer className="canvas-status">
              <span
                aria-label="Rendering backend"
                title={
                  renderBackend === "webgpu"
                    ? "WebGPU viewport acceleration"
                    : "Canvas rendering with WASM processing"
                }
              >
                {renderBackend === "webgpu"
                  ? "GPU accelerated"
                  : "Standard rendering"}
              </span>
              <span>
                <span
                  className={`status-dot ${rendering || busy ? "working" : ""}`}
                />
                {busy ? "Working…" : rendering ? "Rendering…" : "Ready"}
                <span className="footer-divider">/</span>
                {viewDocument.width} × {viewDocument.height} px
                <span className="footer-divider">/</span>
                <button
                  type="button"
                  className="status-profile-btn"
                  onClick={() => setShowColorDialog(true)}
                  title="Click to change color working space or configure soft proofing"
                  style={{
                    background: "none",
                    border: "none",
                    color: "inherit",
                    font: "inherit",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline dotted",
                  }}
                >
                  {STANDARD_PROFILES[editor.colorProfile]?.name ?? "sRGB"}
                </button>
                {editor.softProof && (
                  <>
                    <span className="footer-divider">/</span>
                    <span
                      style={{
                        color: "#eab308",
                        fontWeight: 600,
                      }}
                      title={`Proofing: ${STANDARD_PROFILES[editor.softProof.proofSpace]?.name} (${editor.softProof.intent})${editor.softProof.gamutWarning ? " [Gamut Warning ON]" : ""}`}
                    >
                      Proof:{" "}
                      {
                        STANDARD_PROFILES[
                          editor.softProof.proofSpace
                        ]?.name.split(" ")[0]
                      }
                    </span>
                  </>
                )}
              </span>
              <span title={recoveryState.message}>
                {recoveryState.status === "error"
                  ? recoveryState.message
                  : savedStamp === stamp
                    ? "Project downloaded"
                    : recoveryState.message}
              </span>
            </footer>
          </main>
          <PanelResizeHandle
            label="Resize inspector panel"
            value={panelLayout.widths.inspector}
            min={230}
            max={panelLayout.max("inspector")}
            direction={-1}
            disabled={busy}
            onStart={() => {
              editor.tools.cancel();
              setPreview(null);
            }}
            onPreview={(value) => panelLayout.change("inspector", value, false)}
            onCommit={(value) => panelLayout.change("inspector", value, true)}
            onCancel={panelLayout.cancel}
            onReset={() => panelLayout.reset("inspector")}
          />
          <InspectorPanel
            guidesVisible={guidesVisible}
            onGuidesVisible={setGuidesVisible}
            assets={assets}
            document={dom}
            viewDocument={viewDocument}
            selected={selected}
            selectedObject={selectedObject}
            selectedPathId={toolState.selectedPath?.pathId}
            locked={locked}
            busy={busy}
            wasmReady={wasmReady}
            preview={preview}
            onPreview={setPreview}
            onAttempt={attempt}
            onSelectedAction={selectedAction}
            onOpenHelp={() => setShowHelp(true)}
          />
        </div>
        {(error || message) && (
          <div
            className={`toast ${error ? "error" : ""}`}
            role={error ? "alert" : "status"}
          >
            {error || message}
            <IconButton
              label="Dismiss notification"
              onClick={() => {
                setError(null);
                setMessage(null);
              }}
            >
              <X size={14} />
            </IconButton>
          </div>
        )}
        {showPlugins && (
          <PluginPanel editor={editor} onClose={() => setShowPlugins(false)} />
        )}
        {showCropDialog && (
          <CropDialog
            width={dom.width}
            height={dom.height}
            selection={dom.selection?.toJSON() ?? null}
            initialBounds={editor.tools.crop.bounds}
            documentStamp={stamp}
            onCrop={(bounds) => {
              clearPreview();
              dom.crop(bounds);
              notify(`Cropped canvas to ${bounds.width} × ${bounds.height} px`);
            }}
            onClose={() => setShowCropDialog(false)}
          />
        )}
        {showArtboardDialog && (
          <ArtboardDialog
            currentWidth={dom.width}
            currentHeight={dom.height}
            onResize={(w, h) =>
              attempt(() => {
                dom.resize(w, h);
                notify(`Resized artboard to ${w} × ${h} px`);
              })
            }
            onClose={() => setShowArtboardDialog(false)}
          />
        )}
        {showPalette && (
          <CommandPalette
            actions={shortcuts.actions}
            busy={busy}
            onClose={() => setShowPalette(false)}
            onExecute={(action) => {
              flushSync(() => setShowPalette(false));
              if (action.enabled?.() !== false) action.run();
            }}
          />
        )}
        {showHelp && (
          <ShortcutDialog
            shortcuts={shortcuts}
            error={resolvedBindings.error ?? shortcutPreferences.error}
            onBinding={changeShortcut}
            onResetAll={resetShortcuts}
            onClose={() => setShowHelp(false)}
          />
        )}
        {showScripts && (
          <ScriptPanel editor={editor} onClose={() => setShowScripts(false)} />
        )}
        {showGenerateDialog && (
          <GenerateAssetDialog
            editor={editor}
            initialModality={generateDialogModality}
            onClose={() => {
              setShowGenerateDialog(false);
              setPreviewCandidate(null);
            }}
            onPreviewCandidate={setPreviewCandidate}
          />
        )}
        {showRecipeDialog && (
          <RecipeDialog
            editor={editor}
            onClose={() => setShowRecipeDialog(false)}
            onRunSuccess={(name) => notify(`Recipe "${name}" applied`)}
          />
        )}
        {showBatchDialog && (
          <BatchRunnerDialog
            editor={editor}
            onClose={() => setShowBatchDialog(false)}
          />
        )}
        {showExportDialog && (
          <ExportDialog
            document={dom.toJSON()}
            busy={busy}
            onClose={() => setShowExportDialog(false)}
            onExport={async (options) => {
              await task(async () => {
                const result = await editor.export(options);
                download(
                  result.blob,
                  `${fileName(dom.name)}.${result.extension}`,
                );
                notify(`Exported .${result.extension}`);
              });
            }}
          />
        )}
        {showColorDialog && (
          <ColorProfileDialog
            currentProfileId={editor.colorProfile}
            onApplyProfile={(profileId, mode, _intent) => {
              editor.setColorProfile(profileId);
              notify(
                `Color profile set to ${STANDARD_PROFILES[profileId]?.name ?? profileId} (${mode})`,
              );
            }}
            onUpdateSoftProof={(options) => {
              editor.setSoftProof(options);
              if (options) {
                notify(
                  `Soft proofing: ${STANDARD_PROFILES[options.proofSpace]?.name ?? options.proofSpace}`,
                );
              } else {
                notify("Soft proofing disabled");
              }
            }}
            onClose={() => setShowColorDialog(false)}
          />
        )}
        {psdPreflight && (
          <PsdImportDialog
            fileName={psdPreflight.fileName}
            parsedPsd={psdPreflight.parsed}
            report={psdPreflight.report}
            onImportLayers={() => handlePsdImportCommit("layered")}
            onImportFlattened={() => handlePsdImportCommit("flatten")}
            onClose={() => setPsdPreflight(null)}
          />
        )}
        {showRefineEdgeDialog && (
          <RefineEdgeDialog
            editor={editor}
            onClose={() => setShowRefineEdgeDialog(false)}
            onApply={async (options) => {
              await task(async () => {
                try {
                  await editor.refineEdge(options);
                  notify("Edge refined");
                } catch (err) {
                  notify(
                    `Refine edge failed: ${err instanceof Error ? err.message : String(err)}`,
                  );
                }
              });
            }}
          />
        )}
        {contextMenu && (
          <CanvasContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            tool={tool}
            settings={toolState.settings}
            controller={editor.tools}
            disabled={busy || locked}
            hasSelection={!!dom.selection}
            hasMask={!!selected?.mask}
            hasVectorMask={selected?.mask?.kind === "vector"}
            moveTarget={movingMask ? "mask" : "layer"}
            onMoveTarget={setMoveTarget}
            selectedLayer={selectedObject}
            locked={locked}
            onChooseTool={chooseTool}
            onAddLayer={addLayer}
            onAddAdjustmentLayer={addAdjustmentLayer}
            onSelectSubject={handleSelectSubject}
            onRemoveBackground={handleRemoveBackground}
            onRefineEdge={() => setShowRefineEdgeDialog(true)}
            onGenerateLayer={() => {
              setGenerateDialogModality("text-to-image");
              setShowGenerateDialog(true);
            }}
            onGenerativeFill={() => {
              setGenerateDialogModality("masked-edit");
              setShowGenerateDialog(true);
            }}
            onDuplicateLayer={() =>
              selectedAction((layer) => {
                dom.selectedLayer = layer.duplicate();
              })
            }
            onDeleteLayer={() =>
              selectedAction((layer) => {
                layer.remove();
              })
            }
            onSelectAll={() => attempt(() => dom.selectAll())}
            onDeselect={() => attempt(() => dom.deselect())}
            onFillSelection={() => attempt(() => editor.tools.fillSelection())}
            onFit={fit}
            onActualSize={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    </ShortcutHints.Provider>
  );
}
