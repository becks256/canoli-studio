import { z } from "zod";

import {colorSettingsRecordSchema} from '../core/color/color-settings-record';
export const WORKSPACE_VERSION=3 as const;
const rgbSpace = z.enum(["srgb", "display-p3", "adobe-rgb", "linear-srgb"]);
const channel = z.number().finite().min(0).max(255);
const proofSchema = z.object({
  proofSpace: rgbSpace,
  intent: z.enum([
    "perceptual",
    "relative-colorimetric",
    "absolute-colorimetric",
    "saturation",
    "unclipped",
  ]),
  gamutWarning: z.boolean(),
  warningColor: z.tuple([channel, channel, channel, channel]).optional(),
});
export const workspaceSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    savedAt: z.number().finite(),
    activeIndex: z.number().int().nonnegative(),
    documents: z
      .array(
        z.object({
          name: z.string().min(1).max(240).optional(),
          project: z.instanceof(Blob),
          componentEdit: z
            .object({
              ownerIndex: z.number().int().nonnegative(),
              componentId: z.string().min(1).max(240),
              sourceUnchanged: z.boolean(),
              contentsApplied: z.boolean(),
            })
            .strict()
            .optional(),
          selectedIds: z.array(z.string()),
          colorSettings:colorSettingsRecordSchema.optional(),
          colorProfile: rgbSpace.default("srgb"),
          softProof: proofSchema.nullable().default(null),
          view: z.object({
            zoom: z.number().finite().positive(),
            pan: z.object({ x: z.number().finite(), y: z.number().finite() }),
            initialized: z.boolean(),
          }),
        }),
      )
      .min(1),
  })
  .refine(
    (value) => value.activeIndex < value.documents.length,
    "Invalid active workspace tab",
  )
  .superRefine((workspace, context) => {
    const links = new Set<string>();
    for (let index = 0; index < workspace.documents.length; index++) {
      const entry=workspace.documents[index];
      if((workspace.version===3)!==!!entry.colorSettings)context.addIssue({code:'custom',path:['documents',index,'colorSettings'],message:'Complete color settings are required for workspace version 3 only.'});
      const link = entry.componentEdit;
      if (!link) continue;
      const issue = (message: string) =>
        context.addIssue({
          code: "custom",
          path: ["documents", index, "componentEdit"],
          message,
        });
      if (workspace.version < 2)
        issue("Component editing links require workspace version 2 or later.");
      if (
        link.ownerIndex >= workspace.documents.length ||
        link.ownerIndex === index
      )
        issue("Invalid component editing owner.");
      const key = JSON.stringify([link.ownerIndex, link.componentId]);
      if (links.has(key)) issue("Duplicate component editing session.");
      links.add(key);
      const visited = new Set<number>([index]);
      let current: number | undefined = link.ownerIndex;
      while (current !== undefined && workspace.documents[current]) {
        if (visited.has(current)) {
          issue("Cyclic component editing links.");
          break;
        }
        visited.add(current);
        current = workspace.documents[current].componentEdit?.ownerIndex;
      }
    }
  });
export type SavedWorkspace = z.infer<typeof workspaceSchema>;
export interface AutomaticWorkspaceEntry {
  id: string;
  savedAt: number | null;
  names: string[];
  error?: string;
}

/** One explicit local workspace checkpoint, atomically published only after all projects encode. */
export class WorkspaceRepository {
  get restoreOnStartup(): boolean {
    try {
      return localStorage.getItem("luma-workspace-startup") === "restore";
    } catch {
      return false;
    }
  }
  set restoreOnStartup(enabled: boolean) {
    if (enabled) localStorage.setItem("luma-workspace-startup", "restore");
    else localStorage.removeItem("luma-workspace-startup");
  }

  private async database(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined")
      throw new Error("Workspace storage is unavailable.");
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("luma-workspaces", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("workspaces");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async createVersion(
    name: string,
    workspace: SavedWorkspace,
  ): Promise<string> {
    const label = z.string().trim().min(1).max(120).parse(name);
    const value = workspaceSchema.parse(workspace);
    const id = `version:${crypto.randomUUID()}`;
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("workspaces", "readwrite");
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(tx.error ?? new Error("Version save failed."));
        tx.objectStore("workspaces").add({ name: label, workspace: value }, id);
      });
      return id;
    } finally {
      db.close();
    }
  }
  async removeVersion(id: string): Promise<void> {
    if (!/^version:[0-9a-f-]{36}$/i.test(id))
      throw new Error("Invalid named workspace version ID.");
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("workspaces", "readwrite");
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(tx.error ?? new Error("Version removal failed."));
        tx.objectStore("workspaces").delete(id);
      });
    } finally {
      db.close();
    }
  }
  async listVersions(): Promise<
    { id: string; name: string; savedAt: number }[]
  > {
    const db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const versions: { id: string; name: string; savedAt: number }[] = [];
        const tx = db.transaction("workspaces", "readonly");
        const request = tx.objectStore("workspaces").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (String(cursor.key).startsWith("version:"))
            versions.push({
              id: String(cursor.key),
              name: String(cursor.value.name),
              savedAt: cursor.value.workspace.savedAt,
            });
          cursor.continue();
        };
        tx.oncomplete = () =>
          resolve(versions.sort((a, b) => b.savedAt - a.savedAt));
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  async save(workspace: SavedWorkspace): Promise<void> {
    return this.write("current", workspace);
  }
  async saveAutomatic(id: string, workspace: SavedWorkspace): Promise<void> {
    return this.write(this.automaticKey(id), workspace);
  }
  async loadAutomatic(id: string): Promise<SavedWorkspace | null> {
    return this.read(this.automaticKey(id), false);
  }
  async listAutomatic(): Promise<AutomaticWorkspaceEntry[]> {
    const db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const entries: AutomaticWorkspaceEntry[] = [];
        const tx = db.transaction("workspaces", "readonly");
        const request = tx
          .objectStore("workspaces")
          .openCursor(IDBKeyRange.bound("automatic:", "automatic:\uffff"));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const id = String(cursor.key).slice("automatic:".length);
          if (/^[0-9a-f-]{36}$/i.test(id)) {
            const parsed = workspaceSchema.safeParse(cursor.value);
            entries.push(
              parsed.success
                ? {
                    id,
                    savedAt: parsed.data.savedAt,
                    names: parsed.data.documents.map(
                      (document, index) =>
                        document.name ?? `Document ${index + 1}`,
                    ),
                  }
                : {
                    id,
                    savedAt: null,
                    names: ["Unreadable checkpoint"],
                    error:
                      "Checkpoint metadata is damaged. This entry can be removed.",
                  },
            );
          }
          cursor.continue();
        };
        tx.oncomplete = () =>
          resolve(entries.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0)));
        tx.onerror = tx.onabort = () =>
          reject(tx.error ?? new Error("Could not read automatic workspaces."));
      });
    } finally {
      db.close();
    }
  }
  async removeAutomatic(id: string): Promise<void> {
    const key = this.automaticKey(id);
    if (!navigator.locks)
      throw new Error("Safe workspace removal requires browser Web Locks.");
    await navigator.locks.request(
      `luma-workspace:${id}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          throw new Error(
            "This workspace is active in a browser tab. Close that tab before removing its checkpoint.",
          );
        const db = await this.database();
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("workspaces", "readwrite");
            tx.oncomplete = () => resolve();
            tx.onerror = tx.onabort = () =>
              reject(tx.error ?? new Error("Workspace removal failed."));
            tx.objectStore("workspaces").delete(key);
          });
        } finally {
          db.close();
        }
      },
    );
  }
  private automaticKey(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new Error("Invalid automatic workspace identity.");
    return `automatic:${id}`;
  }
  private async write(key: string, workspace: SavedWorkspace): Promise<void> {
    const value = workspaceSchema.parse(workspace);
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("workspaces", "readwrite");
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(tx.error ?? new Error("Workspace save failed."));
        tx.objectStore("workspaces").put(value, key);
      });
    } finally {
      db.close();
    }
  }
  async load(versionId?: string): Promise<SavedWorkspace | null> {
    return this.read(versionId ?? "current", !!versionId);
  }
  private async read(
    key: string,
    named: boolean,
  ): Promise<SavedWorkspace | null> {
    const db = await this.database();
    try {
      const value = await new Promise<unknown>((resolve, reject) => {
        const request = db
          .transaction("workspaces", "readonly")
          .objectStore("workspaces")
          .get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return value === undefined
        ? null
        : workspaceSchema.parse(
            named ? (value as { workspace: unknown }).workspace : value,
          );
    } finally {
      db.close();
    }
  }
}
