import {useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent} from 'react';
import type {Document} from '../../dom';
import {isTextInput, LAYER_TREE_BINDINGS, matchesShortcut} from '../shortcuts';
import {layerTreeRange, layerTreeSearch, type LayerTreeItem} from '../layer-tree';

interface RangeAnchor {owner: Document; id: string; selection: string; order: string; base: readonly string[]}
export function useLayerTreeKeyboard({document: owner, rows, matches, collapsed, filtered, isCurrent, select, collapse}: {
  document: Document; rows: readonly LayerTreeItem[]; matches: ReadonlySet<string>; collapsed: ReadonlySet<string>; filtered: boolean;
  isCurrent(): boolean; select(ids: readonly string[]): boolean; collapse(id: string, value: boolean): void;
}) {
  const root = useRef<HTMLDivElement>(null), inside = useRef(false), ownSelection = useRef(false);
  const anchor = useRef<RangeAnchor | null>(null), typing = useRef({value: '', at: 0});
  const [focused, setFocused] = useState<{owner: Document; id: string} | null>(null);
  const previous = useRef<{owner: Document; rows: readonly LayerTreeItem[]}>({owner, rows});
  const order = JSON.stringify(rows.map(row => row.node.id));
  const selection = JSON.stringify(owner.getSnapshot().selectedIds);
  const defaultId = () => rows.find(row => owner.getSnapshot().selectedIds.includes(row.node.id))?.node.id ?? rows[0]?.node.id ?? '';
  const focusId = focused?.owner === owner && rows.some(row => row.node.id === focused.id) ? focused.id : defaultId();
  const element = (id: string) => [...root.current?.querySelectorAll<HTMLElement>('[data-layer-node-id]') ?? []].find(node => node.dataset.layerNodeId === id);
  const focus = (id: string) => {
    if (!isCurrent() || !rows.some(row => row.node.id === id)) return;
    setFocused({owner, id}); const node = element(id);
    node?.focus({preventScroll: true}); node?.querySelector('.layer-row')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  };
  useLayoutEffect(() => {
    const stop = owner.subscribe(() => {
      if (!ownSelection.current && anchor.current?.owner === owner && anchor.current.selection !== JSON.stringify(owner.getSnapshot().selectedIds)) anchor.current = null;
    });
    return stop;
  }, [owner]);
  useLayoutEffect(() => {
    const old = previous.current;
    if (old.owner !== owner || JSON.stringify(old.rows.map(row => row.node.id)) !== order) { anchor.current = null; typing.current = {value: '', at: 0}; }
    let next = inside.current ? focusId : defaultId();
    if (inside.current && focused?.owner === owner && !rows.some(row => row.node.id === focused.id)) {
      const parent = old.rows.find(row => row.node.id === focused.id)?.parent;
      next = parent && rows.some(row => row.node.id === parent) ? parent : rows[Math.min(Math.max(0, old.rows.findIndex(row => row.node.id === focused.id)), rows.length - 1)]?.node.id ?? '';
    }
    if (focused?.owner !== owner || focused.id !== next) setFocused(next ? {owner, id: next} : null);
    previous.current = {owner, rows};
    if (inside.current && root.current && (!root.current.contains(document.activeElement) || old.owner !== owner || !!next && document.activeElement === root.current)) {
      if (next) { const node = element(next); node?.focus({preventScroll: true}); node?.querySelector('.layer-row')?.scrollIntoView({block: 'nearest', inline: 'nearest'}); } else root.current.focus({preventScroll: true});
    }
  }, [owner, order, focusId, selection]);
  const markAnchor = (id: string) => {
    if (!isCurrent()) return;
    const ids = owner.getSnapshot().selectedIds;
    anchor.current = {owner, id, order, selection: JSON.stringify(ids), base: [...ids]};
  };
  const choose = (ids: readonly string[]) => {
    if (!isCurrent()) return false;
    ownSelection.current = true;
    try { return select([...new Set(ids)]); } finally { ownSelection.current = false; }
  };
  const range = (target: string, from: string, additive: boolean) => {
    const snapshot = owner.getSnapshot(), token = JSON.stringify(snapshot.selectedIds), saved = anchor.current;
    const current = saved?.owner === owner && saved.order === order && saved.selection === token ? saved : {owner, id: from, order, selection: token, base: [...snapshot.selectedIds]};
    const ids = layerTreeRange(rows, current.id, target, filtered ? matches : undefined);
    const combined = additive ? [...new Set([...current.base, ...ids])] : ids;
    const next = combined.includes(target) ? [...combined.filter(id => id !== target), target] : combined;
    if (choose(next)) anchor.current = {...current, selection: JSON.stringify(owner.getSnapshot().selectedIds)};
    else anchor.current = null;
  };
  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    inside.current = true;
    const node = (event.target as Element).closest<HTMLElement>('[data-layer-node-id]');
    if (node && event.currentTarget.contains(node)) setFocused({owner, id: node.dataset.layerNodeId!});
  };
  const onBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    inside.current = false; typing.current = {value: '', at: 0};
    const id = defaultId(); setFocused(id ? {owner, id} : null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || isTextInput(event.target) || event.altKey) return;
    const target = event.target as Element, rowElement = target.closest<HTMLElement>('[data-layer-node-id]');
    if (!rowElement) {
      if (Object.values(LAYER_TREE_BINDINGS).includes(event.key) || matchesShortcut(event.nativeEvent, LAYER_TREE_BINDINGS.selectAll) || !event.ctrlKey && !event.metaKey && [...event.key].length === 1) {
        event.preventDefault(); event.stopPropagation();
        if (matchesShortcut(event.nativeEvent, LAYER_TREE_BINDINGS.selectAll) && isCurrent()) { choose([]); anchor.current = null; }
      }
      return;
    }
    if (!event.currentTarget.contains(rowElement)) return;
    const id = rowElement.dataset.layerNodeId!, index = rows.findIndex(row => row.node.id === id), row = rows[index];
    if (!row) return;
    const consume = () => { event.preventDefault(); event.stopPropagation(); };
    const action = target.closest<HTMLButtonElement>('button[data-layer-action]');
    // Buttons retain native activation; Space must never start canvas panning.
    if (action && (event.key === LAYER_TREE_BINDINGS.select || event.key === LAYER_TREE_BINDINGS.toggle)) { event.stopPropagation(); return; }
    if (matchesShortcut(event.nativeEvent, LAYER_TREE_BINDINGS.selectAll)) {
      consume(); if (!isCurrent()) return;
      const ids = rows.filter(row => !filtered || matches.has(row.node.id)).map(row => row.node.id);
      if (choose(ids)) markAnchor(id); return;
    }
    const keys = LAYER_TREE_BINDINGS;
    if ([keys.previous, keys.next, keys.first, keys.last].includes(event.key)) {
      consume(); if (!isCurrent()) return;
      const next = event.key === keys.first ? 0 : event.key === keys.last ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === keys.next ? 1 : -1)));
      const nextId = rows[next].node.id; if (event.shiftKey) range(nextId, id, event.ctrlKey || event.metaKey); focus(nextId); return;
    }
    if (event.key === keys.expand || event.key === keys.collapse) {
      consume(); if (!isCurrent()) return;
      if (event.key === keys.expand) {
        if (row.hasChildren && collapsed.has(id) && !filtered) collapse(id, false);
        else if (row.hasChildren) { const child = rows[index + 1]; if (child?.parent === id) focus(child.node.id); }
      } else if (row.hasChildren && !collapsed.has(id) && !filtered) collapse(id, true);
      else if (row.parent) focus(row.parent);
      return;
    }
    if (event.key === keys.select || event.key === keys.toggle) {
      consume(); if (!isCurrent()) return;
      if (event.key === keys.toggle && event.shiftKey) {
        const active = owner.getSnapshot().selectedId;
        range(id, active && rows.some(row => row.node.id === active) ? active : id, event.ctrlKey || event.metaKey);
      }
      else {
        const selected = owner.getSnapshot().selectedIds;
        const ids = event.key === keys.select ? [id] : selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
        if (choose(ids)) markAnchor(id);
      }
      return;
    }
    if (!event.ctrlKey && !event.metaKey && [...event.key].length === 1) {
      consume(); if (!isCurrent()) return;
      const now = performance.now(), previous = now - typing.current.at < 700 ? typing.current.value : '';
      const value = previous && [...previous].every(char => char.toLocaleLowerCase() === event.key.toLocaleLowerCase()) ? event.key : previous + event.key;
      typing.current = {value, at: now}; const found = layerTreeSearch(rows, id, value); if (found) focus(found);
    }
  };
  return {root, focusId, hasFocus: inside.current, focus, markAnchor, onFocusCapture, onBlurCapture, onKeyDown};
}
