import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export function useWheelZoom(
  viewportRef: RefObject<HTMLElement | null>,
  onZoom: (factor: number) => void,
): void {
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      onZoomRef.current(Math.exp(-event.deltaY * 0.0015));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [viewportRef]);
}
