import { changesCanvasSpace, describe, execute } from "./commands";
import type { EditorCommand } from "./commands";
import { createDocument, findLayer, validateDocument, SCHEMA_VERSION } from "./model";
import type { DocumentData } from "./model";
import { parseRetainedHistory, type HistoryEntry } from "./history";
import { freeze, shareUnchanged, isImmutable } from "./immutable";
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

  constructor(
    document: unknown = createDocument(),
    history?: unknown,
    options: { migrateSchema?: boolean } = {},
  ) {
    // Validate the exact owned snapshot, before migration. Getter-backed input
    // cannot change between validation and the copy installed in the store.
    // Only registry-proven deep immutability permits sharing caller data.
    // Migration owns a new root; mutable and shallow-frozen inputs remain copied.
    const owned = isImmutable(document)
      ? options.migrateSchema ? { ...document } : document
      : structuredClone(document);
    validateDocument(owned);
    const retained =
      history === undefined
        ? { past: [], future: [] }
        : parseRetainedHistory(history, owned);
    if (options.migrateSchema) owned.schemaVersion = SCHEMA_VERSION;
    const current = freeze(owned);
    const intern = (entries: HistoryEntry[]) => {
      let previous = current;
      return [...entries].reverse().map(entry => {
        const document = freeze(shareUnchanged(previous, entry.document));
        previous = document;
        return { ...entry, document };
      }).reverse();
    };
    this.state = {
      document: current,
      selectedId: null,
      selectedIds: Object.freeze([]),
      past: freeze(intern(retained.past)),
      future: freeze(intern(retained.future)),
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
    if (document === this.state.document)
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
