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
    expect(() =>
      registry.install({ ...examplePlugin, apiVersion: 3 as any }),
    ).toThrow(/Invalid plugin/);
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

  it("supports apiVersion 2 with fine-grained permissions and rejects v1 with extended permissions", () => {
    const storage = memoryStorage();
    const registry = new PluginRegistry(storage);

    // apiVersion 1 rejects extended permissions (such as jobs:run or assets:read)
    expect(() =>
      parsePlugin({
        ...examplePlugin,
        apiVersion: 1,
        permissions: ["document:read", "jobs:run"],
      }),
    ).toThrow(/not supported in apiVersion 1/);

    // apiVersion 2 supports extended permissions
    const v2Plugin = parsePlugin({
      format: "luma-plugin",
      apiVersion: 2,
      id: "ai.generator",
      name: "AI Generator",
      version: "1.0.0",
      description: "Generates artwork via host jobs.",
      permissions: [
        "document:read",
        "document:write",
        "jobs:run",
        "assets:read",
      ],
      commands: [
        {
          id: "gen",
          title: "Generate Image",
          description: "Run generation",
          source:
            "const t = await host.jobs.submit({ prompt: 'sky' }); print(t.id);",
        },
      ],
    });

    registry.install(v2Plugin);
    const installed = registry.get("ai.generator");
    expect(installed).toBeDefined();
    expect(installed?.apiVersion).toBe(2);
    expect(installed?.permissions).toEqual([
      "document:read",
      "document:write",
      "jobs:run",
      "assets:read",
    ]);

    // Initial granted permissions match declared permissions
    expect(registry.getGrantedPermissions("ai.generator")).toEqual([
      "document:read",
      "document:write",
      "jobs:run",
      "assets:read",
    ]);
    expect(registry.isPermissionGranted("ai.generator", "jobs:run")).toBe(true);

    // User dynamically revokes jobs:run
    registry.revokePermission("ai.generator", "jobs:run");
    expect(registry.isPermissionGranted("ai.generator", "jobs:run")).toBe(
      false,
    );
    expect(registry.getGrantedPermissions("ai.generator")).toEqual([
      "document:read",
      "document:write",
      "assets:read",
    ]);

    // Snapshot reflects revoked permission
    const snapshot = registry.getSnapshot();
    expect(snapshot.grantedPermissions["ai.generator"]).toEqual([
      "document:read",
      "document:write",
      "assets:read",
    ]);

    // Revoking required document:read is rejected
    expect(() =>
      registry.revokePermission("ai.generator", "document:read"),
    ).toThrow(/Cannot revoke required permission/);

    // Granting an undeclared permission is rejected
    expect(() =>
      registry.grantPermission("ai.generator", "assets:write"),
    ).toThrow(/was not declared in the plugin manifest/);

    // Re-granting jobs:run restores the permission
    registry.grantPermission("ai.generator", "jobs:run");
    expect(registry.isPermissionGranted("ai.generator", "jobs:run")).toBe(true);

    // Revocations persist across registry reloads
    registry.revokePermission("ai.generator", "document:write");
    const reloaded = new PluginRegistry(storage);
    expect(reloaded.isPermissionGranted("ai.generator", "document:write")).toBe(
      false,
    );
    expect(reloaded.isPermissionGranted("ai.generator", "jobs:run")).toBe(true);
  });
});
