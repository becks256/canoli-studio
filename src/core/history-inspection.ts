import type {DocumentData, LayerData} from './model';
import type {EditorState} from './store';
import {layerBounds, unionBounds} from './spatial';

type TimelineState = Pick<EditorState, 'document' | 'past' | 'future'>;
let labelSegments: Intl.Segmenter | undefined;
export function displayHistoryLabel(label: string) {
  if (label.length <= 240) return label;
  let end = 0;
  if (typeof Intl.Segmenter === 'function') {
    labelSegments ??= new Intl.Segmenter(undefined, {granularity: 'grapheme'});
    for (const part of labelSegments.segment(label)) {
      const next = part.index + part.segment.length; if (next > 240) break; end = next;
    }
  } else {
    for (const character of label) {if (end + character.length > 240) break; end += character.length;}
  }
  return label.slice(0, end) + '…';
}
export function historyTimeline(state: TimelineState) {
  const redo = [...state.future].reverse();
  return [{position: 0, label: 'Oldest retained state', labelTruncated: false, document: state.past[0]?.document ?? state.document},
    ...[...state.past, ...redo].map((entry, index) => ({position: index + 1, label: displayHistoryLabel(entry.label), labelTruncated:entry.label.length>240,
      document: index + 1 < state.past.length ? state.past[index + 1].document
        : index + 1 === state.past.length ? state.document : redo[index - state.past.length].document}))];
}

/** Iterative traversal preserves parent links without deep recursion or repeated ancestry walks. */
export function historyBranchTree(branches: EditorState['branches']) {
  const children = new Map<string | null, EditorState['branches']>();
  for (const branch of branches) {const siblings = children.get(branch.parentId) ?? []; siblings.push(branch); children.set(branch.parentId, siblings);}
  const result: {id: string; name: string; parentId: string | null; depth: number}[] = [];
  const stack = (children.get(null) ?? []).map(branch => ({branch, depth: 0})).reverse();
  while (stack.length) {
    const {branch, depth} = stack.pop()!; result.push({id: branch.id, name: branch.name, parentId: branch.parentId, depth});
    for (const child of [...children.get(branch.id) ?? []].reverse()) stack.push({branch: child, depth: depth + 1});
  }
  return result;
}

export interface HistoryLayerChange {
  id: string; name: string; kind: string; change: 'added' | 'removed' | 'edited';
  fields: string[]; unexaminedFields: string[];
  beforeBounds: ReturnType<typeof layerBounds>; afterBounds: ReturnType<typeof layerBounds>;
}
export interface HistoryChangeSummary {
  documentFields: string[]; unexaminedDocumentFields: string[]; layers: HistoryLayerChange[];
  totalLayers: number; omittedLayers: number; comparisonIncomplete: boolean; boundsUnavailable: boolean;
  bounds: ReturnType<typeof unionBounds>;
}
/** Metadata comparison budget, unrelated to source dimensions or rendering allocation. */
const COMPARISON_VISITS = 250_000;
function equal(a: unknown, b: unknown, remaining: {value: number}): boolean | undefined {
  if (Object.is(a, b)) return true;
  if (--remaining.value < 0) return undefined;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if(Array.isArray(a)&&Array.isArray(b)) {
    if(a.length!==b.length)return false;
    if(a.length>remaining.value)return undefined;
    for(let index=0;index<a.length;index++){const value=equal(a[index],b[index],remaining);if(value!==true)return value;}
    return true;
  }
  const left = Object.keys(a), right = Object.keys(b);
  if (left.length !== right.length) return false;
  for (const key of left) {
    if (!Object.hasOwn(b, key)) return false;
    const result = equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], remaining);
    if (result !== true) return result;
  }
  return true;
}
export function inspectHistoryChange(before: DocumentData | null, after: DocumentData): HistoryChangeSummary {
  const remaining = {value: COMPARISON_VISITS};
  const result: HistoryChangeSummary = {documentFields: [], unexaminedDocumentFields: [], layers: [], totalLayers: 0,
    omittedLayers: 0, comparisonIncomplete: false, boundsUnavailable: false, bounds: undefined};
  if (!before) return result;
  const fields = (left: object, right: object, excluded: string[]) => {
    const changed: string[] = [], unknown: string[] = [];
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (excluded.includes(key)) continue;
      const comparison = equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], remaining);
      if (comparison === false) changed.push(key);
      else if (comparison === undefined) {unknown.push(key); result.comparisonIncomplete = true;}
    }
    return {changed, unknown};
  };
  const document = fields(before, after, ['children', 'id', 'schemaVersion']);
  result.documentFields = document.changed; result.unexaminedDocumentFields = document.unknown;
  type Indexed = {layer: LayerData; parent: string | null; index: number};
  const index = (document: DocumentData) => {
    const entries = new Map<string, Indexed>();
    const visit = (children: LayerData[], parent: string | null) => children.forEach((layer, index) => {
      entries.set(layer.id, {layer, parent, index}); if (layer.kind === 'group') visit(layer.children, layer.id);
    });
    visit(document.children, null); return entries;
  };
  const left = index(before), right = index(after);
  const bounds: NonNullable<ReturnType<typeof layerBounds>>[] = [];
  const geometry = (document: DocumentData, id: string) => {
    try {const value = layerBounds(document, id); if (value) bounds.push(value); return value;}
    catch {result.boundsUnavailable = true; return undefined;}
  };
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(id), b = right.get(id), comparison = a && b ? fields(a.layer, b.layer, ['id', 'children']) : {changed: [], unknown: []};
    if (a && b && (a.parent !== b.parent || a.index !== b.index)) comparison.changed.push('layer order/parent');
    if (a && b && !comparison.changed.length && !comparison.unknown.length) continue;
    result.totalLayers++;
    if (result.layers.length >= 32) {result.omittedLayers++; continue;}
    const layer = (b ?? a)!.layer;
    result.layers.push({id, name: layer.name, kind: layer.kind, change: !a ? 'added' : !b ? 'removed' : 'edited',
      fields: comparison.changed, unexaminedFields: comparison.unknown,
      beforeBounds: a ? geometry(before, id) : undefined, afterBounds: b ? geometry(after, id) : undefined});
  }
  result.bounds = unionBounds(bounds);
  return result;
}
