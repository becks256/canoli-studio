import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { EditorApplication } from "../../editor";
import type { DocumentData } from "../../core/model";
import type { RenderOptions, RenderRegion } from "../../engine/renderer";
import type { WetPaintPreview } from '../../engine/wet-preview';

export interface UseCanvasRendererOptions {
  editor: EditorApplication;
  viewDocument: DocumentData;
  assets: EditorApplication["assets"];
  renderRegion: RenderRegion;
  zoom: number;
  paintPreview: RenderOptions["paintPreview"];
  wetPreview?: WetPaintPreview | null;
  previewGesture?: object | null;
  gestureRef?: RefObject<object | null>;
  backendState: unknown;
  displayHost: RefObject<HTMLDivElement | null>;
  onCleanupCursor?(): void;
  onError?(message: string): void;
}

export interface UseCanvasRendererResult {
  rendering: boolean;
  renderBackend: "webgpu" | "canvas2d" | null;
  paintedRegion: RenderRegion;
}

export function useCanvasRenderer({
  editor,
  viewDocument,
  assets,
  renderRegion,
  zoom,
  paintPreview,
  wetPreview,
  previewGesture,
  gestureRef,
  backendState,
  displayHost,
  onCleanupCursor,
  onError,
}: UseCanvasRendererOptions): UseCanvasRendererResult {
  const [rendering, setRendering] = useState(false);
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    const changed = () => setFontRevision((value) => value + 1);
    fonts?.addEventListener("loadingdone", changed);
    fonts?.addEventListener("loadingerror", changed);
    return () => {
      fonts?.removeEventListener("loadingdone", changed);
      fonts?.removeEventListener("loadingerror", changed);
    };
  }, []);

  const [renderBackend, setRenderBackend] = useState<
    "webgpu" | "canvas2d" | null
  >(null);
  const [paintedRegion, setPaintedRegion] = useState<RenderRegion>({
    x: 0,
    y: 0,
    width: 1600,
    height: 1200,
  });

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onCleanupCursorRef = useRef(onCleanupCursor);
  onCleanupCursorRef.current = onCleanupCursor;

  const latestRender = useRef<{
    document: DocumentData;
    assets: typeof assets;
    key: number;
    options: RenderOptions;
    region: RenderRegion;
    gesture?: object | null;
    sourceDocument: DocumentData;
    zoom: number;
    fontRevision: number;
    backendState: unknown;
    hostAssets: typeof assets;
    wetPreview?: WetPaintPreview | null;
    release?: () => void;
  } | null>(null);
  const renderTarget = useRef<typeof latestRender.current>(null);
  const renderActive = useRef(false);
  const renderVersion = useRef(0);
  const gestureFrame = useRef<{ gesture: object; ready: Promise<void> } | null>(null);

  const isObsolete = (job: NonNullable<typeof latestRender.current>): boolean => {
    const target = renderTarget.current;
    // An older prefix of the SAME live stroke may be displayed while
    // its next frame waits. Never show an old revision/view/gesture.
    const sameStroke =
      target &&
      job.options.paintPreview &&
      target.options.paintPreview?.stroke.id ===
        job.options.paintPreview.stroke.id &&
      target.options.paintPreview.layerId ===
        job.options.paintPreview.layerId &&
      target.options.paintPreview.maskMode ===
        job.options.paintPreview.maskMode &&
      target.document === job.document &&
      target.assets === job.assets &&
      target.region === job.region &&
      target.fontRevision === job.fontRevision &&
      target.backendState === job.backendState &&
      target.options.scale === job.options.scale;

    const sameGesture = target && job.gesture &&
      target.gesture === job.gesture && gestureRef?.current === job.gesture &&
      target.sourceDocument === job.sourceDocument &&
      editor.document.getSnapshot().document === job.sourceDocument &&
      target.assets === job.assets && editor.assetStore === job.assets &&
      target.region === job.region && target.zoom === job.zoom &&
      target.fontRevision === job.fontRevision &&
      target.backendState === job.backendState;

    const sameWet=target&&job.wetPreview&&target.wetPreview?.owner===job.wetPreview.owner&&
      job.wetPreview.isCurrent()&&target.sourceDocument===job.sourceDocument&&
      target.hostAssets===job.hostAssets&&target.region===job.region&&target.zoom===job.zoom&&
      target.fontRevision===job.fontRevision&&target.backendState===job.backendState;

    return !!(
      editor.document.getSnapshot().document !== job.sourceDocument ||
      editor.assetStore !== job.hostAssets ||
      (job.wetPreview&&!job.wetPreview.isCurrent()) ||
      job.options.paintPreview?.cloneSource?.isDisposed ||
      (job.gesture && (gestureRef?.current !== job.gesture ||
        editor.document.getSnapshot().document !== job.sourceDocument)) ||
      (!sameStroke && !sameGesture && !sameWet && job.key !== renderVersion.current) ||
      !displayHost.current
    );
  };


  useLayoutEffect(() => {
    const key = ++renderVersion.current;
    latestRender.current?.release?.();
    latestRender.current = {
      document: viewDocument,
      gesture: previewGesture,
      sourceDocument: editor.document.getSnapshot().document,
      zoom, fontRevision, backendState,
      assets,
      hostAssets:wetPreview?.hostAssets??assets,
      wetPreview,
      release:wetPreview&&!wetPreview.isDisposed?wetPreview.retain():undefined,
      key,
      region: renderRegion,
      options: {
        region: renderRegion,
        scale: Math.min(1, zoom * window.devicePixelRatio),
        paintPreview,
      },
    };
    renderTarget.current = latestRender.current;

    async function drain() {
      if (renderActive.current) return;
      renderActive.current = true;
      const showRenderingStatus = !paintPreview;
      if (showRenderingStatus) setRendering(true);
      try {
        while (latestRender.current) {
          // Paint is already frame-batched by ToolController. Transforms and
          // wet prefixes share the boundary their previous preparation requested;
          // if that boundary passed during preparation, do not wait a new frame.
          // This permits at most one start per animation frame for the gesture.
          const queued = latestRender.current;
          if (!queued.options.paintPreview) {
            const prior = gestureFrame.current;
            const cadence = queued.gesture ?? queued.wetPreview?.owner;
            if (cadence && prior?.gesture === cadence) await prior.ready;
            else if (!queued.wetPreview) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
          if (!latestRender.current) break;
          const job = latestRender.current;
          latestRender.current = null;
          const cadence = job.gesture ?? job.wetPreview?.owner;
          gestureFrame.current = cadence ? {
            gesture: cadence,
            ready: new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
          } : null;
          job.options = { ...job.options, isCancelled: () => isObsolete(job) };
          try {
            if(isObsolete(job))continue;
            let result = await editor.renderer.prepareViewport(
              job.document,
              job.assets,
              job.options,
            );
            if (isObsolete(job)) {
              result.dispose();
              continue;
            }

            const present = () => {
              const host = displayHost.current!;
              let canvas = host.querySelector("canvas");
              if (!canvas || canvas.dataset.renderer !== result.backend) {
                canvas = document.createElement("canvas");
                canvas.dataset.renderer = result.backend;
                canvas.dataset.testid = "artwork";
                canvas.setAttribute("aria-label", "Document artwork");
                // A canvas context cannot switch between WebGPU and Canvas2D.
                // Present before replacing the currently visible frame.
                result.present(canvas);
                host.replaceChildren(canvas);
              } else {
                result.present(canvas);
              }
            };

            try {
              try {
                present();
              } catch {
                result.dispose();
                result = await editor.renderer.prepareFallback(
                  job.document,
                  job.assets,
                  job.options,
                );
                if (isObsolete(job)) {
                  continue;
                }
                present();
              }
            } finally {
              result.dispose();
            }

            setRenderBackend(result.backend);
            setPaintedRegion(job.region);
          } catch (cause) {
            if (!isObsolete(job) && onErrorRef.current) {
              onErrorRef.current(
                cause instanceof Error ? cause.message : "Rendering failed.",
              );
            }
          } finally { job.release?.(); }
        }
      } finally {
        renderActive.current = false;
        if (showRenderingStatus) setRendering(false);
      }
    }

    void drain();
    // Continue the captured live stroke directly from the tool's frame batch.
    // New strokes, document edits and viewport changes still enter via React.
    const sourceDocument = editor.document.getSnapshot().document;
    const previewCommand = editor.tools.getSnapshot().preview;
    let seenPreview = paintPreview;
    return editor.tools.subscribe(() => {
      const state = editor.tools.getSnapshot();
      const next = state.paintPreview;
      if (!next || next === seenPreview || !paintPreview ||
          next.stroke.id !== paintPreview.stroke.id ||
          next.layerId !== paintPreview.layerId || next.maskMode !== paintPreview.maskMode ||
          state.preview !== previewCommand ||
          editor.document.getSnapshot().document !== sourceDocument) return;
      seenPreview = next;
      const key = ++renderVersion.current;
      latestRender.current?.release?.();
      latestRender.current = {
        document: viewDocument, assets, key, region: renderRegion,
        hostAssets:assets,
        gesture: previewGesture, sourceDocument, zoom, fontRevision, backendState,
        options: { region: renderRegion, scale: Math.min(1, zoom * window.devicePixelRatio), paintPreview: next },
      };
      renderTarget.current = latestRender.current;
      void drain();
    });
  }, [
    viewDocument,
    assets,
    editor,
    renderRegion,
    zoom,
    paintPreview,
    wetPreview,
    previewGesture,
    gestureRef,
    backendState,
    fontRevision,
    displayHost,
  ]);

  useEffect(
    () => () => {
      renderVersion.current++;
      latestRender.current?.release?.();
      latestRender.current = null;
      renderTarget.current = null;
      onCleanupCursorRef.current?.();
      editor.tools.cancel();
    },
    [editor],
  );

  return {
    rendering,
    renderBackend,
    paintedRegion,
  };
}
