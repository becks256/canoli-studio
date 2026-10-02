import { useReducer } from "react";
import type { SetStateAction } from "react";
import type { DocumentSession } from "../../workspace/document-session";

type View = {
  zoom: number;
  pan: { x: number; y: number };
  initialized: boolean;
};

/** Document identity, rather than serialized ID, distinguishes reopened project tabs. */
export function useDocumentViewport(session: DocumentSession) {
  const [, refresh] = useReducer((value) => value + 1, 0);
  const current = session.view;
  function setZoom(value: SetStateAction<number>) {
    current.zoom = typeof value === "function" ? value(current.zoom) : value;
    session.viewChanged();
    refresh();
  }
  function setPan(value: SetStateAction<View["pan"]>) {
    current.pan = typeof value === "function" ? value(current.pan) : value;
    session.viewChanged();
    refresh();
  }
  function initialize(fit: () => void) {
    if (current.initialized) return;
    current.initialized = true;
    fit();
  }
  return { zoom: current.zoom, pan: current.pan, setZoom, setPan, initialize };
}
