import { changesCanvasSpace, describe, execute } from "./commands";
import type { EditorCommand } from "./commands";
import { createDocument, findLayer, validateDocument, SCHEMA_VERSION, id as newId } from "./model";
import type { DocumentData } from "./model";
import { parseRetainedHistory, retainedDocuments, historyTip, historyBranchName, historyNameKey, type HistoryEntry, type HistoryBranch } from "./history";
import {comparisonExtent, validateHistoryRegion, resolveHistoryTarget, historyComparisonChangesSchema, type HistoryTarget, type HistoryRegion, type HistoryComparison, type HistoryComparisonChanges} from './history';
import {unknownProvenance,knownTipProvenance,historyOriginSchema,recordHistoryOperation,type HistoryOrigin,type HistoryOperation,type HistoryProvenance} from "./history-provenance";
import {timelineProvenance} from "./history";
import { freeze, shareUnchanged, isImmutable } from "./immutable";
export interface EditorState {
  document: DocumentData;
  selectedId: string | null;
  selectedIds: readonly string[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  branches: HistoryBranch[];
  activeBranchId: string | null;
  comparisons: HistoryComparison[];
  provenance: HistoryProvenance;
  revision: number;
  canvasRevision: number;
}

export class EditorStore {
  private listeners = new Set<() => void>();
  private state: EditorState;
  private sessionId = newId();
  private observedOperations = new WeakSet<HistoryOperation>();

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
      branches: 'version' in retained && retained.version !== 1 ? retained.branches.map(branch => ({...branch,
        forkDocument: shareUnchanged(current, branch.forkDocument),
        tip: {document: shareUnchanged(current, branch.tip.document), past: intern(branch.tip.past),...(branch.tip.provenance?{provenance:branch.tip.provenance}:{})},
      })) : [],
      activeBranchId: 'version' in retained && retained.version !== 1 ? retained.activeBranchId : null,
      comparisons: 'version' in retained && (retained.version === 3 || retained.version === 4) ? retained.comparisons.map(value => ({...value,
        before: shareUnchanged(current, value.before), after: shareUnchanged(current, value.after)})) : [],
      provenance: 'version' in retained && retained.version === 4 ? retained.provenance : unknownProvenance(retained.past.length,retained.future.length),
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

  isHistoryOperationObserved(operation:HistoryOperation){return this.observedOperations.has(operation);}

  dispatch(command: EditorCommand, context:HistoryOrigin={surface:'host'}) {
    const origin=historyOriginSchema.parse(context);
    const label = describe(command);
    if (typeof label !== 'string') throw new Error('A history operation label must be a string.');
    const document = execute(this.state.document, command);
    if (document === this.state.document)
      return;
    const past = [...this.state.past, {document: this.state.document, label, canvasChanged: changesCanvasSpace(command)}].slice(-60);
    const operation=freeze(recordHistoryOperation(command,document.id,this.sessionId,this.state.revision+1,label,origin));
    const provenance:HistoryProvenance={current:operation,past:[...this.state.provenance.past,this.state.provenance.current].slice(-60),future:[]};
    let {branches, activeBranchId} = this.state;
    if (this.state.future.length) {
      ({branches, activeBranchId} = this.initialBranches());
      const branch = this.newBranch(this.availableBranchName(branches), branches, activeBranchId, {document, past, provenance:knownTipProvenance(provenance)});
      branches = [...branches, branch]; activeBranchId = branch.id;
    } else if (activeBranchId) branches = branches.map(branch => branch.id === activeBranchId ? {...branch, tip: {document, past, provenance:knownTipProvenance(provenance)}} : branch);
    this.observedOperations.add(operation);
    this.publish({
      ...this.state,
      document, provenance,
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
    const tip = historyTip(this.state), id = newId();
    const forkProvenance=this.state.past.length?this.state.provenance.past[0]:this.state.provenance.current;
    return {branches: [{id, name: 'Main', parentId: null, forkDocument: this.state.past[0]?.document ?? this.state.document, tip,...(forkProvenance?{forkProvenance}:{})}], activeBranchId: id};
  }
  private availableBranchName(branches: HistoryBranch[]) {
    const names = new Set(branches.map(branch => historyNameKey(branch.name)));
    let index = 1; while (names.has(historyNameKey(`Branch ${index}`))) index++;
    return `Branch ${index}`;
  }
  private newBranch(name: string, branches: HistoryBranch[], parentId: string, tip:import('./history').HistoryTip = {document:this.state.document,past:this.state.past,...(knownTipProvenance(this.state.provenance)?{provenance:knownTipProvenance(this.state.provenance)}:{})}): HistoryBranch {
    name = historyBranchName(name);
    if (branches.some(branch => historyNameKey(branch.name) === historyNameKey(name))) throw new Error('A history branch with this name already exists.');
    return {id: newId(), name, parentId, forkDocument: this.state.document, tip,...(this.state.provenance.current?{forkProvenance:this.state.provenance.current}:{})};
  }
  createHistoryBranch(name: string): string {
    const {branches, activeBranchId} = this.initialBranches();
    const branch = this.newBranch(name, branches, activeBranchId);
    this.publish({...this.state, branches: [...branches, branch], activeBranchId: branch.id, future: [], provenance:{...this.state.provenance,future:[]}, revision: this.state.revision + 1});
    return branch.id;
  }
  checkoutHistoryBranch(id: string) {
    const branch = this.state.branches.find(branch => branch.id === id);
    if (!branch) throw new Error('History branch not found.');
    if (id === this.state.activeBranchId) {this.navigateHistory(this.state.past.length + this.state.future.length); return;}
    this.publish({...this.state, ...branch.tip, provenance:{...(branch.tip.provenance??unknownProvenance(branch.tip.past.length)),future:[]}, ...this.selectionFor(branch.tip.document), future: [], activeBranchId: id,
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

  createHistoryComparison(name: string, beforeTarget: HistoryTarget, afterTarget: HistoryTarget, region?: HistoryRegion): string {
    name = historyBranchName(name);
    if (this.state.comparisons.some(value => historyNameKey(value.name) === historyNameKey(name))) throw new Error('A history comparison with this name already exists.');
    const before = resolveHistoryTarget(this.state, beforeTarget), after = resolveHistoryTarget(this.state, afterTarget);
    const comparison: HistoryComparison = {id: newId(), name, before: before.document, after: after.document,
      beforeLabel: before.label, afterLabel: after.label,...(before.provenance?{beforeProvenance:before.provenance}:{}),...(after.provenance?{afterProvenance:after.provenance}:{}), region: validateHistoryRegion(region === undefined ? comparisonExtent(before.document, after.document) : region, before.document, after.document)};
    this.publish({...this.state, comparisons: [...this.state.comparisons, comparison], revision: this.state.revision + 1});
    return comparison.id;
  }
  updateHistoryComparison(id: string, input: HistoryComparisonChanges) {
    const changes = historyComparisonChangesSchema.parse(input), value = this.state.comparisons.find(value => value.id === id);
    if (!value) throw new Error('History comparison not found.');
    const name = changes.name ?? value.name, region = changes.region ? validateHistoryRegion(changes.region, value.before, value.after) : value.region;
    if (this.state.comparisons.some(value => value.id !== id && historyNameKey(value.name) === historyNameKey(name))) throw new Error('A history comparison with this name already exists.');
    if (name === value.name && ['x', 'y', 'width', 'height'].every(key => region[key as keyof HistoryRegion] === value.region[key as keyof HistoryRegion])) return;
    this.publish({...this.state, comparisons: this.state.comparisons.map(item => item.id === id ? {...item, name, region} : item), revision: this.state.revision + 1});
  }
  deleteHistoryComparison(id: string) {
    if (!this.state.comparisons.some(value => value.id === id)) throw new Error('History comparison not found.');
    this.publish({...this.state, comparisons: this.state.comparisons.filter(value => value.id !== id), revision: this.state.revision + 1});
  }
  createHistoryBranchFromComparison(id: string, side: 'before' | 'after', name: string): string {
    const comparison = this.state.comparisons.find(value => value.id === id);
    if (!comparison) throw new Error('History comparison not found.');
    if (side !== 'before' && side !== 'after') throw new Error('Choose the before or after comparison state.');
    const {branches, activeBranchId} = this.initialBranches(), document = comparison[side];
    const branch = this.newBranch(name, branches, activeBranchId, {document, past: [],...((side==='before'?comparison.beforeProvenance:comparison.afterProvenance)?{provenance:{current:(side==='before'?comparison.beforeProvenance:comparison.afterProvenance)!,past:[]}}:{})});
    this.publish({...this.state, document, past: [], future: [], provenance:{current:side==='before'?comparison.beforeProvenance??null:comparison.afterProvenance??null,past:[],future:[]}, ...this.selectionFor(document), branches: [...branches, branch], activeBranchId: branch.id,
      revision: this.state.revision + 1, canvasRevision: this.state.canvasRevision + 1});
    return branch.id;
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
    const document = documents[position], points=timelineProvenance(state);
    const canvasChanged = transitions.slice(Math.min(current, position), Math.max(current, position)).some(entry => entry.canvasChanged);
    this.publish({
      ...state, document, provenance:{current:points[position],past:points.slice(0,position),future:points.slice(position+1).reverse()},
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
      comparisons: [],
      provenance:unknownProvenance(),
      revision: this.state.revision + 1,
      canvasRevision: this.state.canvasRevision + 1,
    });
  }
}
