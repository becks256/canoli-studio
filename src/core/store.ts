import { describe, execute } from "./commands";
import type { EditorCommand } from "./commands";
import { createDocument, findLayer, validateDocument } from "./model";
import type { DocumentData } from "./model";

interface HistoryEntry {
  document: DocumentData;
  label: string;
}
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
  past: HistoryEntry[];
  future: HistoryEntry[];
  revision: number;
}

export class EditorStore {
  private listeners = new Set<() => void>();
  private state: EditorState;

  constructor(document = createDocument()) {
    validateDocument(document);
    this.state = {
      document: freeze(structuredClone(document)),
      selectedId: null,
      past: [],
      future: [],
      revision: 0,
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
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  select(selectedId: string | null) {
    this.publish({
      ...this.state,
      selectedId: findLayer(this.state.document, selectedId)
        ? selectedId
        : null,
    });
  }

  dispatch(command: EditorCommand) {
    const document = execute(this.state.document, command);
    if (JSON.stringify(document) === JSON.stringify(this.state.document))
      return;
    this.publish({
      ...this.state,
      document,
      selectedId: findLayer(document, this.state.selectedId)
        ? this.state.selectedId
        : null,
      past: [
        ...this.state.past,
        { document: this.state.document, label: describe(command) },
      ].slice(-60),
      future: [],
      revision: this.state.revision + 1,
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
        { document: this.state.document, label: entry.label },
      ],
      selectedId: findLayer(entry.document, this.state.selectedId)
        ? this.state.selectedId
        : null,
      revision: this.state.revision + 1,
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
        { document: this.state.document, label: entry.label },
      ],
      selectedId: findLayer(entry.document, this.state.selectedId)
        ? this.state.selectedId
        : null,
      revision: this.state.revision + 1,
    });
  }

  replace(document: DocumentData) {
    validateDocument(document);
    this.publish({
      document: structuredClone(document),
      selectedId: null,
      past: [],
      future: [],
      revision: this.state.revision + 1,
    });
  }
}
