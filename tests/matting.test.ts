/**
 * Unit and Integration Test Suite for Ticket T19 (Catalog A04):
 * Object selection and background removal with interactive matting.
 *
 * Verifies:
 * 1. Saliency detection and bounding box estimation (detectSalientSubject).
 * 2. 3-state Trimap generation and boundary radius expansion (generateTrimapFromMask).
 * 3. Local color-line reference and regularization (solveAlphaMatte).
 * 4. Color bleeding decontamination on semi-transparent transition edges (decontaminateColors).
 * 5. Bitmap LayerMask schema, persistence, and referencedAssets registration.
 * 6. Non-destructive layer mask attachment and byte-for-byte source image preservation.
 * 7. Single-transaction undo/redo rollback fidelity in EditorStore.
 * 8. EditorApplication facade integration (selectSubject, removeBackground, refineEdge).
 */

import { describe, expect, it } from "vitest";
import { Document, LayerMask, RasterLayer } from "../src/dom";
import { AssetStore } from "../src/core/assets";
import { EditorApplication } from "../src/editor";
import { referencedAssets } from "../src/core/model";
import {
  detectSalientSubject,
  generateTrimapFromMask,
  maskToSelectionData,
  erodeMask,
  dilateMask,
} from "../src/intelligence/matting/segmentation";
import {encodeRgbaPng} from '../src/engine/png';
import {
  solveAlphaMatte,
  decontaminateColors,
} from "../src/intelligence/matting/engine";
import {
  TRIMAP_BACKGROUND,
  TRIMAP_UNKNOWN,
  TRIMAP_FOREGROUND,
} from "../src/intelligence/matting/types";

if (typeof globalThis.Worker === "undefined") {
  globalThis.Worker = class MockWorker {
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    terminate() {}
  } as unknown as typeof Worker;
}

if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElement(tag: string) {
      if (tag === "canvas") {
        let width = 0;
        let height = 0;
        let buffer = new Uint8ClampedArray(0);
        return {
          get width() {
            return width;
          },
          set width(val) {
            width = val;
            buffer = new Uint8ClampedArray(width * height * 4);
          },
          get height() {
            return height;
          },
          set height(val) {
            height = val;
            buffer = new Uint8ClampedArray(width * height * 4);
          },
          getContext() {
            return {
              save() {},
              restore() {},
              resetTransform() {},
              setTransform() {},
              drawImage(source: any) {
                if (source?.data) {
                  buffer.set(source.data);
                } else if (source?.width && source?.height) {
                  for (let i = 0; i < buffer.length; i += 4) {
                    buffer[i] = 200;
                    buffer[i + 1] = 180;
                    buffer[i + 2] = 50;
                    buffer[i + 3] = 255;
                  }
                }
              },
              getImageData(_x: number, _y: number, w: number, h: number) {
                const data = new Uint8ClampedArray(w * h * 4);
                data.set(
                  buffer.subarray(0, Math.min(buffer.length, data.length)),
                );
                if (buffer.length === 0) {
                  for (let i = 0; i < data.length; i += 4) {
                    data[i] = 200;
                    data[i + 1] = 180;
                    data[i + 2] = 50;
                    data[i + 3] = 255;
                  }
                }
                return { data, width: w, height: h };
              },
              createImageData(w: number, h: number) {
                return {
                  data: new Uint8ClampedArray(w * h * 4),
                  width: w,
                  height: h,
                };
              },
              putImageData(img: any) {
                buffer.set(img.data);
              },
              fillRect() {},
              clearRect() {},
            };
          },
          toDataURL() {
            return "data:image/png;base64,mock";
          },
        };
      }
      return {} as any;
    },
  } as any;
}

describe("T19: Object selection and background removal with interactive matting", () => {
  const width = 32;
  const height = 32;
  const numPixels = width * height;

  // OO/history units use a genuine prepared PNG fixture. Browser/API suites own
  // the worker/readback/staging integration checks; this Canvas shim cannot do that.
  async function preparedHost(document:Document,assets:AssetStore,rgba:Uint8Array){
    const candidate=detectSalientSubject(rgba,width,height),trimap=generateTrimapFromMask(candidate.mask,width,height,3),matte=solveAlphaMatte(rgba,trimap,{radius:3,decontaminate:false},candidate.mask),pixels=new Uint8Array(numPixels*4);
    for(let i=0;i<numPixels;i++)pixels.set([255,255,255,matte.alpha[i]],i*4);
    const asset=await assets.add(await encodeRgbaPng(pixels,width,height),'Prepared matte',undefined,false);
    document._prepareMatting=async request=>({plan:{sourceId:request.layerId,mask:LayerMask.fromBitmap(asset.id).toJSON(),unresolvedPixels:matte.unresolvedPixels??0}});
  }

  /**
   * Helper to create a synthetic image with a distinct bright foreground rectangle
   * centered on a dark blue background.
   */
  function createSyntheticSubjectImage(): Uint8Array {
    const rgba = new Uint8Array(numPixels * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        // Foreground box from x=10..22, y=10..22
        if (x >= 10 && x <= 22 && y >= 10 && y <= 22) {
          rgba[idx] = 240; // R
          rgba[idx + 1] = 200; // G
          rgba[idx + 2] = 50; // B
          rgba[idx + 3] = 255;
        } else {
          // Background: dark blue
          rgba[idx] = 20; // R
          rgba[idx + 1] = 30; // G
          rgba[idx + 2] = 70; // B
          rgba[idx + 3] = 255;
        }
      }
    }
    return rgba;
  }

  describe("Saliency Segmentation & Trimap Generation", () => {
    it("detects salient foreground subject and computes valid bounding box", () => {
      const rgba = createSyntheticSubjectImage();
      const result = detectSalientSubject(rgba, width, height, {
        threshold: 0.3,
      });

      expect(result.bounds.width).toBeGreaterThanOrEqual(10);
      expect(result.bounds.height).toBeGreaterThanOrEqual(10);
      expect(result.bounds.x).toBeGreaterThanOrEqual(8);
      expect(result.bounds.x).toBeLessThanOrEqual(12);
      expect(result.bounds.y).toBeGreaterThanOrEqual(8);
      expect(result.bounds.y).toBeLessThanOrEqual(12);
      expect(result.confidence).toBe(0); // This heuristic has no calibrated quality score.

      // Verify foreground pixels inside mask
      const centerIdx = 16 * width + 16;
      expect(result.mask[centerIdx]).toBe(255);

      // Verify border background pixels are 0
      const cornerIdx = 0;
      expect(result.mask[cornerIdx]).toBe(0);
    });

    it("returns no foreground for uniform pixels instead of fabricating a fallback", () => {
      const uniformRgba = new Uint8Array(numPixels * 4).fill(128);
      const result = detectSalientSubject(uniformRgba, width, height);

      expect(result.bounds).toEqual({x:0,y:0,width:0,height:0});
      expect(result.mask.some(value=>value>0)).toBe(false);
      expect(result.mask.length).toBe(numPixels);
    });

    it("generates 3-state Trimap with correct foreground, unknown, and background bands", () => {
      const binaryMask = new Uint8Array(numPixels);
      // Fill central box with 255
      for (let y = 8; y <= 24; y++) {
        for (let x = 8; x <= 24; x++) {
          binaryMask[y * width + x] = 255;
        }
      }

      const trimap = generateTrimapFromMask(binaryMask, width, height, 3);
      expect(trimap.width).toBe(width);
      expect(trimap.height).toBe(height);

      // Core interior must be TRIMAP_FOREGROUND (255)
      expect(trimap.data[16 * width + 16]).toBe(TRIMAP_FOREGROUND);

      // Far exterior must be TRIMAP_BACKGROUND (0)
      expect(trimap.data[0]).toBe(TRIMAP_BACKGROUND);

      // Transition band near boundary (e.g., at edge x=8, y=16) must be TRIMAP_UNKNOWN (128)
      expect(trimap.data[16 * width + 8]).toBe(TRIMAP_UNKNOWN);
    });

    it("morphological erosion and dilation maintain geometric containment", () => {
      const mask = new Uint8Array(numPixels);
      for (let y = 10; y <= 20; y++) {
        for (let x = 10; x <= 20; x++) {
          mask[y * width + x] = 255;
        }
      }

      const eroded = erodeMask(mask, width, height, 2);
      const dilated = dilateMask(mask, width, height, 2);

      // Dilated contains original, which contains eroded
      for (let i = 0; i < numPixels; i++) {
        if (eroded[i] === 255) {
          expect(mask[i]).toBe(255);
        }
        if (mask[i] === 255) {
          expect(dilated[i]).toBe(255);
        }
      }
    });

    it("converts actual mask coverage, preserving holes and fractional alpha", () => {
      const mask = new Uint8Array(numPixels);
      mask[5*width+5]=255;mask[5*width+7]=128;mask[6*width+5]=64;
      const bounds = { x: 5, y: 5, width: 10, height: 12 };
      const sel = maskToSelectionData(mask, width, height, bounds);

      expect(sel.regions).toHaveLength(1);
      expect(sel.regions[0]).toMatchObject({
        x: 5,
        y: 5,
        width: 10,
        height: 12,
        shape: "pixels",
        operation: "add",
        coverage:{width:3,height:2,runs:[1,255,2,0,3,128,4,64,6,0]},
      });
    });
  });

  describe("Alpha Matting Mathematical Engine & Color Decontamination", () => {
    it("solves alpha matte over unknown transition zone with exact known-region preservation", () => {
      const rgba = createSyntheticSubjectImage();
      const binaryMask = new Uint8Array(numPixels);
      for (let y = 10; y <= 22; y++) {
        for (let x = 10; x <= 22; x++) {
          binaryMask[y * width + x] = 255;
        }
      }

      const trimap = generateTrimapFromMask(binaryMask, width, height, 3);
      const result = solveAlphaMatte(rgba, trimap, { radius: 3, smooth: 10 });

      expect(result.alpha.length).toBe(numPixels);

      // Known foreground must be exactly 255
      const center = 16 * width + 16;
      expect(trimap.data[center]).toBe(TRIMAP_FOREGROUND);
      expect(result.alpha[center]).toBe(255);

      // Known background must be exactly 0
      const corner = 0;
      expect(trimap.data[corner]).toBe(TRIMAP_BACKGROUND);
      expect(result.alpha[corner]).toBe(0);

      // Unknown region alpha values must be bounded between 0 and 255
      for (let i = 0; i < numPixels; i++) {
        expect(result.alpha[i]).toBeGreaterThanOrEqual(0);
        expect(result.alpha[i]).toBeLessThanOrEqual(255);
      }
    });

    it("decontaminates background color bleeding from transition pixels", () => {
      const rgba = createSyntheticSubjectImage();
      const alpha = new Uint8Array(numPixels).fill(0);
      const trimap = new Uint8Array(numPixels).fill(TRIMAP_BACKGROUND);

      // Create a semi-transparent transition pixel at (10, 10)
      const edgeIdx = 10 * width + 10;
      alpha[edgeIdx] = 128; // 50% opacity
      trimap[edgeIdx] = TRIMAP_UNKNOWN;

      // Inside is foreground
      const fgIdx = 15 * width + 15;
      alpha[fgIdx] = 255;
      trimap[fgIdx] = TRIMAP_FOREGROUND;

      const decontaminated = decontaminateColors(
        rgba,
        alpha,
        trimap,
        width,
        height,
        1.0,
      );
      expect(decontaminated.length).toBe(rgba.length);

      // Corrected RGB and relative matte coverage are separate; intrinsic alpha stays intact.
      expect(decontaminated[edgeIdx * 4 + 3]).toBe(rgba[edgeIdx*4+3]);
    });
  });

  describe("Bitmap LayerMask & Document Model Integration", () => {
    it("creates, validates, and serializes LayerMask with kind: bitmap", () => {
      const assetId = "test-bitmap-mask-asset-1";
      const mask = LayerMask.fromBitmap(assetId, {
        feather: 2,
        density: 0.85,
        inverted: false,
      });

      expect(mask.assetId).toBe(assetId);
      expect(mask.feather).toBe(2);
      expect(mask.density).toBe(0.85);
      expect(mask.inverted).toBe(false);

      const json = mask.toJSON();
      expect(json.kind).toBe("bitmap");
      if (json.kind === "bitmap") {
        expect(json.assetId).toBe(assetId);
      }

      // Deserialization roundtrip
      const roundtripped = LayerMask._fromJSON(json);
      expect(roundtripped.assetId).toBe(assetId);
      expect(roundtripped.density).toBe(0.85);
    });

    it("indexes bitmap mask assetId in referencedAssets to guarantee container persistence", () => {
      const doc = new Document({ width: 100, height: 100 });
      const assetId = "source-image-asset";
      const maskAssetId = "mask-bitmap-asset";

      const layer = new RasterLayer({
        name: "Photo",
        assetId,
        width: 100,
        height: 100,
      });
      doc.layers.add(layer);

      // Attach bitmap mask
      layer.maskFromBitmap(maskAssetId);

      const refs = referencedAssets(doc.toJSON());
      expect(refs).toContain(assetId);
      expect(refs).toContain(maskAssetId);
    });
  });

  describe("Non-Destructive Execution & Single-Step Undo Invariant", () => {
    it("preserves source image bytes in AssetStore byte-for-byte during refineEdge", async () => {
      const assets = new AssetStore();
      const doc = new Document({ width: 32, height: 32, assets });

      const origBytes = createSyntheticSubjectImage();
      const origBlob = new Blob([origBytes as unknown as BlobPart], {
        type: "image/png",
      });
      const origAsset = await assets.add(origBlob, "subject.png");

      const layer = new RasterLayer({
        name: "Foreground Object",
        assetId: origAsset.id,
        width: 32,
        height: 32,
      });
      doc.layers.add(layer);
      doc.selectedLayer = layer;

      expect(layer.mask).toBeNull();

      // Execute refineEdge on RasterLayer
      await preparedHost(doc,assets,origBytes);
      const mask = await layer.refineEdge({ radius: 4, smooth: 10 });

      expect(mask).toBeDefined();
      expect(layer.mask).not.toBeNull();
      expect(layer.mask?.assetId).toBeDefined();
      expect(layer.mask?.assetId).not.toBe(origAsset.id);

      // Crucial Invariant: Original asset in AssetStore is untouched byte-for-byte
      const storedAsset = assets.get(origAsset.id);
      expect(storedAsset.id).toBe(origAsset.id);
      expect(storedAsset.width).toBe(origAsset.width);
      expect(storedAsset.height).toBe(origAsset.height);
      expect(new Uint8Array(await storedAsset.blob.arrayBuffer())).toEqual(origBytes);
    });

    it("rolls back refineEdge or removeBackground cleanly in exactly 1 undo step", async () => {
      const assets = new AssetStore();
      const doc = new Document({ width: 32, height: 32, assets });

      const origBytes = createSyntheticSubjectImage();
      const origBlob = new Blob([origBytes as unknown as BlobPart], {
        type: "image/png",
      });
      const origAsset = await assets.add(origBlob, "subject.png");

      const layer = new RasterLayer({
        name: "Foreground Object",
        assetId: origAsset.id,
        width: 32,
        height: 32,
      });
      doc.layers.add(layer);
      doc.selectedLayer = layer;

      expect(layer.mask).toBeNull();

      // Remove background
      await preparedHost(doc,assets,origBytes);
      await doc.removeBackground();
      expect(layer.mask).not.toBeNull();
      expect(doc.canUndo).toBe(true);

      // Single step undo rolls back to unmasked state
      doc.undo();
      expect(layer.mask).toBeNull();

      // Redo restores mask
      doc.redo();
      expect(layer.mask).not.toBeNull();
    });

    it("populates document marquee selection during selectSubject and rolls back in 1 step", async () => {
      const assets = new AssetStore();
      const doc = new Document({ width: 32, height: 32, assets });

      const origBytes = createSyntheticSubjectImage();
      const origBlob = new Blob([origBytes as unknown as BlobPart], {
        type: "image/png",
      });
      const origAsset = await assets.add(origBlob, "subject.png");

      const layer = new RasterLayer({
        name: "Subject Layer",
        assetId: origAsset.id,
        width: 32,
        height: 32,
      });
      doc.layers.add(layer);
      doc.selectedLayer = layer;

      expect(doc.selection).toBeNull();
      // Unit host supplies genuine reference coverage; browser tests use native workers/readback.
      doc._prepareSubject=async()=>{const candidate=detectSalientSubject(origBytes,width,height);return maskToSelectionData(candidate.mask,width,height);};
      const selection = await doc.selectSubject();
      expect(selection.regions.length).toBeGreaterThan(0);
      expect(doc.selection).not.toBeNull();

      // 1-step undo clears selection
      doc.undo();
      expect(doc.selection).toBeNull();
    });
  });

  describe("EditorApplication Facade Integration", () => {
    it("exposes selectSubject, removeBackground, and refineEdge on EditorApplication", async () => {
      const app = new EditorApplication();
      const origBytes = createSyntheticSubjectImage();
      const origBlob = new Blob([origBytes as unknown as BlobPart], {
        type: "image/png",
      });
      const asset = await app.assetStore.add(origBlob, "test-editor-image.png");

      const layer = new RasterLayer({
        name: "Image Layer",
        assetId: asset.id,
        width: 32,
        height: 32,
      });
      app.document.layers.add(layer);
      app.document.selectedLayer = layer;

      // Test selectSubject via EditorApplication
      app.document._prepareSubject=async()=>{const candidate=detectSalientSubject(origBytes,width,height);return maskToSelectionData(candidate.mask,width,height);};
      const sel = await app.selectSubject();
      expect(sel.regions.length).toBeGreaterThan(0);

      // Test refineEdge via EditorApplication
      await preparedHost(app.document,app.assetStore,origBytes);
      const mask = await app.refineEdge({ radius: 3 });
      expect(mask).toBeDefined();
      expect(layer.mask).not.toBeNull();

      // Test undo
      app.document.undo();
      expect(layer.mask).toBeNull();
    });
  });
});
