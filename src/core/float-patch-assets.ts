import type { DocumentData, LayerData } from "./model";
import { patchAdjustmentSchema, type PatchAdjustmentData } from "./adjustments";
import type { WetAssetProvider, WetImageSource } from "./wet-assets";
import {
  captureFloatCloneAssets,
  type CapturedFloatCloneAssets,
} from "./float-clone-assets";
import type { FloatWetTileControl } from "./float-wet-tile";

export function* floatPatchLayerOperations(
  layer: LayerData,
): Generator<PatchAdjustmentData> {
  if (
    layer.kind === "adjustment" &&
    layer.adjustment.kind === "patch" &&
    layer.adjustment.precision === "float32"
  )
    yield layer.adjustment;
  if (layer.kind === "group")
    for (const child of layer.children) yield* floatPatchLayerOperations(child);
}
export function* floatPatchDocumentOperations(
  document: DocumentData,
  seen = new Set<DocumentData>(),
): Generator<PatchAdjustmentData> {
  if (seen.has(document)) return;
  seen.add(document);
  for (const layer of document.children)
    yield* floatPatchLayerOperations(layer);
  for (const definition of document.components ?? [])
    if (definition.source.kind === "document")
      yield* floatPatchDocumentOperations(definition.source.document, seen);
}
/** Pin all original interpretations before validation awaits. Logical patch
 * dimensions may resize independently of the retained original sample grid. */
export async function captureFloatPatchAssets(
  input: readonly PatchAdjustmentData[],
  provider: Pick<WetAssetProvider, "get" | "check">,
  control: FloatWetTileControl = {},
): Promise<CapturedFloatCloneAssets> {
  const pins = new Map<string, Readonly<WetImageSource>>(),
    signal = control.signal;
  let host: typeof provider | undefined = provider,
    external = control.check,
    closed = false,
    inner: CapturedFloatCloneAssets | undefined;
  const alive = () => {
    signal?.throwIfAborted();
    if (closed) throw new Error("Float patch capture is disposed.");
  };
  const check = () => {
    alive();
    host!.check?.();
    alive();
    external?.();
    alive();
    for (const [id, pin] of pins) {
      const current = host!.get(id, "float32");
      alive();
      if (
        current.blob !== pin.blob ||
        current.width !== pin.width ||
        current.height !== pin.height ||
        current.identity !== pin.identity ||
        current.pixels !== pin.pixels
      )
        throw new Error("A prepared native patch source changed.");
    }
    alive();
  };
  const dispose = () => {
    if (closed) return;
    closed = true;
    inner?.dispose();
    inner = undefined;
    pins.clear();
    host = undefined;
    external = undefined;
  };
  try {
    check();
    const metadata = input.map((patch) => patchAdjustmentSchema.parse(patch)),
      tiles = metadata.map((patch) => {
        if (patch.precision !== "float32")
          throw new Error("Native patches require explicit float32 precision.");
        let source = pins.get(patch.assetId);
        if (!source) {
          source = Object.freeze({ ...host!.get(patch.assetId, "float32") });
          pins.set(patch.assetId, source);
        }
        return {
          assetId: patch.assetId,
          x: 0,
          y: 0,
          width: source.width,
          height: source.height,
        };
      });
    check();
    inner = await captureFloatCloneAssets(
      tiles,
      {
        get: (id) => {
          check();
          const source = pins.get(id);
          if (!source) throw new Error("Unknown prepared patch source.");
          return source;
        },
        check,
      },
      { check },
    );
    check();
    return Object.freeze({
      get tiles() {
        check();
        return inner!.tiles;
      },
      check: () => {
        check();
        inner!.check();
      },
      dispose,
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
export async function validateFloatPatchAssets(
  document: DocumentData,
  provider: Pick<WetAssetProvider, "get" | "check">,
): Promise<void> {
  const patches = [...floatPatchDocumentOperations(document)];
  if (!patches.length) return;
  const capture = await captureFloatPatchAssets(patches, provider);
  capture.dispose();
}
