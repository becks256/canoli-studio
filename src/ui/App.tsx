import {
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
import {
  LayerGroup,
  PaintLayer,
  TextLayer,
} from "../dom";
import { execute } from "../core/commands";
import type { EditorCommand, LayerPatch } from "../core/commands";
import {
  allLayers,
  findLayer,
  findParent,
  isLocked,
} from "../core/model";
import { hitTest, layerBounds } from "../core/spatial";
import {
  ShortcutRegistry,
  SHORTCUT_BINDINGS,
  TOOL_SHORTCUTS,
  brushSizeKeys,
  nudgeKeys,
} from "./shortcuts";
import {
  Button,
  IconButton,
} from "./controls";
import { ArtboardDialog } from "./ArtboardDialog";
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

export { TextProperties, TypographyPanel };

export function App({ editor }: { editor: EditorApplication }) {
  const {
    document: dom,
    state,
    assets,
  } = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const backendState = useSyncExternalStore(editor.renderer.subscribeBackend, editor.renderer.getBackendSnapshot);
  const [preview, setPreview] = useState<EditorCommand | null>(null);
  const [tool, setTool] = useState<Tool>("move");
  const toolSizes = useRef({ brush: 24, pencil: 1 });
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
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showScripts, setShowScripts] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showArtboardDialog, setShowArtboardDialog] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [savedStamp, setSavedStamp] = useState("");
  const [resizingCursor, setResizingCursor] = useState<"nwse" | "nesw" | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const displayHost = useRef<HTMLDivElement>(null);
  const capturedPointer = useRef<number | null>(null);
  const gesture = useRef<
    | null
    | { kind: "pan"; startX: number; startY: number; x: number; y: number }
    | {
        kind: "move";
        startX: number;
        startY: number;
        x: number;
        y: number;
        id: string;
        dx: number;
        dy: number;
      }
    | {
        kind: "resize";
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
  const selectedObject = dom.getLayer(state.selectedId);
  const locked = selected ? isLocked(viewDocument, selected.id) : false;
  const isResizable = selected
    ? !locked && (selected.kind === "raster" || selected.kind === "text")
    : false;
  const bounds = selected ? layerBounds(viewDocument, selected.id) : undefined;
  const stamp = `${dom.id}:${state.revision}`;
  const renderRegion = useMemo(() => {
    return computeVisibleRegion(dom, viewportSize, pan, zoom);
  }, [dom, viewportSize, zoom, pan]);

  function chooseTool(next: Tool) {
    editor.tools.cancel();
    setPreview(null);
    updateCursor(null);
    if (tool === "pencil")
      toolSizes.current.pencil = editor.tools.getSnapshot().settings.size;
    else if (tool === "brush" || tool === "clone")
      toolSizes.current.brush = editor.tools.getSnapshot().settings.size;
    if (next === "pencil")
      editor.tools.configure({ size: toolSizes.current.pencil });
    else if (next === "brush" || next === "clone")
      editor.tools.configure({ size: toolSizes.current.brush });
    if (next === "artboard") {
      setShowArtboardDialog(true);
    }
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
    download(editor.saveProject(), `${fileName(dom.name)}.luma`);
    setSavedStamp(stamp);
    notify("Project downloaded. Keep this file to reopen your edits.");
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
  function nudge(x: number, y: number) {
    selectedAction((layer) => layer.update({ x: layer.x + x, y: layer.y + y }));
  }

  const shortcuts = new ShortcutRegistry([
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
      label: "Finish path",
      keys: SHORTCUT_BINDINGS["finish-path"],
      run: () => editor.tools.finishPath(),
      enabled: () => tool === "pen",
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
      enabled: () => ["brush", "pencil", "clone"].includes(tool),
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
      label: "Export PNG",
      keys: SHORTCUT_BINDINGS["export"],
      run: exportPng,
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
      label: "Delete layer",
      keys: SHORTCUT_BINDINGS["delete"],
      run: () =>
        attempt(() => {
          if (tool === "pen" && editor.tools.removeLastAnchor()) return;
          if (dom.selection && selectedObject instanceof PaintLayer)
            editor.tools.fillSelection(true);
          else selectedObject?.remove();
        }),
      enabled: () => !!selected && !locked,
    },
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
        enabled: () => !!selected && !locked,
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
      id: "help",
      label: "Keyboard shortcuts",
      keys: SHORTCUT_BINDINGS["help"],
      run: () => setShowHelp(true),
    },
  ]);
  const wasmReady = useWasmReady(editor, setError);

  useUnsavedChangesWarning(dom, stamp, savedStamp);

  useWheelZoom(viewport, (factor) => changeZoom(factor));

  useViewportObserver({
    viewportRef: viewport,
    dom,
    onResize: setViewportSize,
    onFit: fit,
    onClearPreview: () => setPreview(null),
  });

  useEditorShortcuts({
    shortcuts,
    editor,
    busy,
    modalOpen: showHelp || showScripts || showPlugins || showArtboardDialog,
    onDismissModals: () => {
      setShowHelp(false);
      setShowScripts(false);
      setShowPlugins(false);
      setShowArtboardDialog(false);
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
      if (cursorFrame.current !== null) cancelAnimationFrame(cursorFrame.current);
    },
    onError: setError,
  });

  function toCanvasPoint(event: { clientX: number; clientY: number }) {
    const rect = displayHost.current!.parentElement!.getBoundingClientRect();
    return canvasPoint(event, rect, zoom);
  }
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      busy ||
      capturedPointer.current !== null ||
      ![0, 1].includes(event.button) ||
      (event.target as HTMLElement).closest("button")
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
    if (tool === "move" && event.button === 0) {
      const handleTarget = (event.target as HTMLElement).closest("[data-handle]") as HTMLElement | null;
      const handle = handleTarget?.getAttribute("data-handle") as "nw" | "ne" | "sw" | "se" | null;
      if (handle && selected && !locked && (selected.kind === "raster" || selected.kind === "text")) {
        gesture.current = {
          kind: "resize",
          handle,
          startX: event.clientX,
          startY: event.clientY,
          layerX: selected.x,
          layerY: selected.y,
          layerWidth: selected.width,
          layerHeight: selected.height,
          layerFontSize: selected.kind === "text" ? selected.fontSize : undefined,
          layerText: selected.kind === "text" ? selected.text : undefined,
          layerFontFamily: selected.kind === "text" ? selected.fontFamily : undefined,
          layerLineHeight: selected.kind === "text" ? selected.lineHeight : undefined,
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
      attempt(() => editor.tools.begin(tool, point, modifiers(event), zoom));
      return;
    }
    const inSelectedGroup =
      selected?.kind === "group" &&
      bounds &&
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height;
    const hit = inSelectedGroup
      ? selected.id
      : hitTest(state.document, point.x, point.y);
    dom.selectedLayer = dom.getLayer(hit);
    const layer = findLayer(state.document, hit);
    if (layer && !isLocked(state.document, layer.id))
      gesture.current = {
        kind: "move",
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
    if (capturedPointer.current !== null && capturedPointer.current !== event.pointerId) return;
    const point = toCanvasPoint(event);
    updateCursor(point);
    if (editor.tools.getSnapshot().drawing) {
      attempt(() => {
        const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const sample of samples) editor.tools.move(toCanvasPoint(sample), modifiers(sample));
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
    if (drag.kind === "resize") {
      const dx = (event.clientX - drag.startX) / zoom;
      const dy = (event.clientY - drag.startY) / zoom;
      const patch = computeResizePatch(drag, dx, dy, event.shiftKey);
      drag.patch = patch;
      setPreview({
        type: "layer.update",
        id: drag.id,
        patch,
      });
      return;
    }
    drag.dx = Math.round((event.clientX - drag.startX) / zoom);
    drag.dy = Math.round((event.clientY - drag.startY) / zoom);
    setPreview({
      type: "layer.update",
      id: drag.id,
      patch: {
        x: Math.max(
          -Number.MAX_SAFE_INTEGER,
          Math.min(Number.MAX_SAFE_INTEGER, drag.x + drag.dx),
        ),
        y: Math.max(
          -Number.MAX_SAFE_INTEGER,
          Math.min(Number.MAX_SAFE_INTEGER, drag.y + drag.dy),
        ),
      },
    });
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (capturedPointer.current !== event.pointerId) return;
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
      attempt(() =>
        dom.getLayer(drag.id)?.update({
          x: Math.max(
            -Number.MAX_SAFE_INTEGER,
            Math.min(Number.MAX_SAFE_INTEGER, drag.x + drag.dx),
          ),
          y: Math.max(
            -Number.MAX_SAFE_INTEGER,
            Math.min(Number.MAX_SAFE_INTEGER, drag.y + drag.dy),
          ),
        }),
      );
    else if (drag?.kind === "resize" && Object.keys(drag.patch).length > 0) {
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

  return (
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
              setSavedStamp("");
            });
        }}
      />
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
      />
      <div className="workspace">
        <ToolRail
          tool={tool}
          spacePan={spacePan}
          busy={busy}
          onChooseTool={chooseTool}
          onImport={() => importInput.current?.click()}
          onNewDocument={() => {
            if (
              !dom.layers.length ||
              window.confirm(
                "Start a new document? Download your project first to keep your edits.",
              )
            )
              editor.newDocument();
          }}
          onOpenScripts={() => setShowScripts(true)}
          onOpenPlugins={() => setShowPlugins(true)}
          onOpenHelp={() => setShowHelp(true)}
        />
        <LayersPanel
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
          onSelectLayer={(layer) => {
            dom.selectedLayer = layer;
          }}
          onAddLayer={addLayer}
          onAddGroup={addGroup}
          onDuplicateLayer={() =>
            selectedAction((layer) => {
              dom.selectedLayer = layer.duplicate();
            })
          }
          onMoveLayerForward={() => selectedAction((layer) => layer.moveUp())}
          onMoveLayerBackward={() => selectedAction((layer) => layer.moveDown())}
          onDeleteLayer={() => selectedAction((layer) => layer.remove())}
        />
        <main className="canvas-column">
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
            <button onClick={fit} title="Fit canvas (Mod+0)">
              <Maximize size={13} />
              Fit
            </button>
          </div>
          <ToolOptions
            tool={tool}
            controller={editor.tools}
            settings={toolState.settings}
            hasSelection={!!dom.selection}
            disabled={busy || locked}
            onAction={attempt}
            onOpenArtboard={() => setShowArtboardDialog(true)}
          />
          <div
            ref={viewport}
            className={`viewport ${tool === "hand" || spacePan ? "hand" : `tool-${tool}`} ${resizingCursor ? `resizing-${resizingCursor}` : ""}`}
            tabIndex={-1}
            aria-label="Editing canvas"
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
            <div
              className="canvas-wrap"
              style={{
                width: viewDocument.width * zoom,
                height: viewDocument.height * zoom,
                transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
              }}
            >
              <span className="canvas-label">{dom.name.toUpperCase()}</span>
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
              <CanvasOverlays
                document={viewDocument}
                selected={selected}
                tool={tool}
                zoom={zoom}
                controller={editor.tools}
                cursor={cursor}
              />
              {bounds && selected?.visible && tool === "move" && (
                <div
                  className={`selection-outline ${locked ? "locked" : ""}`}
                  style={{
                    left: bounds.x * zoom,
                    top: bounds.y * zoom,
                    width: bounds.width * zoom,
                    height: bounds.height * zoom,
                  }}
                >
                  {isResizable ? (
                    <>
                      <i className="handle handle-nw" data-handle="nw" title="Resize" />
                      <i className="handle handle-ne" data-handle="ne" title="Resize" />
                      <i className="handle handle-sw" data-handle="sw" title="Resize" />
                      <i className="handle handle-se" data-handle="se" title="Resize" />
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
            {!dom.layers.length && (tool === "move" || tool === "hand") && (
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
                <small>PNG, JPG, WEBP · Original resolution preserved</small>
              </div>
            )}
            <div className="zoom-control">
              <IconButton label="Zoom out" onClick={() => changeZoom(1 / 1.2)}>
                <Minus size={14} />
              </IconButton>
              <button aria-label="Zoom level, click to fit" onClick={fit}>
                {Math.round(zoom * 100)}%
              </button>
              <IconButton label="Zoom in" onClick={() => changeZoom(1.2)}>
                <Plus size={14} />
              </IconButton>
              <span />
              <IconButton label="Fit canvas (Mod+0)" onClick={fit}>
                <Maximize size={14} />
              </IconButton>
            </div>
          </div>
          <footer className="canvas-status">
            <span aria-label="Rendering backend" title={renderBackend === "webgpu" ? "WebGPU viewport acceleration" : "Canvas rendering with WASM processing"}>
              {renderBackend === "webgpu" ? "GPU accelerated" : "Standard rendering"}
            </span>
            <span>
              <span
                className={`status-dot ${rendering || busy ? "working" : ""}`}
              />
              {busy ? "Working…" : rendering ? "Rendering…" : "Ready"}
              <span className="footer-divider">/</span>
              {viewDocument.width} × {viewDocument.height} px
              <span className="footer-divider">/</span>sRGB
            </span>
            <span>
              {savedStamp === stamp
                ? "Project downloaded"
                : "Local session · Save to keep edits"}
            </span>
          </footer>
        </main>
        <InspectorPanel
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
      {showHelp && (
        <ShortcutDialog
          shortcuts={shortcuts}
          onClose={() => setShowHelp(false)}
        />
      )}
      {showScripts && (
        <ScriptPanel editor={editor} onClose={() => setShowScripts(false)} />
      )}
    </div>
  );
}

