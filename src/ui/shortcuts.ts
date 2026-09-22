export interface ShortcutAction {
  id: string;
  label: string;
  keys: string[];
  run(): void;
  enabled?(): boolean;
}

export function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"]',
    )
  );
}

export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: string,
): boolean {
  const parts = shortcut === "+" ? ["+"] : shortcut.toLowerCase().split("+");
  const key = parts.pop()!;
  const mod = parts.includes("mod");
  const ctrl = parts.includes("ctrl");
  const shift = parts.includes("shift");
  const normalizedKey = event.key.toLowerCase();
  if (normalizedKey !== key) return false;
  if (
    mod
      ? !(event.metaKey || event.ctrlKey)
      : ctrl
        ? !event.ctrlKey || event.metaKey
        : event.metaKey || event.ctrlKey
  )
    return false;
  if (event.altKey !== parts.includes("alt")) return false;
  // Characters such as ? and + are already shifted on common layouts.
  if (!["?", "+"].includes(key) && event.shiftKey !== shift) return false;
  return true;
}

export class ShortcutRegistry {
  constructor(readonly actions: ShortcutAction[]) {}
  handle(event: KeyboardEvent): boolean {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      isTextInput(event.target)
    )
      return false;
    const action = this.actions.find((entry) =>
      entry.keys.some((key) => matchesShortcut(event, key)),
    );
    if (!action || action.enabled?.() === false) return false;
    event.preventDefault();
    action.run();
    return true;
  }
}

export function formatShortcut(shortcut: string): string {
  if (shortcut === "+") return "+";
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return shortcut
    .replace("Mod", mac ? "⌘" : "Ctrl")
    .replace("Shift", "⇧")
    .replace("Arrow", "")
    .replaceAll("+", " ");
}

// Binding definitions are shared by action registration and keyboard help.
export const SHORTCUT_BINDINGS: Record<string, string[]> = {
  plugins: ["Mod+Shift+l"],
  artboard: ["a"],
  move: ["v"],
  hand: ["h"],
  text: ["t"],
  fill: ["g"],
  "select-all": ["Mod+a"],
  deselect: ["Mod+d"],
  "finish-path": ["Enter"],
  import: ["Mod+o"],
  open: ["Mod+Shift+o"],
  save: ["Mod+s"],
  export: ["Mod+Shift+e"],
  undo: ["Mod+z"],
  redo: ["Mod+Shift+z", "Ctrl+y"],
  duplicate: ["Mod+j"],
  delete: ["Delete", "Backspace"],
  "new-layer": ["Mod+Shift+n"],
  group: ["Mod+g"],
  up: ["Mod+]"],
  down: ["Mod+["],
  fit: ["Mod+0"],
  actual: ["Mod+1"],
  "zoom-in": ["+", "="],
  "zoom-out": ["-"],
  scripts: ["Mod+Shift+k"],
  help: ["?"],
};
export const TOOL_SHORTCUTS = [
  ["artboard", "Artboard editor", "a"],
  ["brush", "Brush", "b"],
  ["pencil", "Pencil", "n"],
  ["pen", "Vector pen", "p"],
  ["text", "Text tool", "t"],
  ["fill", "Paint bucket", "g"],
  ["marquee", "Marquee", "m"],
  ["clone", "Clone brush", "s"],
] as const;
export const brushSizeKeys = (direction: number) => [direction < 0 ? "[" : "]"];
export const nudgeKeys = (direction: string, distance: number) => [
  `${distance === 10 ? "Shift+" : ""}Arrow${direction}`,
];
