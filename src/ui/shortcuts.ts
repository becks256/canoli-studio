export interface ShortcutAction {
  id: string;
  label: string;
  keys: string[];
  run(): void;
  enabled?(): boolean;
  allowWhileBusy?: boolean;
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
  const normalized = shortcut.toLowerCase();
  const parts =
    normalized === "+"
      ? ["+"]
      : normalized.endsWith("++")
        ? [...normalized.slice(0, -2).split("+"), "+"]
        : normalized.split("+");
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
  handle(event: KeyboardEvent, busy = false): boolean {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      isTextInput(event.target)
    )
      return false;
    const action = this.actions.find((entry) =>
      entry.keys.some((key) => matchesShortcut(event, key)),
    );
    if (!action || (busy && !action.allowWhileBusy) || action.enabled?.() === false) return false;
    event.preventDefault();
    action.run();
    return true;
  }
}

export function formatShortcut(shortcut: string): string {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const value = shortcut.toLowerCase();
  const parts =
    value === "+"
      ? ["+"]
      : value.endsWith("++")
        ? [...value.slice(0, -2).split("+"), "+"]
        : value.split("+");
  return parts
    .map((part) => {
      if (part === "mod") return mac ? "⌘" : "Ctrl";
      if (part === "ctrl") return "Ctrl";
      if (part === "shift") return "⇧";
      if (part === "alt") return "Alt";
      if (part.startsWith("arrow")) part = part.slice(5);
      return part.length === 1
        ? part.toUpperCase()
        : part[0].toUpperCase() + part.slice(1);
    })
    .join(" ");
}

// Binding definitions are shared by action registration and keyboard help.
export const SHORTCUT_BINDINGS: Record<string, string[]> = {
  "command-palette": ["Mod+k"],
  plugins: ["Mod+Shift+l"],
  "image-size": ["Mod+Alt+i"],
  artboard: ["a"],
  crop: ["c"],
  move: ["v"],
  hand: ["h"],
  eraser: ["e"],
  text: ["t"],
  fill: ["g"],
  "copy-pixels": ["Mod+c"],
  "paste-pixels": ["Mod+v"],
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
  recipes: ["Mod+Shift+r"],
  batch: ["Mod+Shift+b"],
  generate: ["Mod+Shift+g"],
  colorSettings: ["Mod+Alt+k"],
  psd: ["Mod+Alt+p"],
  refineEdge: ["Mod+Alt+r"],
  selectSubject: ["Mod+Alt+s"],
  help: ["?"],
};
export const TOOL_SHORTCUTS = [
  ["artboard", "Artboard editor", "a"],
  ["crop", "Crop canvas", "c"],
  ["brush", "Brush", "b"],
  ["dodge", "Dodge", "o"],
  ["burn", "Burn", "Shift+o"],
  ["pencil", "Pencil", "n"],
  ["eraser", "Eraser", "e"],
  ["pen", "Vector pen", "p"],
  ["text", "Text tool", "t"],
  ["fill", "Paint bucket", "g"],
  ["marquee", "Marquee", "m"],
  ["lasso", "Freeform lasso", "l"],
  ["wand", "Magic wand", "w"],
  ["clone", "Clone brush", "s"],
  ["patch", "Patch", "j"],
  ["heal", "Spot Healing", "Shift+j"],
] as const;
export const brushSizeKeys = (direction: number) => [direction < 0 ? "[" : "]"];
export const nudgeKeys = (direction: string, distance: number) => [
  `${distance === 10 ? "Shift+" : ""}Arrow${direction}`,
];

/** Tab-widget ordering; Alt modifier, scoped to the focused document tab. */
export const TAB_REORDER_KEYS = {
  previous: "ArrowLeft",
  next: "ArrowRight",
} as const;
