import { createContext, useContext } from "react";
import { formatShortcut } from "./shortcuts";
import type { ShortcutOverrides } from "./shortcut-bindings";

export const ShortcutHints = createContext<ShortcutOverrides>({});
export function useShortcutHint(
  id: string | undefined,
  fallback: string,
): string {
  const overrides = useContext(ShortcutHints);
  if (!id || !Object.hasOwn(overrides, id)) return fallback;
  return overrides[id].map(formatShortcut).join(" / ");
}
export function useShortcutLabel(
  id: string | undefined,
  label: string,
): string {
  const overrides = useContext(ShortcutHints);
  if (!id || !Object.hasOwn(overrides, id)) return label;
  const name = label.replace(/\s+\([^()]*\)$/, "");
  const hint = overrides[id].map(formatShortcut).join(" / ");
  return hint ? `${name} (${hint})` : name;
}
