import { changesCanvasSpace, describe, execute } from "./commands";
import type { EditorCommand } from "./commands";
import { createDocument, findLayer, validateDocument, SCHEMA_VERSION } from "./model";
import type { DocumentData } from "./model";
import { parseRetainedHistory, retainedDocuments, historyTip, historyBranchName, historyNameKey, type HistoryEntry, type HistoryBranch } from "./history";
import { freeze, shareUnchanged, isImmutable } from "./immutable";
export interface EditorState {
  document: DocumentData;
  selectedId: string | null;
  selectedIds: readonly string[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  branches: HistoryBranch[];
  activeBranchId: string | null;
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
    if (options.migrateSchema) {
      owned.schemaVersion = SCHEMA_VERSION;
      if ('version' in retained) for (const document of retainedDocuments(owned, retained))
        if (document !== owned) document.schemaVersion = SCHEMA_VERSION;
    }
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
      branches: 'version' in retained && retained.version === 2 ? retained.branches.map(branch => ({...branch,
        forkDocument: shareUnchanged(current, branch.forkDocument),
        tip: {document: shareUnchanged(current, branch.tip.document), past: intern(branch.tip.past)},
      })) : [],
      activeBranchId: 'version' in retained && retained.version === 2 ? retained.activeBranchId : null,
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
    const past = [...this.state.past, {document: this.state.document, label, canvasChanged: changesCanvasSpace(command)}].slice(-60);
    let {branches, activeBranchId} = this.state;
    if (this.state.future.length) {
      ({branches, activeBranchId} = this.initialBranches());
      const branch = this.newBranch(this.availableBranchName(branches), branches, activeBranchId, {document, past});
      branches = [...branches, branch]; activeBranchId = branch.id;
    } else if (activeBranchId) branches = branches.map(branch => branch.id === activeBranchId ? {...branch, tip: {document, past}} : branch);
    this.publish({
      ...this.state,
      document,
      branches, activeBranchId,
      ...this.selectionFor(document),
      past,
      future: [],
      revision: this.state.revision + 1,
      canvasRevision:
        this.state.canvasRevision + Number(changesCanvasSpace(command)),
    });
  }

  private initialBranches() {
    if (this.state.branches.length) return {branches: this.state.branches, activeBranchId: this.state.activeBranchId!};
    const tip = historyTip(this.state), id = crypto.randomUUID();
    return {branches: [{id, name: 'Main', parentId: null, forkDocument: this.state.past[0]?.document ?? this.state.document, tip}], activeBranchId: id};
  }
  private availableBranchName(branches: HistoryBranch[]) {
    const names = new Set(branches.map(branch => historyNameKey(branch.name)));
    let index = 1; while (names.has(historyNameKey(`Branch ${index}`))) index++;
    return `Branch ${index}`;
  }
  private newBranch(name: string, branches: HistoryBranch[], parentId: string, tip = {document: this.state.document, past: this.state.past}): HistoryBranch {
    name = historyBranchName(name);
    if (branches.some(branch => historyNameKey(branch.name) === historyNameKey(name))) throw new Error('A history branch with this name already exists.');
    return {id: crypto.randomUUID(), name, parentId, forkDocument: this.state.document, tip};
  }
  createHistoryBranch(name: string): string {
    const {branches, activeBranchId} = this.initialBranches();
    const branch = this.newBranch(name, branches, activeBranchId);
    this.publish({...this.state, branches: [...branches, branch], activeBranchId: branch.id, future: [], revision: this.state.revision + 1});
    return branch.id;
  }
  checkoutHistoryBranch(id: string) {
    const branch = this.state.branches.find(branch => branch.id === id);
    if (!branch) throw new Error('History branch not found.');
    if (id === this.state.activeBranchId) {this.navigateHistory(this.state.past.length + this.state.future.length); return;}
    this.publish({...this.state, ...branch.tip, ...this.selectionFor(branch.tip.document), future: [], activeBranchId: id,
      revision: this.state.revision + 1, canvasRevision: this.state.canvasRevision + 1});
  }
  renameHistoryBranch(id: string, name: string) {
    name = historyBranchName(name);
    const branch = this.state.branches.find(branch => branch.id === id);
    if (!branch) throw new Error('History branch not found.');
    if (branch.name === name) return;
    if (this.state.branches.some(branch => branch.id !== id && historyNameKey(branch.name) === historyNameKey(name))) throw new Error('A history branch with this name already exists.');
    this.publish({...this.state, branches: this.state.branches.map(branch => branch.id === id ? {...branch, name} : branch), revision: this.state.revision + 1});
  }
  deleteHistoryBranch(id: string) {
    if (!this.state.branches.some(branch => branch.id === id)) throw new Error('History branch not found.');
    if (id === this.state.activeBranchId) throw new Error('Switch to another branch before deleting the active branch.');
    if (this.state.branches.some(branch => branch.parentId === id)) throw new Error('Delete child branches before their parent.');
    this.publish({...this.state, branches: this.state.branches.filter(branch => branch.id !== id), revision: this.state.revision + 1});
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
      branches: [],
      activeBranchId: null,
      revision: this.state.revision + 1,
      canvasRevision: this.state.canvasRevision + 1,
    });
  }
}
