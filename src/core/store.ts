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
    this.state = freeze({
      document: current,
      selectedId: null,
      selectedIds: Object.freeze([]),
      past: freeze(intern(retained.past)),
      future: freeze(intern(retained.future)),
      revision: 0,
      canvasRevision: 0,
    });
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: EditorState) {
    this.state = freeze(state);
    let failure: unknown, failed = false;
    for (const listener of [...this.listeners]) try {listener();} catch (cause) {if (!failed) failure = cause; failed = true;}
    if (failed) throw failure;
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
    const label = describe(command);
    if (typeof label !== 'string') throw new Error('A history operation label must be a string.');
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
          label,
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
    if (this.state.past.length) this.navigateHistory(this.state.past.length - 1);
  }

  redo() {
    if (this.state.future.length) this.navigateHistory(this.state.past.length + 1);
  }

  /** Move within retained snapshots atomically, without replaying commands or jobs. */
  navigateHistory(position: number) {
    const state = this.state, current = state.past.length;
    if (!Number.isSafeInteger(position) || position < 0 || position > current + state.future.length)
      throw new Error('History position is outside the retained timeline.');
    if (position === current) return;
    const redo = [...state.future].reverse();
    const documents = [...state.past.map(entry => entry.document), state.document, ...redo.map(entry => entry.document)];
    const transitions = [...state.past, ...redo];
    const document = documents[position];
    const canvasChanged = transitions.slice(Math.min(current, position), Math.max(current, position)).some(entry => entry.canvasChanged);
    this.publish({
      ...state, document,
      past: transitions.slice(0, position).map((entry, index) => ({...entry, document: documents[index]})),
      future: transitions.slice(position).map((entry, index) => ({...entry, document: documents[position + index + 1]})).reverse(),
      ...this.selectionFor(document),
      revision: state.revision + 1,
      canvasRevision: state.canvasRevision + Number(canvasChanged),
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
