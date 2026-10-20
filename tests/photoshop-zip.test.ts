import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { parsePsd, parsePsdAsync, getPsdCapabilityReport } from '../src/core/interchange/psd/parser';
import { psdToDocumentAsync } from '../src/core/interchange/psd/bridge';
import { decodePsdZip } from '../src/core/interchange/psd/zip';

if (typeof ImageData === 'undefined') globalThis.ImageData = class {
  readonly data: Uint8ClampedArray; readonly colorSpace = 'srgb';
  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
} as unknown as typeof ImageData;

const directory = 'tests/fixtures/psd/zip/';
const manifest = JSON.parse(readFileSync(directory + 'manifest.json', 'utf8')) as {
  cases: {file: string; width: number; height: number; layers: number; rgbaSha256: string}[];
};
const hash = (bytes: Uint8ClampedArray) => createHash('sha256').update(bytes).digest('hex');

describe('independent Photoshop ZIP and prediction decoding', () => {
  for (const fixture of manifest.cases.filter(value => value.width * value.height < 50_000_000)) {
    it(`decodes every original layer and merged RGBA sample in ${fixture.file}`, async () => {
      const input = readFileSync(directory + fixture.file), before = Buffer.from(input);
      const parsed = await parsePsdAsync(input);
      expect([parsed.header.width, parsed.header.height]).toEqual([fixture.width, fixture.height]);
      expect(hash(parsed.composite!.data)).toBe(fixture.rgbaSha256);
      expect(hash(parsed.layers[0].imageData!.data)).toBe(fixture.rgbaSha256);
      expect(getPsdCapabilityReport(parsed).canImportAsLayers).toBe(true);
      expect(getPsdCapabilityReport(parsed).warnings.join(' ')).not.toMatch(/unsupported compression/);
      for (const mode of ['flatten', 'layered'] as const) {
        const result = await psdToDocumentAsync(input, {mode});
        expect(result.document.children).toHaveLength(1);
        expect(hash([...result.assets.values()][0].data)).toBe(fixture.rgbaSha256);
      }
      expect(input).toEqual(before);
    });
  }

  it('keeps synchronous compatibility helpers explicit about ZIP and higher precision', async () => {
    const input = readFileSync(directory + 'rgba-prediction.psd');
    const parsed = parsePsd(input);
    expect(parsed.layers[0].imageData).toBeUndefined();
    expect(parsed.unsupportedCompositeCompression).toBe(true);
    expect(getPsdCapabilityReport(parsed).canImportAsLayers).toBe(false);
    const higherPrecision = new Uint8Array(input);
    new DataView(higherPrecision.buffer).setUint16(22, 16);
    const unsupported = await parsePsdAsync(higherPrecision);
    expect(unsupported.layers[0].imageData).toBeUndefined();
    expect(unsupported.unsupportedCompositeCompression).toBe(true);
  });

  for (const fixture of ['raw-layer-zip-merged', 'zip-unsupported']) {
    it(`rejects the independently confirmed extra merged plane in preserved ${fixture}`, async () => {
      await expect(parsePsdAsync(readFileSync(`tests/fixtures/psd/${fixture}.psd`))).rejects.toThrow(/Photoshop ZIP/);
    });
  }

  it('rejects truncated, checksum-invalid, short and excess zlib data', async () => {
    const data = deflateSync(new Uint8Array([1, 250, 17, 92]));
    const damaged = new Uint8Array(data); damaged[damaged.length - 1] ^= 1;
    for (const [bytes, width] of [[data.subarray(0, -1), 4], [damaged, 4], [data, 5], [data, 3]] as const)
      await expect(decodePsdZip({bytes, width, rows: 1, prediction: false})).rejects.toThrow(/Photoshop ZIP/);
    await expect(decodePsdZip({bytes: data, width: .5, rows: 8, prediction: true})).rejects.toThrow(/geometry/);
    await expect(decodePsdZip({bytes: data, width: Number.MAX_SAFE_INTEGER, rows: 2, prediction: true})).rejects.toThrow(/geometry/);
  });

  it('reports missing native Deflate support without silently fabricating a channel', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      await expect(parsePsdAsync(readFileSync(directory + 'rgba-zip.psd'))).rejects.toThrow(/requires native Deflate support/);
    } finally { vi.unstubAllGlobals(); }
  });
});
