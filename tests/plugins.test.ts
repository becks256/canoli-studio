import { describe, expect, it } from "vitest";
import { PluginRegistry, examplePlugin, parsePlugin } from "../src/plugins";
import type { PluginStorage } from "../src/plugins";

const memoryStorage = (): PluginStorage => {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};
describe("plugin packages and persistence", () => {
  it("validates packages, reloads them, updates atomically and exports/removes", () => {
    const storage = memoryStorage(),
      registry = new PluginRegistry(storage);
    registry.install(examplePlugin);
    expect(new PluginRegistry(storage).get(examplePlugin.id)).toEqual(
      examplePlugin,
    );
    registry.install({ ...examplePlugin, version: "1.1.0" });
    expect(registry.getSnapshot().plugins).toHaveLength(1);
    expect(parsePlugin(registry.export(examplePlugin.id)).version).toBe(
      "1.1.0",
    );
    expect(() => registry.install({ ...examplePlugin, apiVersion: 2 })).toThrow(
      /Invalid plugin/,
    );
    expect(registry.get(examplePlugin.id)?.version).toBe("1.1.0");
    expect(() =>
      registry.get(examplePlugin.id)!.commands.push(examplePlugin.commands[0]),
    ).toThrow();
    registry.remove(examplePlugin.id);
    expect(new PluginRegistry(storage).getSnapshot().plugins).toHaveLength(0);
  });
  it("rejects unsupported permissions, duplicate commands, invalid IDs and code budgets", () => {
    for (const patch of [
      { permissions: ["network"] },
      { permissions: ["document:write"] },
      { id: "../escape" },
      { commands: [examplePlugin.commands[0], examplePlugin.commands[0]] },
      {
        commands: [
          { ...examplePlugin.commands[0], source: "x".repeat(50_001) },
        ],
      },
      { remoteUrl: "https://example.com/plugin.js" },
    ])
      expect(() => parsePlugin({ ...examplePlugin, ...patch })).toThrow();
    expect(() => parsePlugin("{broken")).toThrow(/valid JSON/);
  });
  it("leaves memory intact on storage failure and reports unavailable/corrupt storage", () => {
    const registry = new PluginRegistry({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => registry.install(examplePlugin)).toThrow(
      /No installation changes/,
    );
    expect(registry.getSnapshot().plugins).toHaveLength(0);
    expect(new PluginRegistry(null).getSnapshot().storageMessage).toContain(
      "tab only",
    );
    expect(
      new PluginRegistry({
        getItem: () => "bad",
        setItem: () => {},
      }).getSnapshot().storageMessage,
    ).toContain("could not be read");
  });
});
