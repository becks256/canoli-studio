import { validateHdrWetField } from "../core/hdr-wet-field";
import {
  validateFloatWetTilePair,
  readFloatWetTileWindow,
  type FloatWetTileControl,
} from "../core/float-wet-tile";
import { captureHdrWetAssets } from "../core/hdr-wet-assets";
import type { WetAssetProvider } from "../core/wet-assets";
import type { WetPaintTileData } from "../core/wet-operation";
import { captureFieldBounds } from "../core/projective-field";
import {
  validateWindow,
  type FloatSourceWindow,
} from "../core/float-source/types";
import type { HdrWetFieldSource } from "./projective-field";

/** Private immutable asset pair; not a public WetPaintStroke tile value. Both
 * TIFFs retain native straight Float32 samples; only coverage alpha is used. */
export interface HdrWetTile {
  region: FloatSourceWindow;
  pixels: Blob;
  coverage: Blob;
}
export interface CapturedHdrWetField extends HdrWetFieldSource {
  check(): void;
  dispose(): void;
}

/** Validate complete original pairs before exposing a coupled finite field.
 * Ordered overlaps remove prior color by coverage and add already covered
 * pigment once. Color never passes through a display bitmap or byte mask. */
export async function captureHdrWetField(
  input: readonly HdrWetTile[],
  control: FloatWetTileControl = {},
): Promise<CapturedHdrWetField> {
  const signal = control.signal,
    external = control.check,
    tiles = input.map((tile) => ({
      region: captureFieldBounds(tile.region),
      pixels: tile.pixels,
      coverage: tile.coverage,
    }));
  let closed = false;
  const check = () => {
    signal?.throwIfAborted();
    if (closed) throw new Error("HDR wet field is disposed.");
    external?.();
    signal?.throwIfAborted();
  };
  check();
  if (!tiles.length)
    throw new Error("An HDR wet field requires prepared native tiles.");
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const tile of tiles) {
    const { width, height } = tile.region;
    await validateFloatWetTilePair(tile.pixels, tile.coverage, width, height, {
      check,
    });
    check();
    left = Math.min(left, tile.region.x);
    top = Math.min(top, tile.region.y);
    right = Math.max(right, tile.region.x + width);
    bottom = Math.max(bottom, tile.region.y + height);
  }
  const bounds = Object.freeze(
    captureFieldBounds({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }),
  );
  const owner: CapturedHdrWetField = {
    bounds,
    check,
    dispose() {
      closed = true;
      tiles.length = 0;
    },
    readWindow: async (input, readControl = {}) => {
      const region = validateWindow(input),
        result = new Float64Array(region.width * region.height * 5);
      const current = () => {
        check();
        readControl.signal?.throwIfAborted();
        readControl.onProgress?.({ phase: "reading", fraction: null });
        check();
        readControl.signal?.throwIfAborted();
      };
      current();
      for (const tile of tiles) {
        const left = Math.max(region.x, tile.region.x),
          top = Math.max(region.y, tile.region.y),
          right = Math.min(
            region.x + region.width,
            tile.region.x + tile.region.width,
          ),
          bottom = Math.min(
            region.y + region.height,
            tile.region.y + tile.region.height,
          );
        if (right <= left || bottom <= top) continue;
        const width = right - left,
          height = bottom - top,
          window = {
            x: left - tile.region.x,
            y: top - tile.region.y,
            width,
            height,
          };
        const pixels = await readFloatWetTileWindow(
            tile.pixels,
            tile.region.width,
            tile.region.height,
            window,
            { check: current },
          ),
          coverage = await readFloatWetTileWindow(
            tile.coverage,
            tile.region.width,
            tile.region.height,
            window,
            { check: current },
          );
        current();
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const from = (y * width + x) * 4,
              to =
                ((top - region.y + y) * region.width + left - region.x + x) * 5,
              c = coverage[from + 3],
              a = pixels[from + 3];
            if (c === 0) continue;
            const prior = result[to + 4],
              keep = 1 - c;
            for (let channel = 0; channel < 3; channel++) {
              const pigment = a === 0 ? 0 : pixels[from + channel] * a;
              result[to + channel] =
                prior === 0 || c === 1
                  ? pigment
                  : result[to + channel] * keep + pigment;
            }
            result[to + 3] =
              prior === 0 || c === 1 ? a : result[to + 3] * keep + a;
            result[to + 4] = prior === 0 || c === 1 ? c : prior * keep + c;
          }
        current();
      }
      validateHdrWetField(result, region.width * region.height);
      current();
      return result;
    },
  };
  return Object.freeze(owner);
}

/** Private bridge from shared host asset references to native HDR sampling.
 * The asset owner remains checked throughout reads, including cached proofs and
 * windows disjoint from every tile. No display bitmap supplies color samples. */
export async function captureHdrWetAssetField(
  tiles: readonly WetPaintTileData[],
  provider: WetAssetProvider,
  control: FloatWetTileControl = {},
): Promise<CapturedHdrWetField> {
  const assets = await captureHdrWetAssets(tiles, provider, control);
  try {
    const field = await captureHdrWetField(assets.tiles, {
      check: assets.check,
    });
    return Object.freeze({
      bounds: field.bounds,
      check: field.check,
      readWindow: field.readWindow,
      dispose() {
        field.dispose();
        assets.dispose();
      },
    });
  } catch (error) {
    assets.dispose();
    throw error;
  }
}
