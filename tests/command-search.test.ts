import { describe, expect, it } from "vitest";
import { searchCommands } from "../src/ui/command-search";
import type { ShortcutAction } from "../src/ui/shortcuts";
const actions: ShortcutAction[] = [
  "Import image",
  "Open project",
  "Save project",
  "Move tool",
  "Undo",
].map((label) => ({
  id: label,
  label,
  keys: [],
  run() {},
}));
describe("command search", () => {
  it("ranks exact words ahead of substrings and abbreviations", () => {
    expect(searchCommands(actions, "open project")[0].label).toBe(
      "Open project",
    );
    expect(searchCommands(actions, "svprj")[0].label).toBe("Save project");
    expect(searchCommands(actions, "  PROJECT save  ")[0].label).toBe(
      "Save project",
    );
    expect(searchCommands(actions, "xyzxyz")).toEqual([]);
  });
  it("keeps unavailable actions discoverable and does not execute during search", () => {
    let calls = 0;
    const disabled = {
      id: "undo",
      label: "Undo",
      keys: [],
      enabled: () => false,
      run() {
        calls++;
      },
    };
    expect(searchCommands([disabled], "undo")).toEqual([disabled]);
    expect(calls).toBe(0);
    expect(searchCommands(actions, "")).toEqual(actions);
  });
});
