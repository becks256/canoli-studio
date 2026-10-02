import { useEffect, useState } from "react";
import {
  defaultPanelWidths,
  fitPanelWidths,
  PANEL_LAYOUT_KEY,
  readPanelWidths,
} from "../panel-layout";
import type { PanelWidths } from "../panel-layout";

export function usePanelLayout(onError: (message: string) => void) {
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [initial] = useState(() => {
    try {
      return { widths: readPanelWidths(localStorage), error: "" };
    } catch (error) {
      return { widths: null, error: String(error) };
    }
  });
  const [saved, setSaved] = useState<PanelWidths | null>(initial.widths);
  const [preview, setPreview] = useState<PanelWidths | null>(null);
  useEffect(() => {
    if (initial.error) onError(initial.error);
  }, [initial.error, onError]);
  useEffect(() => {
    const resize = () => {
      setViewport(window.innerWidth);
      setPreview(null);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const widths = fitPanelWidths(
    preview ?? saved ?? defaultPanelWidths(viewport),
    viewport,
  );
  const change = (side: keyof PanelWidths, value: number, commit: boolean) => {
    const next = fitPanelWidths({ ...widths, [side]: value }, viewport);
    if (!commit) {
      setPreview(next);
      return;
    }
    try {
      localStorage.setItem(
        PANEL_LAYOUT_KEY,
        JSON.stringify({ version: 1, ...next }),
      );
      setSaved(next);
    } catch (error) {
      onError(`Panel layout could not be saved: ${String(error)}`);
    }
    setPreview(null);
  };
  return {
    widths,
    change,
    cancel: () => setPreview(null),
    reset: (side: keyof PanelWidths) =>
      change(side, defaultPanelWidths(viewport)[side], true),
    max: (side: keyof PanelWidths) =>
      Math.min(
        480,
        Math.max(760, viewport) -
          266 -
          widths[side === "layers" ? "inspector" : "layers"],
      ),
  };
}
