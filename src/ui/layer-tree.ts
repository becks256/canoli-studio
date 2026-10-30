import type {LayerData} from '../core/model';

export interface LayerTreeItem {
  node: LayerData;
  parent: string | null;
  level: number;
  position: number;
  siblings: number;
  hasChildren: boolean;
}

/** The same top-to-bottom order as the rendered Layers panel. */
export function visibleLayerTree(nodes: readonly LayerData[], included: ReadonlySet<string>, collapsed: ReadonlySet<string>, filtered: boolean): LayerTreeItem[] {
  const rows: LayerTreeItem[] = [];
  const visit = (children: readonly LayerData[], parent: string | null, level: number) => {
    const siblings = [...children].reverse().filter(node => included.has(node.id));
    siblings.forEach((node, index) => {
      const hasChildren = node.kind === 'group' && node.children.some(child => included.has(child.id));
      rows.push({node, parent, level, position: index + 1, siblings: siblings.length, hasChildren});
      if (node.kind === 'group' && (filtered || !collapsed.has(node.id))) visit(node.children, node.id, level + 1);
    });
  };
  visit(nodes, null, 1); return rows;
}

export function layerTreeRange(rows: readonly LayerTreeItem[], anchor: string, target: string, matches?: ReadonlySet<string>): string[] {
  const start = rows.findIndex(row => row.node.id === anchor), end = rows.findIndex(row => row.node.id === target);
  if (start < 0 || end < 0) return [];
  const ids = rows.slice(Math.min(start, end), Math.max(start, end) + 1).map(row => row.node.id).filter(id => !matches || matches.has(id));
  // The range endpoint is the active layer, including an upward range.
  return ids.includes(target) ? [...ids.filter(id => id !== target), target] : ids;
}

export function layerTreeSearch(rows: readonly LayerTreeItem[], focused: string, prefix: string): string | null {
  const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const start = rows.findIndex(row => row.node.id === focused), query = normalize(prefix);
  const first = [...prefix].length > 1 ? 0 : 1;
  for (let offset = first; offset < rows.length + first; offset++) {
    const row = rows[(start + offset + rows.length) % rows.length];
    if (normalize(row.node.name).startsWith(query)) return row.node.id;
  }
  return null;
}
