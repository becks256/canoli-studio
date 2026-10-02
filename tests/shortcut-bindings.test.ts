import { expect, it } from "vitest";
import {
  bindingFromEvent,
  normalizeBinding,
  readShortcutBindings,
  resolveShortcutBindings,
  saveShortcutBindings,
} from "../src/ui/shortcut-bindings";
import { matchesShortcut } from "../src/ui/shortcuts";
const actions = [
  { id: "move", label: "Move", keys: ["v"], run() {} },
  { id: "brush", label: "Brush", keys: ["b"], run() {} },
];
it("captures and dispatches modified punctuation and rejects reserved keys", () => {
  const event = {
    key: "+",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: true,
  } as KeyboardEvent;
  expect(bindingFromEvent(event)).toBe("mod++");
  expect(matchesShortcut(event, "mod++")).toBe(true);
  for (const key of ["Escape", "Tab", " ", "Shift"])
    expect(() => normalizeBinding(key)).toThrow();
});
it("detects cross-platform conflicts while allowing disabled bindings", () => {
  expect(() => resolveShortcutBindings(actions, { move: ["b"] })).toThrow(
    /conflicts/,
  );
  expect(() =>
    resolveShortcutBindings(actions, { move: ["Mod+x"], brush: ["Ctrl+x"] }),
  ).toThrow(/conflicts/);
  expect(
    resolveShortcutBindings(actions, { move: [], brush: ["v"] }).map(
      (action) => action.keys,
    ),
  ).toEqual([[], ["v"]]);
});
it("round trips preferences and propagates storage failures without modifying supplied bindings", () => {
  let saved = "";
  const bindings = { move: ["x"] };
  saveShortcutBindings(
    {
      setItem(_key, value) {
        saved = value;
      },
    },
    actions,
    bindings,
  );
  expect(readShortcutBindings({ getItem: () => saved })).toEqual(bindings);
  expect(() =>
    saveShortcutBindings(
      {
        setItem() {
          throw new Error("quota");
        },
      },
      actions,
      bindings,
    ),
  ).toThrow("quota");
  expect(bindings).toEqual({ move: ["x"] });
  expect(() => readShortcutBindings({ getItem: () => "{broken" })).toThrow();
});
