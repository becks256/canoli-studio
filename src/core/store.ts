import { changesCanvasSpace, describe, execute } from "./commands";
import type { EditorCommand } from "./commands";
import { createDocument, findLayer, validateDocument } from "./model";
import type { DocumentData } from "./model";
import { parseRetainedHistory, type HistoryEntry } from "./history";
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export interface EditorState {
  document: DocumentData;
  selectedId: string | null;
  selectedIds: readonly string[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  revision: number;
  canvasRevision: number;
}

export class EditorStore {
  private listeners = new Set<() => void>();
  private state: EditorState;

  constructor(document = createDocument(), history?: unknown) {
    validateDocument(document);
    const retained =
      history === undefined
        ? { past: [], future: [] }
        : parseRetainedHistory(history, document);
    this.state = {
      document: freeze(structuredClone(document)),
      selectedId: null,
      selectedIds: Object.freeze([]),
      past: freeze(retained.past),
      future: freeze(retained.future),
      revision: 0,
      canvasRevision: 0,
    };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: EditorState) {
    freeze(state.document);
    Object.freeze(state.selectedIds);
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  select(selectedId: string | null) {
    this.selectMany(selectedId ? [selectedId] : []);
  }

  selectMany(ids: readonly string[]) {
    const selectedIds = [...new Set(ids)].filter(
      (id) => !!findLayer(this.state.document, id),
    );
    this.publish({
      ...this.state,
      selectedIds,
      selectedId: selectedIds.at(-1) ?? null,
    });
  }

  private selectionFor(document: DocumentData) {
    const selectedIds = this.state.selectedIds.filter(
      (id) => !!findLayer(document, id),
    );
    return {
      selectedIds,
      selectedId: selectedIds.includes(this.state.selectedId ?? "")
        ? this.state.selectedId
        : (selectedIds.at(-1) ?? null),
    };
  }

  dispatch(command: EditorCommand) {
    const document = execute(this.state.document, command);
    if (JSON.stringify(document) === JSON.stringify(this.state.document))
      return;
    this.publish({
      ...this.state,
      document,
      ...this.selectionFor(document),
      past: [
        ...this.state.past,
        {
          document: this.state.document,
          label: describe(command),
          canvasChanged: changesCanvasSpace(command),
        },
      ].slice(-60),
      future: [],
      revision: this.state.revision + 1,
      canvasRevision:
        this.state.canvasRevision + Number(changesCanvasSpace(command)),
    });
  }

  undo() {
    const entry = this.state.past.at(-1);
    if (!entry) return;
    this.publish({
      ...this.state,
      document: entry.document,
      past: this.state.past.slice(0, -1),
      future: [
        ...this.state.future,
        {
          document: this.state.document,
          label: entry.label,
          canvasChanged: entry.canvasChanged,
        },
      ],
      ...this.selectionFor(entry.document),
      revision: this.state.revision + 1,
      canvasRevision: this.state.canvasRevision + Number(entry.canvasChanged),
    });
  }

  redo() {
    const entry = this.state.future.at(-1);
    if (!entry) return;
    this.publish({
      ...this.state,
      document: entry.document,
      future: this.state.future.slice(0, -1),
      past: [
        ...this.state.past,
        {
          document: this.state.document,
          label: entry.label,
          canvasChanged: entry.canvasChanged,
        },
      ],
      ...this.selectionFor(entry.document),
      revision: this.state.revision + 1,
      canvasRevision: this.state.canvasRevision + Number(entry.canvasChanged),
    });
  }

  replace(document: DocumentData) {
    validateDocument(document);
    this.publish({
      document: structuredClone(document),
      selectedId: null,
      selectedIds: [],
      past: [],
      future: [],
      revision: this.state.revision + 1,
      canvasRevision: this.state.canvasRevision + 1,
    });
  }
}
