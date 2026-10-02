import { matchesShortcut } from "./shortcuts";
import type { ShortcutAction } from "./shortcuts";

export type ShortcutOverrides = Record<string, string[]>;
export const SHORTCUT_STORAGE_KEY = "luma.shortcut-bindings.v1";
const specialKeys = new Set([
  "enter",
  "delete",
  "backspace",
  "home",
  "end",
  "pageup",
  "pagedown",
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

/** Canonical keyboard-event key syntax, compatible with the shared dispatcher. */
export function normalizeBinding(binding: string): string {
  const value = binding.trim().toLowerCase();
  const plus = value === "+" || value.endsWith("++");
  const parts = plus
    ? value === "+"
      ? []
      : value.slice(0, -2).split("+")
    : value.split("+");
  const key = plus ? "+" : parts.pop()!;
  if (
    !(key.length === 1 && /^[a-z0-9\[\];',.\/\\=+\-?]$/.test(key)) &&
    !specialKeys.has(key)
  )
    throw new Error(
      "Choose a letter, number, punctuation, arrow, function or editing key. Escape, Tab and Space are reserved.",
    );
  if (
    parts.some((part) => !["mod", "ctrl", "shift", "alt"].includes(part)) ||
    new Set(parts).size !== parts.length ||
    (parts.includes("mod") && parts.includes("ctrl"))
  )
    throw new Error("Invalid shortcut modifiers.");
  // The existing dispatcher treats + and ? as shifted characters themselves.
  const modifiers = ["mod", "ctrl", "alt", "shift"].filter(
    (part) =>
      parts.includes(part) && !(part === "shift" && ["+", "?"].includes(key)),
  );
  return [...modifiers, key].join("+");
}

export function bindingFromEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
): string {
  if (event.ctrlKey && event.metaKey)
    throw new Error("Use one primary modifier.");
  return normalizeBinding(
    [
      ...(event.ctrlKey || event.metaKey ? ["mod"] : []),
      ...(event.altKey ? ["alt"] : []),
      ...(event.shiftKey ? ["shift"] : []),
      event.key,
    ].join("+"),
  );
}

function overlaps(left: string, right: string): boolean {
  // Test both platform meanings of Mod, including shifted punctuation aliases.
  for (const key of [
    left.split("+").at(-1) || "+",
    right.split("+").at(-1) || "+",
  ]) {
    for (let flags = 0; flags < 16; flags++) {
      const event = {
        key,
        ctrlKey: !!(flags & 1),
        metaKey: !!(flags & 2),
        altKey: !!(flags & 4),
        shiftKey: !!(flags & 8),
      } as KeyboardEvent;
      if (matchesShortcut(event, left) && matchesShortcut(event, right))
        return true;
    }
  }
  return false;
}

export function resolveShortcutBindings(
  actions: readonly ShortcutAction[],
  overrides: ShortcutOverrides,
): ShortcutAction[] {
  const resolved = actions.map((action) => ({
    ...action,
    keys: Object.hasOwn(overrides, action.id)
      ? overrides[action.id].map(normalizeBinding)
      : action.keys.map(normalizeBinding),
  }));
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      if (
        resolved[i].keys.some((left) =>
          resolved[j].keys.some((right) => overlaps(left, right)),
        )
      )
        throw new Error(
          `Shortcut conflicts between ${resolved[i].label} and ${resolved[j].label}.`,
        );
    }
  }
  return resolved;
}

export function readShortcutBindings(
  storage: Pick<Storage, "getItem">,
): ShortcutOverrides {
  const raw = storage.getItem(SHORTCUT_STORAGE_KEY);
  if (raw === null) return Object.create(null);
  const saved = JSON.parse(raw);
  if (
    !saved ||
    saved.version !== 1 ||
    !saved.bindings ||
    typeof saved.bindings !== "object" ||
    Array.isArray(saved.bindings)
  )
    throw new Error("Saved shortcut settings are invalid.");
  const result: ShortcutOverrides = Object.create(null);
  for (const [id, keys] of Object.entries(saved.bindings)) {
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string"))
      throw new Error("Saved shortcut binding is invalid.");
    result[id] = keys.map(normalizeBinding);
  }
  return result;
}

/** Caller installs returned overrides only after this write succeeds. */
export function saveShortcutBindings(
  storage: Pick<Storage, "setItem">,
  actions: readonly ShortcutAction[],
  overrides: ShortcutOverrides,
): ShortcutOverrides {
  resolveShortcutBindings(actions, overrides);
  const snapshot = structuredClone(overrides);
  storage.setItem(
    SHORTCUT_STORAGE_KEY,
    JSON.stringify({ version: 1, bindings: snapshot }),
  );
  return snapshot;
}
