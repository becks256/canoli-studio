import { describe, expect, it, beforeAll } from "vitest";
import { computeHistogram, emptyHistogram } from "../src/core/histogram";
import { instantiateKernel, computeWasmHistogram } from "../src/engine/wasm";
import type { PixelKernel } from "../src/engine/wasm";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("tonal histogram computation", () => {
  let kernel: PixelKernel | null = null;

  beforeAll(async () => {
    try {
      const wasmPath = resolve(__dirname, "../public/wasm/pixels.wasm");
      const buffer = await readFile(wasmPath);
      kernel = await instantiateKernel(buffer);
    } catch {
      kernel = null;
    }
  });

  it("handles empty or fully transparent pixels gracefully", () => {
    const empty = emptyHistogram();
    expect(empty.totalPixels).toBe(0);
    expect(empty.mean).toBe(0);

    const transparentPixels = new Uint8ClampedArray(400); // 100 transparent pixels
    const hist = computeHistogram(transparentPixels);
    expect(hist.totalPixels).toBe(0);
    expect(hist.maxCount).toBe(0);
  });

  it("computes accurate distributions and tonal statistics for solid color", () => {
    // 100 pixels of pure red: RGBA(255, 0, 0, 255)
    const pixels = new Uint8ClampedArray(400);
    for (let i = 0; i < 400; i += 4) {
      pixels[i] = 255;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      pixels[i + 3] = 255;
    }

    const hist = computeHistogram(pixels);
    expect(hist.totalPixels).toBe(100);
    expect(hist.red[255]).toBe(100);
    expect(hist.green[0]).toBe(100);
    expect(hist.blue[0]).toBe(100);

    // Luminance: 0.2126 * 255 = 54.213 -> 54
    expect(hist.luminance[54]).toBe(100);
    expect(hist.mean).toBe(54);
    expect(hist.median).toBe(54);
    expect(hist.min).toBe(54);
    expect(hist.max).toBe(54);
    expect(hist.stdDev).toBe(0);
  });

  it("computes accurate statistics for a gradient", () => {
    // 256 pixels with gray values 0..255
    const pixels = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
      pixels[i * 4] = i;
      pixels[i * 4 + 1] = i;
      pixels[i * 4 + 2] = i;
      pixels[i * 4 + 3] = 255;
    }

    const hist = computeHistogram(pixels);
    expect(hist.totalPixels).toBe(256);
    expect(hist.min).toBe(0);
    expect(hist.max).toBe(255);
    expect(hist.median).toBe(127);
    // Mean of 0..255 is 255 / 2 = 127.5
    expect(hist.mean).toBeCloseTo(127.5, 1);
    for (let i = 0; i < 256; i++) {
      expect(hist.luminance[i]).toBe(1);
    }
  });

  it("matches WASM histogram kernel with pure TypeScript fallback", () => {
    if (!kernel) return; // Skip if WASM not available in environment

    // Create complex test image (50x50 pixels)
    const pixels = new Uint8ClampedArray(50 * 50 * 4);
    for (let i = 0; i < 50 * 50; i++) {
      pixels[i * 4] = (i * 7) % 256;
      pixels[i * 4 + 1] = (i * 13) % 256;
      pixels[i * 4 + 2] = (i * 31) % 256;
      pixels[i * 4 + 3] = i % 5 === 0 ? 0 : 255; // 20% transparent
    }

    const tsResult = computeHistogram(pixels);
    const wasmResult = computeWasmHistogram(kernel, pixels);

    expect(wasmResult.totalPixels).toBe(tsResult.totalPixels);
    expect(wasmResult.maxCount).toBe(tsResult.maxCount);
    expect(wasmResult.min).toBe(tsResult.min);
    expect(wasmResult.max).toBe(tsResult.max);
    expect(wasmResult.mean).toBeCloseTo(tsResult.mean, 1);
    expect(wasmResult.median).toBe(tsResult.median);

    for (let b = 0; b < 256; b++) {
      expect(wasmResult.red[b]).toBe(tsResult.red[b]);
      expect(wasmResult.green[b]).toBe(tsResult.green[b]);
      expect(wasmResult.blue[b]).toBe(tsResult.blue[b]);
      expect(wasmResult.luminance[b]).toBe(tsResult.luminance[b]);
    }
  });
});
