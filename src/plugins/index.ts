import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9.-]*$/);

export const V1_PERMISSIONS = ["document:read", "document:write"] as const;
export const V2_PERMISSIONS = [
  "document:read",
  "document:write",
  "jobs:run",
  "ai:generate",
  "assets:read",
  "assets:write",
  "assets:analyze",
] as const;

export type PluginPermission = (typeof V2_PERMISSIONS)[number];

const manifestSchema = z
  .object({
    format: z.literal("luma-plugin"),
    apiVersion: z.union([z.literal(1), z.literal(2)]),
    id: identifier,
    name: z.string().trim().min(1).max(80),
    version: z
      .string()
      .max(40)
      .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
    description: z.string().max(500).default(""),
    author: z.string().max(100).optional(),
    permissions: z.array(z.string()).min(1).max(V2_PERMISSIONS.length),
    commands: z
      .array(
        z
          .object({
            id: identifier,
            title: z.string().trim().min(1).max(80),
            description: z.string().max(300).default(""),
            source: z.string().min(1).max(50_000),
          })
          .strict(),
      )
      .min(1)
      .max(16)
      .refine(
        (commands) =>
          new Set(commands.map((c) => c.id)).size === commands.length,
        "Command IDs must be unique.",
      ),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (new Set(data.permissions).size !== data.permissions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Permissions must be unique.",
        path: ["permissions"],
      });
      return;
    }
    if (!data.permissions.includes("document:read")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Document read permission is required.",
        path: ["permissions"],
      });
      return;
    }
    if (data.apiVersion === 1) {
      for (const p of data.permissions) {
        if (!V1_PERMISSIONS.includes(p as (typeof V1_PERMISSIONS)[number])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Permission '${p}' is not supported in apiVersion 1. Upgrade to apiVersion 2 to request this permission.`,
            path: ["permissions"],
          });
        }
      }
    } else if (data.apiVersion === 2) {
      for (const p of data.permissions) {
        if (!V2_PERMISSIONS.includes(p as PluginPermission)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown permission: '${p}'.`,
            path: ["permissions"],
          });
        }
      }
    }
  });

export type PluginManifest = z.infer<typeof manifestSchema> & {
  permissions: PluginPermission[];
};

export interface PluginStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PLUGIN_STORAGE_KEY = "luma.plugins.v1";
export const PLUGIN_PERMISSIONS_STORAGE_KEY = "luma.plugins.permissions.v1";
const MAX_PACKAGE_BYTES = 250_000;

export function parsePlugin(value: unknown): PluginManifest {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text || new TextEncoder().encode(text).length > MAX_PACKAGE_BYTES)
    throw new Error("Plugin packages must be at most 250 KB.");
  try {
    return manifestSchema.parse(JSON.parse(text)) as PluginManifest;
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new Error(
        `Invalid plugin package: ${error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    throw new Error("Plugin package must contain valid JSON.");
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export interface PluginSnapshot {
  plugins: readonly PluginManifest[];
  grantedPermissions: Readonly<Record<string, readonly PluginPermission[]>>;
  storageMessage: string | null;
}

/** Installation stores inert data. Only an explicit run reaches the script sandbox. */
export class PluginRegistry {
  private listeners = new Set<() => void>();
  private grantedMap = new Map<string, Set<PluginPermission>>();
  private snapshot: PluginSnapshot;

  constructor(private readonly storage: PluginStorage | null) {
    let plugins: PluginManifest[] = [],
      storageMessage: string | null = storage
        ? null
        : "Browser storage is unavailable. Plugins installed here last for this tab only.";
    try {
      const saved = storage?.getItem(PLUGIN_STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed) || parsed.length > 32)
          throw new Error("Invalid registry.");
        plugins = parsed.map(parsePlugin);
        if (new Set(plugins.map((p) => p.id)).size !== plugins.length)
          throw new Error("Duplicate plugin IDs.");
      }
      const savedPerms = storage?.getItem(PLUGIN_PERMISSIONS_STORAGE_KEY);
      if (savedPerms) {
        const parsedPerms = JSON.parse(savedPerms);
        if (parsedPerms && typeof parsedPerms === "object") {
          for (const [pluginId, perms] of Object.entries(parsedPerms)) {
            if (Array.isArray(perms)) {
              this.grantedMap.set(
                pluginId,
                new Set(
                  perms.filter((p): p is PluginPermission =>
                    V2_PERMISSIONS.includes(p),
                  ),
                ),
              );
            }
          }
        }
      }
    } catch {
      plugins = [];
      this.grantedMap.clear();
      storageMessage =
        "Saved plugins could not be read. Import their packages again to restore them.";
    }

    // Initialize default granted permissions for plugins missing in permissions store
    for (const plugin of plugins) {
      if (!this.grantedMap.has(plugin.id)) {
        this.grantedMap.set(plugin.id, new Set(plugin.permissions));
      }
    }

    this.snapshot = this.computeSnapshot(plugins, storageMessage);
  }

  private computeSnapshot(
    plugins: readonly PluginManifest[],
    storageMessage: string | null,
  ): PluginSnapshot {
    const granted: Record<string, readonly PluginPermission[]> = {};
    for (const plugin of plugins) {
      const perms = this.grantedMap.get(plugin.id);
      granted[plugin.id] = perms
        ? Object.freeze(
            [...perms].filter((p) => plugin.permissions.includes(p)),
          )
        : Object.freeze([...plugin.permissions]);
    }
    return freeze({
      plugins,
      grantedPermissions: Object.freeze(granted),
      storageMessage,
    });
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get(id: string): PluginManifest | null {
    return this.snapshot.plugins.find((p) => p.id === id) ?? null;
  }

  getGrantedPermissions(id: string): readonly PluginPermission[] {
    const plugin = this.get(id);
    if (!plugin) return [];
    const granted = this.grantedMap.get(id);
    if (!granted) return plugin.permissions;
    return (plugin.permissions as PluginPermission[]).filter((p) =>
      granted.has(p),
    );
  }

  isPermissionGranted(id: string, permission: PluginPermission): boolean {
    return this.getGrantedPermissions(id).includes(permission);
  }

  grantPermission(id: string, permission: PluginPermission): void {
    const plugin = this.get(id);
    if (!plugin) throw new Error("Plugin is not installed.");
    if (!plugin.permissions.includes(permission)) {
      throw new Error(
        `Permission '${permission}' was not declared in the plugin manifest.`,
      );
    }
    const current = this.grantedMap.get(id) ?? new Set(plugin.permissions);
    current.add(permission);
    this.grantedMap.set(id, current);
    this.commitPermissions();
    this.commit(this.snapshot.plugins as PluginManifest[]);
  }

  revokePermission(id: string, permission: PluginPermission): void {
    const plugin = this.get(id);
    if (!plugin) throw new Error("Plugin is not installed.");
    if (permission === "document:read") {
      throw new Error(
        "Cannot revoke required permission 'document:read'. Remove the plugin instead.",
      );
    }
    const current = this.grantedMap.get(id) ?? new Set(plugin.permissions);
    current.delete(permission);
    this.grantedMap.set(id, current);
    this.commitPermissions();
    this.commit(this.snapshot.plugins as PluginManifest[]);
  }

  setGrantedPermissions(
    id: string,
    permissions: readonly PluginPermission[],
  ): void {
    const plugin = this.get(id);
    if (!plugin) throw new Error("Plugin is not installed.");
    if (!permissions.includes("document:read")) {
      throw new Error(
        "Permission 'document:read' is required and cannot be omitted.",
      );
    }
    for (const p of permissions) {
      if (!plugin.permissions.includes(p)) {
        throw new Error(
          `Permission '${p}' was not declared in plugin manifest.`,
        );
      }
    }
    this.grantedMap.set(id, new Set(permissions));
    this.commitPermissions();
    this.commit(this.snapshot.plugins as PluginManifest[]);
  }

  private commitPermissions() {
    try {
      const serializable: Record<string, string[]> = {};
      for (const [id, set] of this.grantedMap.entries()) {
        serializable[id] = [...set];
      }
      this.storage?.setItem(
        PLUGIN_PERMISSIONS_STORAGE_KEY,
        JSON.stringify(serializable),
      );
    } catch {
      // Storage quota or error; memory retains current settings
    }
  }

  private commit(plugins: PluginManifest[]) {
    try {
      this.storage?.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(plugins));
    } catch {
      throw new Error(
        "Could not save plugins in browser storage. Free some storage or remove an unused plugin and try again. No installation changes were made.",
      );
    }
    this.snapshot = this.computeSnapshot(
      plugins,
      this.storage ? null : this.snapshot.storageMessage,
    );
    this.listeners.forEach((listener) => listener());
  }

  install(value: unknown): PluginManifest {
    const plugin = parsePlugin(value),
      plugins = this.snapshot.plugins.filter((p) => p.id !== plugin.id);
    if (plugins.length >= 32)
      throw new Error(
        "Remove a plugin before installing another (32 installed plugins maximum).",
      );

    // If previously installed, retain revocations for declared permissions; grant newly added declared permissions
    const existing = this.grantedMap.get(plugin.id);
    const updatedGranted = new Set<PluginPermission>();
    for (const perm of plugin.permissions) {
      if (!existing || existing.has(perm)) {
        updatedGranted.add(perm);
      }
    }
    this.grantedMap.set(plugin.id, updatedGranted);
    this.commitPermissions();

    this.commit([...plugins, plugin]);
    return this.get(plugin.id)!;
  }

  remove(id: string) {
    this.grantedMap.delete(id);
    this.commitPermissions();
    this.commit(this.snapshot.plugins.filter((p) => p.id !== id));
  }

  export(id: string) {
    const plugin = this.get(id);
    if (!plugin) throw new Error("Plugin is not installed.");
    return JSON.stringify(plugin, null, 2);
  }
}

export function browserPluginStorage(): PluginStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const examplePlugin: PluginManifest = {
  format: "luma-plugin",
  apiVersion: 1,
  id: "studio.utilities",
  name: "Studio utilities",
  version: "1.0.0",
  description:
    "A small example extension: inspect a composition or add an editable guide frame.",
  author: "Canoli Studio example",
  permissions: ["document:read", "document:write"],
  commands: [
    {
      id: "inspect",
      title: "Inspect composition",
      description: "Print dimensions and the top-level layer count.",
      source:
        'print(document.name, document.width + " × " + document.height, document.layers.length + " root layers");',
    },
    {
      id: "frame",
      title: "Add guide frame",
      description: "Add a vector frame inset from the document edges.",
      source: `const inset = Math.min(document.width, document.height) * 0.08;
const frame = document.layers.add(new VectorLayer({ name: "Guide frame" }));
frame.paths.add(new VectorPath({
  points: [{ x: inset, y: inset }, { x: document.width - inset, y: inset },
           { x: document.width - inset, y: document.height - inset }, { x: inset, y: document.height - inset }],
  closed: true, fill: null, stroke: "#d5e79b", strokeWidth: 2
}));
document.selectedLayer = frame;
print("Added an editable guide frame.");`,
    },
  ],
};
