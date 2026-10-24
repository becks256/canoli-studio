import { useEffect, useMemo, useState, type MouseEventHandler } from "react";
import type { DocumentData, LayerData } from "../core/model";
import { findLayer } from "../core/model";
import { RasterEditing, transparencySource } from "../raster-editing";

const EMPTY = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";

const identities = new WeakMap<object, number>();
let nextIdentity = 0;
function identity(value: object): number {
  let id = identities.get(value);
  if (id === undefined) { id = ++nextIdentity; identities.set(value, id); }
  return id;
}
/** Store snapshots share immutable artwork; keys never stringify pixel arrays. */
function branchKey(document: DocumentData, layerId: string): string {
  const visit = (nodes: LayerData[]): unknown[] | undefined => {
    for (const node of nodes) {
      const child = node.kind === "group" ? visit(node.children) : undefined;
      if (node.id !== layerId && !child) continue;
      const properties = Object.entries(node).filter(([key]) => key !== "children" && key !== "visible")
        .map(([key, value]) => [key, value && typeof value === "object" ? { ref: identity(value) } : value]);
      return [properties, child];
    }
  };
  return JSON.stringify([document.width, document.height, visit(document.children)]);
}

/** Committed content only: live brush movement never starts thumbnail renders. */
export function LayerThumbnail({ document, layerId, name, pixels, fallback, paused = false, onClick }: {
  document: DocumentData;
  layerId: string;
  name: string;
  pixels: RasterEditing;
  fallback?: string;
  paused?: boolean;
  onClick?: MouseEventHandler<HTMLImageElement>;
}) {
  // Ignore selection changes and edits to other branches of the document.
  const key = useMemo(() => branchKey(document, layerId), [document, layerId]);
  const [preview, setPreview] = useState<{ key: string; url: string }>();
  useEffect(() => {
    if (paused || preview?.key === key || !findLayer(document, layerId)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const source = transparencySource(document, layerId);
      void pixels.thumbnail(source, layerId).then(url => {
        if (!cancelled) setPreview({ key, url });
      }).catch(() => { /* Keep the source/empty preview if rendering is unavailable. */ });
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // The serialized source key captures every rendering input in this branch.
  }, [pixels, key, layerId, paused, preview?.key]);
  return <img
    className="layer-thumb pixel-thumb"
    src={preview?.key === key ? preview.url : fallback ?? EMPTY}
    alt={`${name} thumbnail`}
    title="Ctrl/Cmd-click to load transparency as a selection"
    draggable={false}
    onClick={onClick}
  />;
}
