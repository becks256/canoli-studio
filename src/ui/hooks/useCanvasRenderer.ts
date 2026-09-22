import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { EditorApplication } from "../../editor";
import type { DocumentData } from "../../core/model";
import type { RenderOptions, RenderRegion } from "../../engine/renderer";

export interface UseCanvasRendererOptions {
  editor: EditorApplication;
  viewDocument: DocumentData;
  assets: EditorApplication["assets"];
  renderRegion: RenderRegion;
  zoom: number;
  paintPreview: RenderOptions["paintPreview"];
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
  backendState,
  displayHost,
  onCleanupCursor,
  onError,
}: UseCanvasRendererOptions): UseCanvasRendererResult {
  const [rendering, setRendering] = useState(false);
  const [renderBackend, setRenderBackend] = useState<"webgpu" | "canvas2d" | null>(null);
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
  } | null>(null);
  const renderTarget = useRef<typeof latestRender.current>(null);
  const renderActive = useRef(false);
  const renderVersion = useRef(0);

  useEffect(() => {
    const key = ++renderVersion.current;
    latestRender.current = {
      document: viewDocument,
      assets,
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
      setRendering(true);
      try {
        while (latestRender.current) {
          // Collapse pending work to one newest snapshot per display frame.
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          if (!latestRender.current) break;
          const job = latestRender.current;
          latestRender.current = null;
          try {
            let result = await editor.renderer.prepareViewport(
              job.document,
              job.assets,
              job.options,
            );
            const target = renderTarget.current;
            // An older prefix of the SAME live stroke may be displayed while
            // its next frame waits. Never show an old revision/view/gesture.
            const sameStroke =
              target &&
              job.options.paintPreview &&
              target.options.paintPreview?.stroke.id ===
                job.options.paintPreview.stroke.id &&
              target.document === job.document &&
              target.assets === job.assets &&
              target.region === job.region &&
              target.options.scale === job.options.scale;

            if (
              (!sameStroke && job.key !== renderVersion.current) ||
              !displayHost.current
            ) {
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
                if (
                  job.key !== renderVersion.current ||
                  !displayHost.current
                ) {
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
            if (job.key === renderVersion.current && onErrorRef.current) {
              onErrorRef.current(
                cause instanceof Error ? cause.message : "Rendering failed.",
              );
            }
          }
        }
      } finally {
        renderActive.current = false;
        setRendering(false);
      }
    }

    void drain();
  }, [
    viewDocument,
    assets,
    editor,
    renderRegion,
    zoom,
    paintPreview,
    backendState,
    displayHost,
  ]);

  useEffect(() => () => {
    renderVersion.current++;
    latestRender.current = null;
    renderTarget.current = null;
    onCleanupCursorRef.current?.();
    editor.tools.cancel();
  }, [editor]);

  return {
    rendering,
    renderBackend,
    paintedRegion,
  };
}
