import { z } from "zod";
import { validateDocument, type DocumentData } from "./model";

export interface HistoryEntry {canvasChanged: boolean; document: DocumentData; label: string}
export interface HistoryTip {document: DocumentData; past: HistoryEntry[]}
/** A fork origin survives pruning of its parent's linear undo window. */
export interface HistoryBranch {id: string; name: string; parentId: string | null; forkDocument: DocumentData; tip: HistoryTip}
export interface HistoryRegion {x: number; y: number; width: number; height: number}
export interface HistoryComparison {
  id: string; name: string; before: DocumentData; after: DocumentData;
  beforeLabel: string; afterLabel: string; region: HistoryRegion;
}
export const historyTargetSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('current')}).strict(),
  z.object({kind: z.literal('timeline'), position: z.number().int().nonnegative().safe()}).strict(),
  z.object({kind: z.literal('branch'), branchId: z.uuid()}).strict(),
]);
export type HistoryTarget = z.infer<typeof historyTargetSchema>;
export const historyRegionSchema = z.object({x: z.number().int().nonnegative().safe(), y: z.number().int().nonnegative().safe(), width: z.number().int().positive().safe(), height: z.number().int().positive().safe()}).strict();
export const historyComparisonChangesSchema = z.object({name: z.string().trim().min(1).max(120).optional(), region: historyRegionSchema.optional()}).strict();
export type HistoryComparisonChanges = z.infer<typeof historyComparisonChangesSchema>;
interface LinearHistory {past: HistoryEntry[]; future: HistoryEntry[]}
export type RetainedHistory = LinearHistory & (
  | {version: 1}
  | {version: 2; branches: HistoryBranch[]; activeBranchId: string}
  | {version: 3; branches: HistoryBranch[]; activeBranchId: string | null; comparisons: HistoryComparison[]}
);
export interface HistoryState extends LinearHistory {document: DocumentData; branches?: HistoryBranch[]; activeBranchId?: string | null; comparisons?: HistoryComparison[]}
const entrySchema = z.object({canvasChanged: z.boolean(), document: z.unknown(), label: z.string()}).strict();
const linear = {past: z.array(entrySchema).max(60), future: z.array(entrySchema).max(60)};
const branchSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(120), parentId: z.uuid().nullable(),
  forkDocument: z.unknown(), tip: z.object({document: z.unknown(), past: z.array(entrySchema).max(60)}).strict(),
}).strict();
const schema = z.discriminatedUnion('version', [
  z.object({version: z.literal(1), ...linear}).strict(),
  z.object({version: z.literal(2), ...linear, branches: z.array(branchSchema).min(1), activeBranchId: z.uuid()}).strict(),
  z.object({version: z.literal(3), ...linear, branches: z.array(branchSchema), activeBranchId: z.uuid().nullable(), comparisons: z.array(z.object({
    id: z.uuid(), name: z.string().trim().min(1).max(120), before: z.unknown(), after: z.unknown(),
    beforeLabel: z.string(), afterLabel: z.string(), region: historyRegionSchema,
  }).strict()).min(1)}).strict(),
]).refine(value => value.past.length + value.future.length <= 60, 'Retained history exceeds the 60-entry budget.');
export const historyBranchName = (value: string): string => z.string().trim().min(1).max(120).parse(value);
export const historyNameKey = (name: string) => name.normalize('NFKC').toLowerCase();

export function comparisonExtent(before: DocumentData, after: DocumentData): HistoryRegion {
  return {x: 0, y: 0, width: Math.max(before.width, after.width), height: Math.max(before.height, after.height)};
}
export function validateHistoryRegion(input: unknown, before: DocumentData, after: DocumentData): HistoryRegion {
  const region = historyRegionSchema.parse(input), extent = comparisonExtent(before, after);
  if (region.x + region.width > extent.width || region.y + region.height > extent.height)
    throw new Error('Comparison region is outside the combined document extent.');
  return region;
}
export function resolveHistoryTarget(state: HistoryState, input: HistoryTarget): {document: DocumentData; label: string} {
  const target = historyTargetSchema.parse(input);
  if (target.kind === 'current') return {document: state.document, label: 'Current document state'};
  if (target.kind === 'branch') {
    const branch = state.branches?.find(branch => branch.id === target.branchId);
    if (!branch) throw new Error('History branch not found.');
    return {document: branch.tip.document, label: `Branch ${branch.name}: accepted tip`};
  }
  const redo = [...state.future].reverse(), transitions = [...state.past, ...redo];
  const documents = [...state.past.map(entry => entry.document), state.document, ...redo.map(entry => entry.document)];
  if (target.position >= documents.length) throw new Error('History position is outside the retained timeline.');
  return {document: documents[target.position], label: target.position ? transitions[target.position - 1].label : 'Oldest retained state'};
}

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
  if (state.comparisons?.length) return {version: 3, ...linear, branches: state.branches ?? [], activeBranchId: state.activeBranchId ?? null, comparisons: state.comparisons};
  return state.branches?.length && state.activeBranchId
    ? {version: 2, ...linear, branches: state.branches, activeBranchId: state.activeBranchId}
    : {version: 1, ...linear};
}
/** Complete source closure for serialization, workers and abandoned-stage cleanup. */
export function retainedDocuments(document: DocumentData, history?: RetainedHistory): DocumentData[] {
  return [...new Set([document, ...(history?.past ?? []).map(entry => entry.document), ...(history?.future ?? []).map(entry => entry.document),
    ...(history && history.version !== 1 ? history.branches.flatMap(branch => [branch.forkDocument, branch.tip.document, ...branch.tip.past.map(entry => entry.document)]) : []),
    ...(history?.version === 3 ? history.comparisons.flatMap(comparison => [comparison.before, comparison.after]) : [])])];
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
  const comparisons = parsed.version === 3 ? parsed.comparisons.map(value => {
    const before = model(value.before), after = model(value.after);
    return {...value, before, after, region: validateHistoryRegion(value.region, before, after)};
  }) : [];
  if (new Set(comparisons.map(value => value.id)).size !== comparisons.length || new Set(comparisons.map(value => historyNameKey(value.name))).size !== comparisons.length)
    throw new Error('Duplicate history comparison identifier or name.');
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
  const active = parsed.activeBranchId ? byId.get(parsed.activeBranchId) : undefined;
  if (branches.length ? !active : parsed.activeBranchId !== null) throw new Error('Active history branch is missing.');
  if (active && !sameData(active.tip, historyTip({document: current, ...linear})))
    throw new Error('Active history branch does not match the retained timeline.');
  return parsed.version === 3 ? {version: 3, ...linear, branches, activeBranchId: parsed.activeBranchId, comparisons}
    : {version: 2, ...linear, branches, activeBranchId: parsed.activeBranchId};
}
