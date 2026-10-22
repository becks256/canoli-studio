import type { ShortcutAction } from "./shortcuts";

export function commandCategory(action: ShortcutAction): string {
  if(action.category)return action.category;
  if (
    [
      "move",
      "hand",
      "marquee",
      "fill",
      "brush",
      "pencil",
      "eraser",
      "pen",
      "text",
      "clone",
      "artboard",
      "crop",
    ].includes(action.id) ||
    /tool|brush size|path|crop/i.test(action.label)
  )
    return "Tools";
  if (/layer|group|nudge/i.test(action.label)) return "Layers";
  if (/zoom|fit|actual/i.test(action.label)) return "View";
  if (/project|image|document|export|save/i.test(action.label))
    return "Document";
  return "Workspace";
}

/** Prefer exact words, then substrings, then ordered abbreviation matches. */
export function searchCommands(
  actions: readonly ShortcutAction[],
  query: string,
): ShortcutAction[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return actions
    .map((action, order) => {
      const label = action.label.toLocaleLowerCase();
      const haystack = `${label} ${commandCategory(action).toLocaleLowerCase()} ${(action.description??'').toLocaleLowerCase()}`;
      let score = 0;
      for (const word of words) {
        const direct = haystack.indexOf(word);
        if (direct >= 0) {
          score +=
            direct + (direct === 0 || haystack[direct - 1] === " " ? 0 : 20);
          continue;
        }
        let cursor = 0,
          start = -1;
        for (const char of word) {
          const index = haystack.indexOf(char, cursor);
          if (index < 0) return { action, order, score: Infinity };
          if (start < 0) start = index;
          cursor = index + 1;
        }
        score += 100 + cursor - start;
      }
      if (words.length && label === words.join(" ")) score -= 100;
      return { action, order, score };
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map((item) => item.action);
}
