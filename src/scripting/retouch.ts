import { prepareSmartRaster } from "../engine/smart-raster";
import { AssetStore } from "../core/assets";
import { execute } from "../core/commands";
import {
  createAdjustmentLayer,
  findLayer,
  isLocked,
  id,
  referencedAssets,
  type DocumentData,
} from "../core/model";
import { parseCommands } from "../core/validation";
import { patchRegionRequestSchema } from "../core/retouch/patch-region";
import { healSpotRequestSchema } from "../core/retouch/heal-spot";
import { BrushStroke } from "../dom/values";
import type { BrushStrokeData } from "../core/drawing";
import { prepareHealingStroke } from "../engine/healing";
import { prepareRetouchPatch } from "../engine/patch";
import { PixelProcessor } from "../engine/processor";
import { createCanvas, release } from "../engine/canvas";
import type { DocumentRenderer } from "../engine/renderer";

/** Per-script private assets. Source bitmaps are borrowed; prepared bitmaps are owned. */
export class ScriptRetouch {
  private readonly view = new AssetStore();
  private readonly owned = new Set<string>();
  private readonly abort = new AbortController();
  private busy = false;
  constructor(
    private readonly snapshot: DocumentData,
    private readonly renderer: DocumentRenderer,
    assets: AssetStore,
    private readonly check: () => void,
  ) {
    for (const asset of assets.values()) this.view.install(asset, false);
  }
  async prepare(
    commands: unknown,
    request: unknown,
    method: "patch" | "heal" | "rasterize" = "patch",
  ) {
    this.assertActive();
    if (this.busy)
      throw new Error("Await each repair operation before starting another.");
    if (this.owned.size >= 32)
      throw new Error("A script can prepare at most 32 repairs.");
    const parsed =
      method === "patch" ? patchRegionRequestSchema.parse(request) : undefined;
    const heal =
      method === "heal" ? healSpotRequestSchema.parse(request) : undefined;
    const document = execute(this.snapshot, {
      type: "transaction",
      label: "Prepare script repair",
      commands: parseCommands(commands),
    });
    for (const assetId of referencedAssets(document)) this.view.get(assetId);
    if (
      heal &&
      (!findLayer(document, heal.layerId) || isLocked(document, heal.layerId))
    )
      throw new Error("Healing requires an attached unlocked layer.");
    this.busy = true;
    if (method === "rasterize") {
      let installed: string | undefined;
      try {
        const layerId = (request as { layerId?: unknown })?.layerId;
        if (typeof layerId !== "string")
          throw new Error("Rasterization requires a layer ID.");
        const prepared = await prepareSmartRaster(
          document,
          layerId,
          this.view,
          this.renderer,
          () => this.assertActive(),
        );
        const asset = await this.view.add(
          prepared.blob,
          prepared.layer.name,
          prepared.layer.assetId,
          false,
        );
        installed = asset.id;
        this.assertActive();
        this.owned.add(asset.id);
        return prepared.layer;
      } catch (error) {
        if (installed) this.view.remove(installed);
        throw error;
      } finally {
        this.busy = false;
      }
    }
    const worker = new PixelProcessor(),
      signal = this.abort.signal;
    const cancel = () => worker.dispose();
    signal.addEventListener("abort", cancel, { once: true });
    let assetId: string | undefined;
    try {
      const patch = heal
        ? await (() => {
            const {
              sampling = "current-layer",
              searchRadius = 64,
              hardness = 0.7,
              opacity = 1,
              flow = 1,
              clipSelection = true,
              ...options
            } = heal.options;
            const brush = new BrushStroke({
              points: [heal.center],
              size: heal.radius * 2,
              hardness,
              opacity,
              flow,
              clip: clipSelection ? heal.selection : null,
              pressureSize: false,
              pressureOpacity: false,
            });
            return prepareHealingStroke(
              document,
              this.view,
              this.renderer,
              worker,
              brush.toJSON() as BrushStrokeData,
              { mode: sampling, layerId: heal.layerId },
              options,
              searchRadius,
              signal,
            );
          })()
        : await (() => {
            const {
              sampling = "all-layers",
              layerId,
              ...options
            } = parsed!.options;
            return prepareRetouchPatch(
              document,
              this.view,
              this.renderer,
              worker,
              parsed!.selection,
              parsed!.offset,
              { mode: sampling, layerId },
              options,
              signal,
            );
          })();
      this.assertActive();
      const surface = createCanvas(
        patch.bounds.width,
        patch.bounds.height,
        true,
      );
      let blob: Blob;
      try {
        const context = surface.getContext("2d")!,
          pixels = context.createImageData(surface.width, surface.height);
        pixels.data.set(patch.correctedPixels);
        for (let p = 0; p < patch.coverage.length; p++)
          pixels.data[p * 4 + 3] = patch.coverage[p];
        context.putImageData(pixels, 0, 0);
        blob = await new Promise<Blob>((resolve, reject) =>
          surface.toBlob(
            (value) =>
              value
                ? resolve(value)
                : reject(new Error("Could not encode patch.")),
            "image/png",
          ),
        );
      } finally {
        release(surface);
      }
      this.assertActive();
      const asset = await this.view.add(
        blob,
        heal ? "Script healing" : "Script patch",
        id(),
        false,
      );
      assetId = asset.id;
      this.assertActive();
      this.owned.add(asset.id);
      return {
        ...createAdjustmentLayer(heal ? "Healing spot" : "Retouch patch", {
          kind: "patch",
          assetId: asset.id,
          width: patch.bounds.width,
          height: patch.bounds.height,
        }),
        x: patch.bounds.x,
        y: patch.bounds.y,
      };
    } catch (error) {
      if (assetId) this.view.remove(assetId);
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
      worker.dispose();
      this.busy = false;
    }
  }
  private assertActive() {
    this.abort.signal.throwIfAborted();
    this.check();
  }
  installReferenced(document: DocumentData, destination: AssetStore): string[] {
    this.assertActive();
    const installed: string[] = [];
    try {
      for (const assetId of referencedAssets(document)) {
        if (this.owned.has(assetId)) {
          destination.install(this.view.get(assetId), false);
          installed.push(assetId);
        } else destination.get(assetId);
      }
      for (const assetId of installed) this.owned.delete(assetId);
      return installed;
    } catch (error) {
      for (const assetId of installed) {
        destination.remove(assetId);
        this.owned.delete(assetId);
      }
      throw error;
    }
  }
  dispose() {
    this.abort.abort(new Error("Script retouch stopped."));
    for (const assetId of this.owned) this.view.remove(assetId);
    this.owned.clear();
    this.view.metadata.dispose();
  }
}
