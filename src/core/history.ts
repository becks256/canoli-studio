import { z } from "zod";
import { validateDocument, type DocumentData } from "./model";

export interface HistoryEntry {canvasChanged: boolean; document: DocumentData; label: string}
export interface HistoryTip {document: DocumentData; past: HistoryEntry[]}
/** A fork origin survives pruning of its parent's linear undo window. */
export interface HistoryBranch {id: string; name: string; parentId: string | null; forkDocument: DocumentData; tip: HistoryTip}
interface LinearHistory {past: HistoryEntry[]; future: HistoryEntry[]}
export type RetainedHistory = LinearHistory & (
  | {version: 1}
  | {version: 2; branches: HistoryBranch[]; activeBranchId: string}
);
export interface HistoryState extends LinearHistory {document: DocumentData; branches?: HistoryBranch[]; activeBranchId?: string | null}
const entrySchema = z.object({canvasChanged: z.boolean(), document: z.unknown(), label: z.string()}).strict();
const linear = {past: z.array(entrySchema).max(60), future: z.array(entrySchema).max(60)};
const branchSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(120), parentId: z.uuid().nullable(),
  forkDocument: z.unknown(), tip: z.object({document: z.unknown(), past: z.array(entrySchema).max(60)}).strict(),
}).strict();
const schema = z.discriminatedUnion('version', [
  z.object({version: z.literal(1), ...linear}).strict(),
  z.object({version: z.literal(2), ...linear, branches: z.array(branchSchema).min(1), activeBranchId: z.uuid()}).strict(),
]).refine(value => value.past.length + value.future.length <= 60, 'Retained history exceeds the 60-entry budget.');
export const historyBranchName = (value: string): string => z.string().trim().min(1).max(120).parse(value);
export const historyNameKey = (name: string) => name.normalize('NFKC').toLowerCase();

function sameData(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  const compared = new WeakMap<object, WeakSet<object>>();
  while (pending.length) {
    const [a, b] = pending.pop()!;
    if (Object.is(a, b)) continue;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    if (compared.get(a)?.has(b)) continue;
    let pairs = compared.get(a); if (!pairs) {pairs = new WeakSet(); compared.set(a, pairs);} pairs.add(b);
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(b, key)) return false;
      pending.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]]);
    }
  }
  return true;
}

/** Latest accepted state on a route, independent of its current undo cursor. */
export function historyTip(state: Pick<HistoryState, 'document' | 'past' | 'future'>): HistoryTip {
  const redo = [...state.future].reverse();
  const documents = [...state.past.map(entry => entry.document), state.document, ...redo.map(entry => entry.document)];
  return {document: documents[documents.length - 1], past: [...state.past, ...redo].map((entry, index) => ({...entry, document: documents[index]}))};
}
export function captureRetainedHistory(state: HistoryState): RetainedHistory {
  const linear = {past: state.past, future: state.future};
  return state.branches?.length && state.activeBranchId
    ? {version: 2, ...linear, branches: state.branches, activeBranchId: state.activeBranchId}
    : {version: 1, ...linear};
}
/** Complete source closure for serialization, workers and abandoned-stage cleanup. */
export function retainedDocuments(document: DocumentData, history?: RetainedHistory): DocumentData[] {
  return [...new Set([document, ...(history?.past ?? []).map(entry => entry.document), ...(history?.future ?? []).map(entry => entry.document),
    ...(history?.version === 2 ? history.branches.flatMap(branch => [branch.forkDocument, branch.tip.document, ...branch.tip.past.map(entry => entry.document)]) : [])])];
}
/** Validate the entire graph before any session or source store is installed. */
export function parseRetainedHistory(input: unknown, current: DocumentData): RetainedHistory {
  const parsed = schema.parse(structuredClone(input));
  const model = (input: unknown): DocumentData => {
    validateDocument(input);
    if (input.id !== current.id) throw new Error('History entry belongs to another document.');
    return input;
  };
  const entries = (input: z.infer<typeof entrySchema>[]): HistoryEntry[] => input.map(entry => ({...entry, document: model(entry.document)}));
  const linear = {past: entries(parsed.past), future: entries(parsed.future)};
  if (parsed.version === 1) return {version: 1, ...linear};
  const branches = parsed.branches.map(branch => ({...branch, forkDocument: model(branch.forkDocument), tip: {document: model(branch.tip.document), past: entries(branch.tip.past)}}));
  const byId = new Map(branches.map(branch => [branch.id, branch]));
  if (byId.size !== branches.length || new Set(branches.map(branch => historyNameKey(branch.name))).size !== branches.length)
    throw new Error('Duplicate history branch identifier or name.');
  const checked = new Set<string>();
  for (const branch of branches) {
    const path = new Set<string>(); let cursor: HistoryBranch | undefined = branch;
    while (cursor && !checked.has(cursor.id)) {
      if (path.has(cursor.id)) throw new Error('History branch ancestry contains a cycle.');
      path.add(cursor.id);
      if (cursor.parentId && !byId.has(cursor.parentId)) throw new Error('History branch parent is missing.');
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    for (const id of path) checked.add(id);
  }
  const active = byId.get(parsed.activeBranchId);
  if (!active) throw new Error('Active history branch is missing.');
  if (!sameData(active.tip, historyTip({document: current, ...linear})))
    throw new Error('Active history branch does not match the retained timeline.');
  return {version: 2, ...linear, branches, activeBranchId: parsed.activeBranchId};
}
