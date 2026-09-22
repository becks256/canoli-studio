import { useEffect } from "react";
import type { RefObject } from "react";
import type { Document } from "../../dom";

export interface UseViewportObserverOptions {
  viewportRef: RefObject<HTMLElement | null>;
  dom: Document;
  onResize(size: { width: number; height: number }): void;
  onFit(): void;
  onClearPreview(): void;
}

export function useViewportObserver({
  viewportRef,
  dom,
  onResize,
  onFit,
  onClearPreview,
}: UseViewportObserverOptions): void {
  useEffect(() => {
    onClearPreview();
    onFit();
  }, [dom]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      onResize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
      onFit();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [dom, viewportRef]);
}
