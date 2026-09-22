import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9.-]*$/);
const manifestSchema = z
  .object({
    format: z.literal("luma-plugin"),
    apiVersion: z.literal(1),
    id: identifier,
    name: z.string().trim().min(1).max(80),
    version: z
      .string()
      .max(40)
      .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
    description: z.string().max(500).default(""),
    author: z.string().max(100).optional(),
    permissions: z
      .array(z.enum(["document:read", "document:write"]))
      .min(1)
      .max(2)
      .refine(
        (values) =>
          values.includes("document:read") &&
          new Set(values).size === values.length,
        "Document read permission is required; permissions must be unique.",
      ),
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
  .strict();
export type PluginManifest = z.infer<typeof manifestSchema>;
export interface PluginStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const PLUGIN_STORAGE_KEY = "luma.plugins.v1";
const MAX_PACKAGE_BYTES = 250_000;

export function parsePlugin(value: unknown): PluginManifest {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text || new TextEncoder().encode(text).length > MAX_PACKAGE_BYTES)
    throw new Error("Plugin packages must be at most 250 KB.");
  try {
    return manifestSchema.parse(JSON.parse(text));
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

/** Installation stores inert data. Only an explicit run reaches the script sandbox. */
export class PluginRegistry {
  private listeners = new Set<() => void>();
  private snapshot: {
    plugins: readonly PluginManifest[];
    storageMessage: string | null;
  };
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
    } catch {
      plugins = [];
      storageMessage =
        "Saved plugins could not be read. Import their packages again to restore them.";
    }
    this.snapshot = freeze({ plugins, storageMessage });
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
  private commit(plugins: PluginManifest[]) {
    try {
      this.storage?.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(plugins));
    } catch {
      throw new Error(
        "Could not save plugins in browser storage. Free some storage or remove an unused plugin and try again. No installation changes were made.",
      );
    }
    this.snapshot = freeze({
      plugins,
      storageMessage: this.storage ? null : this.snapshot.storageMessage,
    });
    this.listeners.forEach((listener) => listener());
  }
  install(value: unknown): PluginManifest {
    const plugin = parsePlugin(value),
      plugins = this.snapshot.plugins.filter((p) => p.id !== plugin.id);
    if (plugins.length >= 32)
      throw new Error(
        "Remove a plugin before installing another (32 installed plugins maximum).",
      );
    this.commit([...plugins, plugin]);
    return this.get(plugin.id)!;
  }
  remove(id: string) {
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
  author: "Luma example",
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
