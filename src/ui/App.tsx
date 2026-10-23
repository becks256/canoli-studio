import {AccountClient} from '../account/client';
import {AccountButton,AccountDialog} from './AccountDialog';
import {RawDevelopmentDialog,isCameraRawFile,rawFileAccept} from "./RawDevelopmentDialog";
import {ChatGptConnectionDialog,ChatGptConnectionButton} from './ChatGptConnectionDialog';
import { FrequencySeparationDialog } from "./FrequencySeparationDialog";
import {BrushSymmetryDialog} from './BrushSymmetryDialog';
import {pointerPenTilt} from '../core/brush-tip';
import {BrushTipDialog} from './BrushTipDialog';
import {BrushTextureDialog} from './BrushTextureDialog';
import {useBrushTexturePreview} from './hooks/useBrushTexturePreview';
import {BrushPresetsDialog} from './BrushPresetsDialog';
import {PressureCurveDialog} from './PressureCurveDialog';
import {SvgImportDialog} from './SvgImportDialog';
import {TiffImportDialog} from './TiffImportDialog';
import {AvifImportDialog} from './AvifImportDialog';
import type {RefineEdgeProgress} from '../core/matting';
import {PreflightDialog} from './PreflightDialog';
import { CanvasCursor } from "./CanvasCursor";
import { ColorRangeDialog } from "./ColorRangeDialog";
import { SelectionModifyDialog } from "./SelectionModifyDialog";
import { VectorBooleanDialog } from './VectorBooleanDialog';
import { SubjectSelectionProgress } from './SubjectSelectionProgress';
import type { SelectionModificationProgress } from '../core/selection-modification';
import type { SelectionModificationOptions } from "../core/selection-modification";
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
import { WorkspaceCommandPalette } from "./WorkspaceCommandPalette";
import {RecentFilesDialog,RecentFilesButton} from "./RecentFilesDialog";
import type {RecentKind} from "../workspace/recent-files";
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
import { AdjustmentLayer, LayerGroup, PaintLayer, RasterLayer, SmartObjectLayer, TextLayer } from "../dom";
import {
  defaultCurvesAdjustment,
  defaultHslAdjustment,
  defaultColorBalanceAdjustment,
  defaultVibranceAdjustment,
  defaultGradientMapAdjustment,
  defaultWhiteBalanceAdjustment,
  defaultLutAdjustment,
  defaultRedEyeAdjustment,
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
  localBounds,
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
import {PhotoshopImportDialog} from "./PhotoshopImportDialog";
import { RefineEdgeDialog } from "./RefineEdgeDialog";
import { STANDARD_PROFILES } from "../core/color/icc";
import type { GenerationCandidate } from "../ai/jobs/types";
import { ScriptPanel } from "./ScriptPanel";
import { PluginPanel } from "./PluginPanel";
import { ToolOptions } from "./ToolOptions";
import { TypographyPanel, TextProperties } from "./TypographyPanel";
import { ShortcutDialog } from "./ShortcutDialog";
import {WorkspaceDock} from "./WorkspaceDock";
import {WorkspaceLayoutDialog} from "./WorkspaceLayoutDialog";
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
  const [showPreflight,setShowPreflight]=useState(false);
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
    if(editor.document!==dom||dom.getSnapshot().selectedId!==state.selectedId)return;
    setMoveTarget("layer");
    if(editor.tools.hasCurrentWetGesture)return;
    editor.tools.configure({ paintTarget: "layer", penEditTarget: "layer" });
  }, [editor, dom, state.selectedId, selectedMaskKind, selectedFilterMaskKind]);
  useEffect(() => {
    if (editor.tools.drawingMaskContour || editor.tools.drawingPolygonLasso || editor.tools.drawingQuickSelection || editor.tools.crop.active)
      editor.tools.cancel();
  }, [editor, dom, state.revision]);
  const toolSizes = useRef({ brush: 24, pencil: 1, eraser: 24, smudge:24, mixer:24 });
  const toolState = useSyncExternalStore(
    editor.tools.subscribe,
    editor.tools.getUiSnapshot,
  );
  useEffect(()=>{if(toolState.error)setError(toolState.error);},[toolState.error]);
  const [customCursors, setCustomCursors] = useState(() => {
    try { return localStorage.getItem("luma.custom-cursors.v1") !== "false"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem("luma.custom-cursors.v1", String(customCursors)); } catch { /* Session-only preference. */ } }, [customCursors]);
  const [cursorStore] = useState(() => {
    let point: Point | null = null;
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => point,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      set: (next: Point | null) => { point = next; listeners.forEach(listener => listener()); },
    };
  });
  const pendingCursor = useRef<Point | null>(null);
  const cursorFrame = useRef<number | null>(null);
  function updateCursor(point: Point | null) {
    if (customCursors && point) return;
    pendingCursor.current = point;
    if (cursorFrame.current === null)
      cursorFrame.current = requestAnimationFrame(() => {
        cursorFrame.current = null;
        cursorStore.set(pendingCursor.current);
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
  const [recentRequest,setRecentRequest]=useState<{id?:string}|null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showWorkspaceLayout,setShowWorkspaceLayout]=useState(false);
  const [showChatGptConnection,setShowChatGptConnection]=useState(false);
  const [accountClient]=useState(()=>new AccountClient());
  const [showAccount,setShowAccount]=useState(false);
  const [showPressureCurve,setShowPressureCurve]=useState(false);
  const [showBrushTip,setShowBrushTip]=useState(false);
  const [showBrushTexture,setShowBrushTexture]=useState(false);
  const texturePreview=useBrushTexturePreview(editor.brushTextureSource,toolState.settings.texture,editor.renderer.processor);
  const [showBrushSymmetry,setShowBrushSymmetry]=useState(false);
  const [showBrushPresets,setShowBrushPresets]=useState(false);
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
  const [showImageSizeDialog, setShowImageSizeDialog] = useState(false);
  const [frequencySource,setFrequencySource]=useState<string|null>(null);
  const [showArtboardDialog, setShowArtboardDialog] = useState(false);
  const [showCropDialog, setShowCropDialog] = useState(false);
  const [selectionModification, setSelectionModification] = useState<SelectionModificationOptions['operation'] | null>(null);
  const [showColorRange,setShowColorRange]=useState(false);
  const [showVectorBoolean,setShowVectorBoolean]=useState(false);
  const [subjectProgress,setSubjectProgress]=useState<SelectionModificationProgress|null>(null);
  const subjectAbort=useRef<AbortController|null>(null);
  const [mattingProgress,setMattingProgress]=useState<RefineEdgeProgress|null>(null);
  const mattingAbort=useRef<AbortController|null>(null);
  useEffect(()=>()=>mattingAbort.current?.abort(),[]);
  useEffect(()=>()=>subjectAbort.current?.abort(),[]);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showRecipeDialog, setShowRecipeDialog] = useState(false);
  const [recipeRecordingOptions,setRecipeRecordingOptions]=useState({name:'Recorded Action',autoParameterizeTone:true});
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [showColorDialog, setShowColorDialog] = useState(false);
  const [showRefineEdgeDialog, setShowRefineEdgeDialog] = useState(false);
  const [svgFile,setSvgFile]=useState<File|null>(null);
  const [tiffFile,setTiffFile]=useState<File|null>(null);
  const [rawFile,setRawFile]=useState<File|null>(null);
  const [rawLayer,setRawLayer]=useState<SmartObjectLayer|null>(null);
  const [avifFile,setAvifFile]=useState<File|null>(null);
  const [photoshopFile,setPhotoshopFile]=useState<{file:File;id:number}|null>(null);
  const photoshopRequest=useRef(0);
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
        layerContentBounds?: import('../core/drawing').Rect;
        layerFontSize?: number;
        layerText?: string;
        layerFontFamily?: string;
        layerLineHeight?: number;
        layerTextStyle?: import('../core/text-style').TextStyle;
        id: string;
        layerKind: "raster" | "text";
        patch: LayerPatch;
      }
  >(null);
  useEffect(()=>editor.chatGpt.setInteractionGuard(sessionId=>editor.recoverySessionId===sessionId&&(capturedPointer.current!==null||gesture.current!==null||editor.tools.getSnapshot().drawing)),[editor]);
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
  const wetPreview=toolState.wetPreview?.isCurrent()?toolState.wetPreview:null;
  const viewDocument = useMemo(() => {
    if(wetPreview)return wetPreview.document;
    if (!activePreview) return state.document;
    try {
      return execute(state.document, activePreview);
    } catch {
      return state.document;
    }
  }, [state.document, activePreview,wetPreview]);
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
    const content = selected.kind === 'raster' && selected.erasures?.some(entry => entry.stroke.kind === 'wet' && entry.stroke.opacity > 0) ? localBounds(selected)! : { x: 0, y: 0, width: selected.width, height: selected.height };
    const corner = layerTransform(viewDocument, selected.id)!.point({
      x: content.x + (right ? content.width : 0),
      y: content.y + (bottom ? content.height : 0),
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
    if(tool === "smudge" || tool === "mixer")toolSizes.current[tool]=editor.tools.getSnapshot().settings.size;
    else if (tool === "pencil")
      toolSizes.current.pencil = editor.tools.getSnapshot().settings.size;
    else if (tool === "eraser")
      toolSizes.current.eraser = editor.tools.getSnapshot().settings.size;
    else if (["brush", "clone", "heal", "dodge", "burn"].includes(tool))
      toolSizes.current.brush = editor.tools.getSnapshot().settings.size;
    if(next === "smudge" || next === "mixer")editor.tools.configure({size:toolSizes.current[next]});
    else if (next === "pencil")
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
  const pendingCopy = useRef<{ pastes: number; cancelled: boolean } | null>(null);
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
    setZoom((current) => {
      const next = current * factor;
      // No arbitrary magnification ceiling; reject overflow and underflow.
      return next > 0 && Number.isFinite(next * Math.max(dom.width, dom.height, 100))
        ? next : current;
    });
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
      const blob=await editor.saveProject(),filename=`${fileName(name)}.luma`;
      download(blob,filename);
      editor.recentFiles.remember(new File([blob],filename,{type:blob.type}),'project');
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
    kind: "curves" | "levels" | "tone" | "hsl" | "color-balance" | "vibrance" | "gradient-map" | "white-balance" | "lut" | "red-eye" = "curves",
  ) {
    attempt(() => {
      const pupilSelection = kind === "red-eye" ? dom.selection : null;
      if (kind === "red-eye" && (!pupilSelection || !pupilSelection.toJSON().regions.length))
        throw new Error("Select the red pupils first, then add a Red Eye adjustment.");
      const existingNames = new Set(
        allLayers(dom.toJSON().children).map((l) => l.name),
      );
      const prefix =
        kind === "red-eye" ? "Red Eye" : kind === "curves"
          ? "Curves"
          : kind === "levels"
            ? "Levels"
            : kind === "hsl"
              ? "HSL"
              : kind === "color-balance"
                ? "Color Balance"
                : kind === "vibrance"
                  ? "Vibrance"
                  : kind === "gradient-map"
                    ? "Gradient Map"
                    : kind === "white-balance"
                      ? "White Balance"
                      : kind === "lut" ? "Color Lookup"
              : "Tone";
      let index = 1;
      while (existingNames.has(`${prefix} ${index}`)) index++;
      const layer = new AdjustmentLayer({
        name: `${prefix} ${index}`,
        adjustment:
          kind === "red-eye" ? defaultRedEyeAdjustment() : kind === "curves"
            ? defaultCurvesAdjustment()
            : kind === "levels"
              ? defaultLevelsAdjustment()
              : kind === "hsl"
                ? defaultHslAdjustment()
                : kind === "color-balance"
                  ? defaultColorBalanceAdjustment()
                  : kind === "vibrance"
                    ? defaultVibranceAdjustment()
                    : kind === "gradient-map"
                      ? defaultGradientMapAdjustment()
                      : kind === "white-balance"
                        ? defaultWhiteBalanceAdjustment()
                        : kind === "lut" ? defaultLutAdjustment()
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
        if (pupilSelection) layer.maskFromSelection(pupilSelection);
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
        const delta = parentSpaceDelta(dom.getSnapshot().document, layer.id, { x, y });
        layer.update({ x: layer.x + delta.x, y: layer.y + delta.y });
      }
    });
  }

  function cancelWorkspaceGesture(){
    editor.tools.cancel();clearPreview();setSpacePan(false);panelLayout.cancel();
    if(pendingCopy.current)pendingCopy.current.cancelled=true;
    capturedPointer.current=null;gesture.current=null;setResizingCursor(null);
  }
  function openWorkspaceLayout(){cancelWorkspaceGesture();setShowWorkspaceLayout(true);}

  const defaultShortcuts = new ShortcutRegistry([
    {id:'account',label:'Account',category:'Workspace',keys:SHORTCUT_BINDINGS.account,allowWhileBusy:true,run:()=>{cancelWorkspaceGesture();setShowAccount(true);}},
    {id:'chatgpt-connection',label:'ChatGPT connection',category:'Workspace',keys:SHORTCUT_BINDINGS['chatgpt-connection'],allowWhileBusy:true,run:()=>{cancelWorkspaceGesture();setShowChatGptConnection(true);}},
    {id:"recent-files",label:"Recent files",keys:SHORTCUT_BINDINGS["recent-files"],run:()=>{cancelWorkspaceGesture();setRecentRequest({});}},
    {id:"workspace-layout",label:"Workspace layout",keys:SHORTCUT_BINDINGS["workspace-layout"],run:openWorkspaceLayout},
    {id:"workspace-reset",label:"Restore default workspace arrangement",keys:SHORTCUT_BINDINGS["workspace-reset"],run:()=>attempt(()=>{panelLayout.restore();cancelWorkspaceGesture();})},
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
    ...(["smudge","mixer"] as const).map(key=>({id:key,label:key==="smudge"?"Smudge tool":"Mixer brush",keys:[],run:()=>chooseTool(key)})),
    ...TOOL_SHORTCUTS.map(([key, label, binding]) => ({
      id: key,
      label,
      keys: [binding],
      run: () => chooseTool(key),
    })),
    {
      id: "copy-pixels", label: "Copy selected image pixels", keys: SHORTCUT_BINDINGS["copy-pixels"],
      enabled: () => !busy && !pendingCopy.current && selected?.kind === "raster",
      run: () => {
        editor.tools.cancel();
        void task(async () => {
          const job = { pastes: 0, cancelled: false };
          pendingCopy.current = job;
          const document = editor.document;
          let revision = document.getSnapshot().revision;
          try {
            await editor.pixels.copy();
            while (job.pastes > 0 && !job.cancelled) {
              if (editor.document !== document || document.getSnapshot().revision !== revision)
                throw new Error("The document changed before queued paste. Try again.");
              job.pastes--;
              await editor.pixels.paste();
              revision = document.getSnapshot().revision;
            }
          } finally {
            pendingCopy.current = null;
          }
        });
      },
    },
    {
      id: "paste-pixels", label: "Paste pixels as new layer", keys: SHORTCUT_BINDINGS["paste-pixels"],
      allowWhileBusy: true,
      enabled: () => pendingCopy.current ? !pendingCopy.current.cancelled : !busy && editor.pixels.canPaste,
      run: () => {
        if (pendingCopy.current) { pendingCopy.current.pastes++; return; }
        editor.tools.cancel();
        void task(() => editor.pixels.paste());
      },
    },
    {
      id: "image-size", label: "Image size…", keys: SHORTCUT_BINDINGS["image-size"],
      enabled: () => !busy,
      run: () => { editor.tools.cancel(); setShowImageSizeDialog(true); },
    },
    {
      id: "canvas-cursors", label: customCursors ? "Use system canvas cursors" : "Use custom canvas cursors", keys: [],
      run: () => setCustomCursors(value => !value),
    },
    {
      id: "load-transparency", label: "Load layer transparency as selection", keys: [],
      enabled: () => !busy && (selected?.kind === "raster" || selected?.kind === "paint"),
      run: () => { editor.tools.cancel(); void task(() => editor.pixels.loadTransparency()); },
    },
    {
      id: "select-all",
      label: "Select canvas",
      keys: SHORTCUT_BINDINGS["select-all"],
      run: () => attempt(() => dom.selectAll()),
    },
    ...(["expand", "contract", "feather"] as const).map(operation => ({
      id: `selection-${operation}`, label: `${operation[0].toUpperCase()+operation.slice(1)} selection…`, keys: [],
      enabled: () => !busy && !!state.document.selection,
      run: () => { editor.tools.cancel(); setSelectionModification(operation); },
    })),
    {id:'select-color-range',label:'Select Color Range…',keys:[],enabled:()=>!busy,run:()=>{editor.tools.cancel();setShowColorRange(true);}},
    {id:'save-alpha-channel',label:'Save selection as alpha channel',keys:[],enabled:()=>!busy&&!!state.document.selection&&dom.alphaChannels.length<64,run:()=>attempt(()=>{dom.alphaChannels.capture(`Alpha ${dom.alphaChannels.length+1}`);})},
    {
      id: "deselect",
      label: "Deselect pixels",
      keys: SHORTCUT_BINDINGS["deselect"],
      run: () => attempt(() => dom.deselect()),
    },
    {
      id: "finish-path",
      label: tool === "crop" ? "Apply crop" : tool === "lasso" ? "Finish polygon selection" : "Finish path",
      keys: SHORTCUT_BINDINGS["finish-path"],
      run: () =>
        attempt(() =>
          tool === "crop"
            ? editor.tools.crop.apply()
            : editor.tools.finishPath(),
        ),
      enabled: () => tool === "pen" || tool === "crop" || editor.tools.drawingPolygonLasso,
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
    {id:'design-checks',label:'Design checks',keys:[],run:()=>setShowPreflight(true),enabled:()=>!busy},
    {id:'combine-vector-paths',label:'Combine vector paths…',keys:[],run:()=>{editor.tools.cancel();setShowVectorBoolean(true);},enabled:()=>!busy},
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
      label: tool === "crop" ? "Clear crop frame" : editor.tools.drawingPolygonLasso ? "Remove last polygon corner" : "Delete layer",
      keys: SHORTCUT_BINDINGS["delete"],
      run: () =>
        attempt(() => {
          if (tool === "crop") {
            editor.tools.crop.start(null);
            return;
          }
          if ((tool === "pen" || editor.tools.drawingPolygonLasso) && editor.tools.removeLastAnchor()) return;
          if (state.document.selection && (selectedObject instanceof PaintLayer || selectedObject instanceof RasterLayer))
            editor.tools.fillSelection(true);
          else if (dom.selectedLayers.length > 1) dom.layerSelection.remove();
          else selectedObject?.remove();
        }),
      enabled: () => tool === "crop" || editor.tools.drawingPolygonLasso || (!!selected && !locked),
    },
    {id:"develop-raw",label:"Develop RAW…",keys:[],enabled:()=>!busy&&!locked&&selectedObject instanceof SmartObjectLayer&&!!selectedObject.rawDevelopment,run:()=>{if(selectedObject instanceof SmartObjectLayer)setRawLayer(selectedObject);}},
    {id:"frequency-separation",label:"Frequency separation…",keys:[],enabled:()=>!busy&&!locked&&selectedObject instanceof RasterLayer,
      run:()=>{if(selectedObject instanceof RasterLayer){editor.tools.cancel();setFrequencySource(selectedObject.id);}}},
    ...(["curves", "levels", "tone", "hsl", "color-balance", "vibrance", "gradient-map", "white-balance", "lut", "red-eye"] as const).map((kind) => ({
      id: `new-${kind}-adjustment`,
      label: `New ${kind === "hsl" ? "HSL (Hue / Saturation / Lightness)" : kind === "color-balance" ? "Color Balance" : kind === "gradient-map" ? "Gradient Map" : kind === "white-balance" ? "White Balance" : kind === "lut" ? "Color Lookup (LUT)" : kind === "red-eye" ? "Red Eye" : kind[0].toUpperCase() + kind.slice(1)} adjustment layer`,
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
        if (!busy) void handleSelectSubject();
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
      showPreflight ||
      showRecovery ||
      showPalette ||
      !!recentRequest ||
      showHelp ||
      showWorkspaceLayout ||
      showChatGptConnection ||
      showAccount ||
      showPressureCurve ||
      showBrushTip ||
      showBrushTexture ||
      showBrushSymmetry ||
      showBrushPresets ||
      showScripts ||
      showPlugins ||
      showImageSizeDialog ||
      showArtboardDialog ||
      showCropDialog ||
      !!selectionModification ||
      showColorRange ||
      showVectorBoolean ||
      !!subjectProgress ||
      !!mattingProgress ||
      showExportDialog ||
      showGenerateDialog ||
      showRecipeDialog ||
      showBatchDialog ||
      showColorDialog ||
      showRefineEdgeDialog ||
      !!photoshopFile,
    onDismissModals: () => {
      setShowPressureCurve(false);
      setShowBrushTip(false);
      setShowBrushTexture(false);
      setShowBrushSymmetry(false);
      setShowBrushPresets(false);
      subjectAbort.current?.abort();
      mattingAbort.current?.abort();
      setShowRecovery(false);
      setShowPalette(false);
      setRecentRequest(null);
      setShowHelp(false);
      setShowWorkspaceLayout(false);
      setShowChatGptConnection(false);
      setShowAccount(false);
      setShowScripts(false);
      setShowPlugins(false);
      setShowImageSizeDialog(false);
      setShowArtboardDialog(false);
      setShowCropDialog(false);
      setSelectionModification(null);
      setShowColorRange(false);
      setShowVectorBoolean(false);
      setShowExportDialog(false);
      setShowGenerateDialog(false);
      setShowRecipeDialog(false);
      setShowBatchDialog(false);
      setShowColorDialog(false);
      setShowRefineEdgeDialog(false);
      setPhotoshopFile(null);
      setPreviewCandidate(null);
    },
    onSetSpacePan: setSpacePan,
    onClearPreview: clearPreview,
    onResetGestures: () => {
      if (pendingCopy.current) pendingCopy.current.cancelled = true;
      capturedPointer.current = null;
      gesture.current = null;
      setResizingCursor(null);
    },
  });

  // Unrelated status renders must not invalidate stationary cursor geometry.
  // Read current tool data at draw time, including preferences changed before
  // React flushes; these dependencies invalidate real geometry/viewport edits.
  const cursorAdapters = useMemo(() => ({
    footprint(tool: Tool, tilt?: ReturnType<typeof pointerPenTilt>) {
      return editor.tools.brushCursorAxes(tool, tilt, !!editor.tools.getSnapshot().settings.texture);
    },
    copies(tool: Tool, event: PointerEvent) {
      if (!editor.tools.getSnapshot().settings.symmetry) return null;
      return editor.tools.brushCursorCopies(tool, toCanvasPoint(event), event.pointerType === 'pen' ? pointerPenTilt(event) : undefined);
    },
  }), [editor, dom, state.document, state.selectedIds, toolState.settings, toolState.drawing, zoom, pan, viewportSize, panelLayout.widths.layers, panelLayout.widths.inspector, viewDocument.width, viewDocument.height]);

  const { rendering, renderBackend, paintedRegion } = useCanvasRenderer({
    editor,
    viewDocument,
    assets:wetPreview?.assets??assets,
    renderRegion,
    zoom,
    wetPreview,
    paintPreview: editor.tools.getSnapshot().paintPreview,
    previewGesture: preview && activePreview === preview ? gesture.current : null,
    gestureRef: gesture,
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
          layerContentBounds: selected.kind === 'raster' && selected.erasures?.some(entry => entry.stroke.kind === 'wet' && entry.stroke.opacity > 0) ? localBounds(selected) : undefined,
          layerFontSize:
            selected.kind === "text" ? selected.fontSize : undefined,
          layerText: selected.kind === "text" ? selected.text : undefined,
          layerFontFamily:
            selected.kind === "text" ? selected.fontFamily : undefined,
          layerLineHeight:
            selected.kind === "text" ? selected.lineHeight : undefined,
          layerTextStyle: selected.kind === 'text' ? {
            fontSize:selected.fontSize, fontFamily:selected.fontFamily,
            fontWeight:selected.fontWeight, fontStyle:selected.fontStyle,
            letterSpacing:selected.letterSpacing, wordSpacing:selected.wordSpacing,
            fontKerning:selected.fontKerning, direction:selected.direction,
            wrapWidth:selected.wrapWidth, paragraphSpacing:selected.paragraphSpacing, paragraphJustify:selected.paragraphJustify,
            firstLineIndent:selected.firstLineIndent,
          } : undefined,
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
      if (tool === "wand") {
        const settings = editor.tools.getSnapshot().settings;
        const operation = event.shiftKey && event.altKey ? "intersect" : event.shiftKey ? "add" : event.altKey ? "subtract" : settings.selectionMode;
        void task(() => editor.pixels.wand(point, { tolerance: settings.wandTolerance, contiguous: settings.wandContiguous, operation }));
        return;
      }
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
        editor.tools.begin(tool, point, modifiers(event,!!toolState.settings.pressureCurve,!!(toolState.settings.tip?.tiltAngle||toolState.settings.tip?.tiltRoundness)), zoom, cropHandle),
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
    if (editor.tools.getSnapshot().drawing || (editor.tools.drawingPolygonLasso && gesture.current?.kind !== "pan")) {
      attempt(() => {
        const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const sample of samples)
          editor.tools.move(toCanvasPoint(sample), modifiers(sample,!!toolState.settings.pressureCurve,!!(toolState.settings.tip?.tiltAngle||toolState.settings.tip?.tiltRoundness)));
        editor.tools.move(point, modifiers(event,!!toolState.settings.pressureCurve,!!(toolState.settings.tip?.tiltAngle||toolState.settings.tip?.tiltRoundness)));
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
    const snapshot = dom.getSnapshot().document;
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
      attempt(() => editor.tools.move(toCanvasPoint(event), modifiers(event,!!toolState.settings.pressureCurve,!!(toolState.settings.tip?.tiltAngle||toolState.settings.tip?.tiltRoundness))));
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

  const handleImportFile=(file:File)=>{
    if(isCameraRawFile(file)){setRawFile(file);return;}
    if(file.type==='image/svg+xml'||/\.svg$/i.test(file.name)){setSvgFile(file);return;}
    if(['image/tiff','image/x-tiff'].includes(file.type)||/\.tiff?$/i.test(file.name)){setTiffFile(file);return;}
    if(file.type==='image/avif'||/\.avif$/i.test(file.name)){setAvifFile(file);return;}
    void task(async()=>{await editor.importImage(file);notify('Image added');});
  };

  const handlePsdFile=(file:File)=>setPhotoshopFile({file,id:++photoshopRequest.current});
  const openRecentFile=(file:File,kind:RecentKind)=>{
    if(kind==='svg'){setSvgFile(file);return;}
    if(kind==='tiff'){setTiffFile(file);return;}
    if(kind==='avif'){setAvifFile(file);return;}
    if(kind==='raw'){setRawFile(file);return;}
    if(kind==='photoshop'){handlePsdFile(file);return;}
    void task(async()=>{if(kind==='project')await editor.openProject(file);else await editor.openImage(file);notify('Local recent-file copy opened');});
  };


  const handleSelectSubject = async () => {
    await task(async () => {
      const abort=new AbortController();subjectAbort.current=abort;setSubjectProgress({completed:0,total:1});
      try {
        await editor.selectSubject({}, {signal:abort.signal,onProgress:setSubjectProgress});
        notify("Subject selected");
      } catch (err) {
        if(abort.signal.aborted)return;
        notify(
          `Select subject failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }finally{if(subjectAbort.current===abort)subjectAbort.current=null;setSubjectProgress(null);}
    });
  };

  const handleRemoveBackground = async () => {
    await task(async () => {
      const abort=new AbortController();mattingAbort.current=abort;setMattingProgress({completed:0,total:1});
      try {
        await editor.removeBackground(undefined,{}, {signal:abort.signal,onProgress:setMattingProgress});
        notify("Background removed");
      } catch (err) {
        if(abort.signal.aborted)return;
        notify(
          `Remove background failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }finally{if(mattingAbort.current===abort)mattingAbort.current=null;setMattingProgress(null);}
    });
  };

  return (
    <ShortcutHints.Provider value={activeOverrides}>
      <div className="app-shell">
        <input
          ref={importInput}
          data-testid="import-input"
          type="file"
          accept={`image/png,image/jpeg,image/webp,image/svg+xml,.svg,image/tiff,.tif,.tiff,image/avif,.avif,${rawFileAccept}`}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if(file)handleImportFile(file);
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
        {recentRequest&&<RecentFilesDialog library={editor.recentFiles} initialId={recentRequest.id} onClose={()=>setRecentRequest(null)} onOpen={openRecentFile}/>}
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
          recentFilesControl={<RecentFilesButton library={editor.recentFiles} disabled={busy} onOpen={()=>{cancelWorkspaceGesture();setRecentRequest({});}}/>}
          chatGptControl={<ChatGptConnectionButton editor={editor} disabled={false} onOpen={()=>{cancelWorkspaceGesture();setShowChatGptConnection(true);}}/>}
          accountControl={<AccountButton client={accountClient} onOpen={()=>{cancelWorkspaceGesture();setShowAccount(true);}}/>}
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
        <WorkspaceDock
          layout={panelLayout.layout}
          style={
            {
              "--layers-width": `${panelLayout.widths.layers}px`,
              "--inspector-width": `${panelLayout.widths.inspector}px`,
            } as import("react").CSSProperties
          }
          rail={
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
            onOpenPreflight={()=>setShowPreflight(true)}
            onOpenWorkspace={openWorkspaceLayout}
            onOpenRecovery={() => setShowRecovery(true)}
          />
          }
          layers={
          <LayersPanel
            deferThumbnails={toolState.drawing}
            onLoadTransparency={id => { editor.tools.cancel(); void task(() => editor.pixels.loadTransparency(id)); }}
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
            pixels={editor.pixels}
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
          }
          layersResize={
          <PanelResizeHandle
            label="Resize layers panel"
            value={panelLayout.widths.layers}
            min={190}
            max={panelLayout.max("layers")}
            direction={panelLayout.layout.panels.layers.side==='left'?1:-1}
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
          }
          canvas={
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
              onBrushPresets={()=>{editor.tools.cancel();setShowBrushPresets(true);}}
              onBrushSymmetry={()=>{editor.tools.cancel();setShowBrushSymmetry(true);}}
              onBrushTip={()=>{editor.tools.cancel();setShowBrushTip(true);}}
              onBrushTexture={()=>{editor.tools.cancel();setShowBrushTexture(true);}}
              onPressureCurve={()=>{editor.tools.cancel();setShowPressureCurve(true);}}
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
              hasSelection={!!state.document.selection}
              disabled={busy || locked}
              onAction={attempt}
              onModifySelection={() => { editor.tools.cancel(); setSelectionModification("expand"); }}
              onColorRange={()=>{editor.tools.cancel();setShowColorRange(true);}}
              onOpenImageSize={() => { editor.tools.cancel(); setShowImageSizeDialog(true); }}
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
                  editor.tools.drawingPolygonLasso ||
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
                if(file)handleImportFile(file);
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
                  cursorStore={cursorStore}
                  showBrushCursor={!customCursors}
                  onError={setError}
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
              <CanvasCursor viewport={viewport} enabled={customCursors} copies={cursorAdapters.copies} texturePreview={texturePreview.url} footprint={cursorAdapters.footprint} tool={tool} spacePan={spacePan} size={tool==='quick-select'?toolState.settings.quickSize:toolState.settings.size} zoom={zoom} />
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
                      PNG, JPG, WEBP, SVG · Original resolution preserved
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
          }
          inspectorResize={
          <PanelResizeHandle
            label="Resize inspector panel"
            value={panelLayout.widths.inspector}
            min={230}
            max={panelLayout.max("inspector")}
            direction={panelLayout.layout.panels.inspector.side==='left'?1:-1}
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
          }
          inspector={
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
            onDevelopRaw={layer=>setRawLayer(layer)}
            onCombinePaths={()=>{editor.tools.cancel();setShowVectorBoolean(true);}}
          />
          }
        />

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
        {selectionModification && <SelectionModifyDialog operation={selectionModification}
          onApply={(options,control) => dom.modifySelection(options,control)} onClose={() => setSelectionModification(null)} />}
        {showColorRange&&<ColorRangeDialog editor={editor} onClose={()=>setShowColorRange(false)}/>}
        {showVectorBoolean&&<VectorBooleanDialog key={dom.id} document={dom} onClose={()=>setShowVectorBoolean(false)} onResult={path=>{if(editor.document===dom)editor.tools.selectVectorPath(path);}}/>}
        {subjectProgress&&<SubjectSelectionProgress progress={subjectProgress} onCancel={()=>subjectAbort.current?.abort()}/>}
        {mattingProgress&&<SubjectSelectionProgress title="Remove Background" description={mattingProgress.phase==='solve'?`Solving the global matte · iteration ${mattingProgress.iteration??0}`:"Refining the selected raster's native matte…"} progress={mattingProgress} onCancel={()=>mattingAbort.current?.abort()}/>}
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
        {frequencySource&&<FrequencySeparationDialog editor={editor} layerId={frequencySource} onClose={()=>setFrequencySource(null)} onBusyChange={setBusy} onCreated={()=>notify("Frequency layers created")}/>}
        {showImageSizeDialog && (
          <ArtboardDialog mode="image" currentWidth={dom.width} currentHeight={dom.height}
            onResize={(width, height) => { editor.tools.cancel(); dom.resizeImage(width, height); notify(`Resized image to ${width} × ${height} px`); }}
            onClose={() => setShowImageSizeDialog(false)} />
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
          <WorkspaceCommandPalette
            editor={editor}
            onRecent={entry=>{cancelWorkspaceGesture();setRecentRequest({id:entry.id!});}}
            actions={shortcuts.actions}
            busy={busy}
            onClose={() => setShowPalette(false)}
            onExecute={(action) => {
              flushSync(() => setShowPalette(false));
              if (action.enabled?.() !== false) action.run();
            }}
          />
        )}
        {showBrushPresets&&<BrushPresetsDialog library={editor.brushPresets} sourceOwner={editor.brushTextureSource} tool={tool as import('../brushes/presets').BrushTool} settings={toolState.settings} onClose={()=>setShowBrushPresets(false)} onApply={async(preset,signal)=>{await editor.applyBrushPreset(preset,{signal,selectTool:chooseTool});setShowBrushPresets(false);}}/>}
        {showBrushSymmetry&&<BrushSymmetryDialog symmetry={toolState.settings.symmetry} width={dom.width} height={dom.height} onClose={()=>setShowBrushSymmetry(false)} onApply={symmetry=>{editor.tools.configure({symmetry});setShowBrushSymmetry(false);}}/>}
        {showBrushTip&&<BrushTipDialog tip={toolState.settings.tip} pencil={tool==="pencil"} onClose={()=>setShowBrushTip(false)} onApply={tip=>{editor.tools.configure({tip});setShowBrushTip(false);}}/>}
        {showBrushTexture&&<BrushTextureDialog editor={editor} onClose={()=>setShowBrushTexture(false)}/>}
        {showPressureCurve&&<PressureCurveDialog curve={toolState.settings.pressureCurve} onClose={()=>setShowPressureCurve(false)} onApply={curve=>{editor.tools.configure({pressureCurve:curve});setShowPressureCurve(false);}}/>}
        {showWorkspaceLayout&&<WorkspaceLayoutDialog preferences={panelLayout.preferences} loadError={panelLayout.error} onApply={layout=>{panelLayout.apply(layout);cancelWorkspaceGesture();}} onSave={(layout,name,id)=>{panelLayout.save(layout,name,id);cancelWorkspaceGesture();}} onRename={panelLayout.rename} onDelete={panelLayout.remove} onReload={panelLayout.reload} onClose={()=>setShowWorkspaceLayout(false)}/>}
        {showAccount&&<AccountDialog client={accountClient} onClose={()=>setShowAccount(false)}/>}
        {showChatGptConnection&&<ChatGptConnectionDialog editor={editor} onClose={()=>setShowChatGptConnection(false)}/>}
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
            recordingOptions={recipeRecordingOptions}
            onRecordingOptionsChange={setRecipeRecordingOptions}
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
            onExport={async (options, control) => {
              await task(async () => {
                let result;
                try { result = await editor.export(options, control); }
                catch (error) { if (control?.signal?.aborted) return; throw error; }
                if (control?.signal?.aborted) return;
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
        {svgFile&&<SvgImportDialog file={svgFile} editor={editor} onClose={()=>setSvgFile(null)} onBusyChange={setBusy} onImported={()=>notify("SVG imported")}/>}
        {tiffFile&&<TiffImportDialog file={tiffFile} editor={editor} onClose={()=>setTiffFile(null)} onBusyChange={setBusy} onImported={()=>notify("TIFF page imported")}/>}
        {(rawFile||rawLayer)&&<RawDevelopmentDialog editor={editor} file={rawFile??undefined} layer={rawLayer??undefined} onClose={()=>{setRawFile(null);setRawLayer(null);}} onBusyChange={setBusy} onApplied={()=>notify(rawFile?'RAW image imported':'RAW development applied')}/>}
        {avifFile&&<AvifImportDialog file={avifFile} editor={editor} onClose={()=>setAvifFile(null)} onBusyChange={setBusy} onImported={()=>notify("AVIF image imported")}/>}
        {photoshopFile&&<PhotoshopImportDialog key={photoshopFile.id} file={photoshopFile.file} editor={editor} onClose={()=>setPhotoshopFile(null)} onBusyChange={setBusy} onImported={()=>notify("Photoshop file imported")}/>}
        {showPreflight&&<PreflightDialog editor={editor} onClose={()=>setShowPreflight(false)}/>}
        {showRefineEdgeDialog && (
          <RefineEdgeDialog
            editor={editor}
            onClose={() => setShowRefineEdgeDialog(false)}
            onApply={async (options,control) => {
              await editor.refineEdge(options,control);
              notify("Edge refined");
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
            hasSelection={!!state.document.selection}
            hasMask={!!selected?.mask}
            hasVectorMask={selected?.mask?.kind === "vector"}
            moveTarget={movingMask ? "mask" : "layer"}
            onMoveTarget={setMoveTarget}
            selectedLayer={selectedObject}
            locked={locked}
            onChooseTool={chooseTool}
            onAddLayer={addLayer}
            onAddAdjustmentLayer={addAdjustmentLayer}
            onFrequencySeparation={selectedObject instanceof RasterLayer ? () => setFrequencySource(selectedObject.id) : undefined}
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
