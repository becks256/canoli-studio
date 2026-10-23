import { z } from "zod";
import {historyOperationSchema,historyProvenanceSchema,tipProvenanceSchema,unknownProvenance,knownTipProvenance,type HistoryOperation,type HistoryProvenance,type HistoryTipProvenance} from "./history-provenance";
import { validateDocument, type DocumentData } from "./model";

export interface HistoryEntry {canvasChanged: boolean; document: DocumentData; label: string}
export interface HistoryTip {document: DocumentData; past: HistoryEntry[]; provenance?: HistoryTipProvenance}
/** A fork origin survives pruning of its parent's linear undo window. */
export interface HistoryBranch {id: string; name: string; parentId: string | null; forkDocument: DocumentData; tip: HistoryTip; forkProvenance?: HistoryOperation}
export interface HistoryRegion {x: number; y: number; width: number; height: number}
export interface HistoryComparison {
  id: string; name: string; before: DocumentData; after: DocumentData;
  beforeLabel: string; afterLabel: string; region: HistoryRegion; beforeProvenance?: HistoryOperation; afterProvenance?: HistoryOperation;
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
  | {version: 4; branches: HistoryBranch[]; activeBranchId: string | null; comparisons: HistoryComparison[]; provenance: HistoryProvenance}
);
export interface HistoryState extends LinearHistory {document: DocumentData; branches?: HistoryBranch[]; activeBranchId?: string | null; comparisons?: HistoryComparison[]; provenance?: HistoryProvenance}
const entrySchema = z.object({canvasChanged: z.boolean(), document: z.unknown(), label: z.string()}).strict();
const linear = {past: z.array(entrySchema).max(60), future: z.array(entrySchema).max(60)};
const branchSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(120), parentId: z.uuid().nullable(),
  forkDocument: z.unknown(), tip: z.object({document: z.unknown(), past: z.array(entrySchema).max(60)}).strict(),
}).strict();
const comparisonSchema = z.object({id:z.uuid(),name:z.string().trim().min(1).max(120),before:z.unknown(),after:z.unknown(),beforeLabel:z.string(),afterLabel:z.string(),region:historyRegionSchema}).strict();
const provenanceBranchSchema = branchSchema.extend({forkProvenance:historyOperationSchema.optional(),tip:branchSchema.shape.tip.extend({provenance:tipProvenanceSchema.optional()}).strict()}).strict();
const provenanceComparisonSchema = comparisonSchema.extend({beforeProvenance:historyOperationSchema.optional(),afterProvenance:historyOperationSchema.optional()}).strict();
const schema = z.discriminatedUnion('version', [
  z.object({version:z.literal(1),...linear}).strict(),
  z.object({version:z.literal(2),...linear,branches:z.array(branchSchema).min(1),activeBranchId:z.uuid()}).strict(),
  z.object({version:z.literal(3),...linear,branches:z.array(branchSchema),activeBranchId:z.uuid().nullable(),comparisons:z.array(comparisonSchema).min(1)}).strict(),
  z.object({version:z.literal(4),...linear,branches:z.array(provenanceBranchSchema),activeBranchId:z.uuid().nullable(),comparisons:z.array(provenanceComparisonSchema),provenance:historyProvenanceSchema}).strict(),
]).refine(value=>value.past.length+value.future.length<=60,'Retained history exceeds the 60-entry budget.');
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
export function resolveHistoryTarget(state: HistoryState, input: HistoryTarget): {document: DocumentData; label: string; provenance: HistoryOperation|null} {
  const target = historyTargetSchema.parse(input);
  if (target.kind === 'current') return {document: state.document, label: 'Current document state', provenance:state.provenance?.current??null};
  if (target.kind === 'branch') {
    const branch = state.branches?.find(branch => branch.id === target.branchId);
    if (!branch) throw new Error('History branch not found.');
    return {document: branch.tip.document, label: `Branch ${branch.name}: accepted tip`, provenance:branch.tip.provenance?.current??null};
  }
  const redo = [...state.future].reverse(), transitions = [...state.past, ...redo];
  const documents = [...state.past.map(entry => entry.document), state.document, ...redo.map(entry => entry.document)];
  if (target.position >= documents.length) throw new Error('History position is outside the retained timeline.');
  return {document: documents[target.position], label: target.position ? transitions[target.position - 1].label : 'Oldest retained state', provenance:timelineProvenance(state)[target.position]};
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
export function historyTip(state: Pick<HistoryState, 'document' | 'past' | 'future' | 'provenance'>): HistoryTip {
  const redo = [...state.future].reverse();
  const documents = [...state.past.map(entry => entry.document), state.document, ...redo.map(entry => entry.document)];
  const points=timelineProvenance(state),provenance=knownTipProvenance({current:points[points.length-1],past:points.slice(0,-1)});
  return {document: documents[documents.length - 1], past: [...state.past, ...redo].map((entry, index) => ({...entry, document: documents[index]})),...(provenance?{provenance}:{})};
}
export function captureRetainedHistory(state: HistoryState): RetainedHistory {
  const linear = {past: state.past, future: state.future};
  const provenance=state.provenance??unknownProvenance(state.past.length,state.future.length);
  if(provenance.current||provenance.past.some(Boolean)||provenance.future.some(Boolean)||state.branches?.some(value=>value.forkProvenance||value.tip.provenance)||state.comparisons?.some(value=>value.beforeProvenance||value.afterProvenance))
    return {version:4,...linear,branches:state.branches??[],activeBranchId:state.activeBranchId??null,comparisons:state.comparisons??[],provenance};
  if (state.comparisons?.length) return {version: 3, ...linear, branches: state.branches ?? [], activeBranchId: state.activeBranchId ?? null, comparisons: state.comparisons};
  return state.branches?.length && state.activeBranchId
    ? {version: 2, ...linear, branches: state.branches, activeBranchId: state.activeBranchId}
    : {version: 1, ...linear};
}
/** Complete source closure for serialization, workers and abandoned-stage cleanup. */
export function retainedDocuments(document: DocumentData, history?: RetainedHistory): DocumentData[] {
  return [...new Set([document, ...(history?.past ?? []).map(entry => entry.document), ...(history?.future ?? []).map(entry => entry.document),
    ...(history && history.version !== 1 ? history.branches.flatMap(branch => [branch.forkDocument, branch.tip.document, ...branch.tip.past.map(entry => entry.document)]) : []),
    ...(history && (history.version === 3 || history.version === 4) ? history.comparisons.flatMap(comparison => [comparison.before, comparison.after]) : [])])];
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
  const comparisons = (parsed.version === 3 || parsed.version === 4) ? parsed.comparisons.map(value => {
    const before = model(value.before), after = model(value.after);
    return {...value, before, after, region: validateHistoryRegion(value.region, before, after)};
  }) : [];
  if (new Set(comparisons.map(value => value.id)).size !== comparisons.length || new Set(comparisons.map(value => historyNameKey(value.name))).size !== comparisons.length)
    throw new Error('Duplicate history comparison identifier or name.');
  const branches:HistoryBranch[] = parsed.branches.map(branch => ({...branch, forkDocument: model(branch.forkDocument), tip: {document: model(branch.tip.document), past: entries(branch.tip.past),...('provenance'in branch.tip && branch.tip.provenance && knownTipProvenance(branch.tip.provenance)?{provenance:branch.tip.provenance}:{})}}));
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
  const provenance=parsed.version===4?parsed.provenance:unknownProvenance(linear.past.length,linear.future.length);
  if(parsed.version===4)validateHistoryProvenance(current,{...linear,branches,comparisons,provenance});
  if (active && !sameData(active.tip, historyTip({document: current, ...linear, provenance})))
    throw new Error('Active history branch does not match the retained timeline.');
  if(parsed.version===4)return {version:4,...linear,branches,activeBranchId:parsed.activeBranchId,comparisons,provenance};
  return parsed.version === 3 ? {version: 3, ...linear, branches, activeBranchId: parsed.activeBranchId, comparisons}
    : {version: 2, ...linear, branches, activeBranchId: parsed.activeBranchId};
}


export function timelineProvenance(state:Pick<HistoryState,'past'|'future'|'provenance'>):(HistoryOperation|null)[] {
 const provenance=state.provenance??unknownProvenance(state.past.length,state.future.length);
 return [...provenance.past,provenance.current,...[...provenance.future].reverse()];
}
/** Ordinary unbranched downloads retain current-result attribution without silently adding Undo. */
export function captureProjectHistory(state:HistoryState):RetainedHistory|undefined {
 if(state.branches?.length||state.comparisons?.length)return captureRetainedHistory(state);
 const current=state.provenance?.current;
 return current?{version:4,past:[],future:[],branches:[],activeBranchId:null,comparisons:[],provenance:{current,past:[],future:[]}}:undefined;
}
function validateHistoryProvenance(current:DocumentData,state:{past:HistoryEntry[];future:HistoryEntry[];branches:HistoryBranch[];comparisons:HistoryComparison[];provenance:HistoryProvenance}) {
 const registry=new Map<string,{operation:HistoryOperation;document:DocumentData}>();
 const point=(operation:HistoryOperation|null|undefined,document:DocumentData)=>{
  if(!operation)return;
  if(operation.documentId!==current.id)throw new Error('Operation provenance belongs to another document.');
  const known=registry.get(operation.id);
  if(known&&(!sameData(known.operation,operation)||!sameData(known.document,document)))throw new Error('Operation identifier has inconsistent provenance or result state.');
  registry.set(operation.id,{operation,document});
 };
 const path=(document:DocumentData,past:HistoryEntry[],future:HistoryEntry[],provenance:HistoryProvenance)=>{
  if(provenance.past.length!==past.length||provenance.future.length!==future.length)throw new Error('Operation provenance does not match its retained states.');
  point(provenance.current,document);past.forEach((entry,index)=>point(provenance.past[index],entry.document));future.forEach((entry,index)=>point(provenance.future[index],entry.document));
 };
 path(current,state.past,state.future,state.provenance);
 for(const branch of state.branches){point(branch.forkProvenance,branch.forkDocument);if(branch.tip.provenance)path(branch.tip.document,branch.tip.past,[],{...branch.tip.provenance,future:[]});}
 for(const comparison of state.comparisons){point(comparison.beforeProvenance,comparison.before);point(comparison.afterProvenance,comparison.after);}
}
