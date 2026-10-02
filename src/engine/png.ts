import type { AssetStore } from "../core/assets";
import type { DocumentData } from "../core/model";
import type { DocumentRenderer } from "./renderer";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(bytes.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, bytes.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(bytes, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < result.length - 4; i++)
    crc = crcTable[(crc ^ result[i]) & 255] ^ (crc >>> 8);
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}

/** PNG is streamed through a deflater, without a document-sized canvas or RGBA
 * buffer. Retained output is compressed; source decoding remains browser-managed.
 */
export async function exportPng(
  document: DocumentData,
  assets: AssetStore,
  renderer: DocumentRenderer,
): Promise<Blob> {
  const { width, height } = document;
  // This is the PNG format's dimension boundary, not an image import restriction.
  if (width > 0x7fffffff || height > 0x7fffffff)
    throw new Error("These dimensions exceed the PNG file format.");
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const parts: BlobPart[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("sRGB", new Uint8Array([0])),
  ];
  const compression = new CompressionStream("deflate");
  const writer = compression.writable.getWriter();
  const reader = compression.readable.getReader();
  const collect = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(chunk("IDAT", value));
    }
  })();
  // Attach rejection handling before the first await in the producer.
  void collect.catch(() => {});
  try {
    const rowBytes = width * 4 + 1;
    const rowsPerStrip = Math.max(
      1,
      Math.min(64, Math.floor(4_000_000 / rowBytes)),
    );
    for (let y = 0; y < height; y += rowsPerStrip) {
      const rows = Math.min(rowsPerStrip, height - y);
      const strip = new Uint8Array(rowBytes * rows); // filter byte 0 for each row
      for (let x = 0; x < width; x += 2048) {
        const tileWidth = Math.min(2048, width - x);
        const tile = await renderer.render(document, assets, {
          region: { x, y, width: tileWidth, height: rows },
          cache: false,
          readback: true,
        });
        try {
          const pixels = tile
            .getContext("2d")!
            .getImageData(0, 0, tileWidth, rows).data;
          for (let row = 0; row < rows; row++)
            strip.set(
              pixels.subarray(row * tileWidth * 4, (row + 1) * tileWidth * 4),
              row * rowBytes + 1 + x * 4,
            );
        } finally {
          tile.width = tile.height = 0;
        }
      }
      await writer.write(strip);
      // Let input, status messages, and cancellation by navigation proceed.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    await writer.close();
    await collect;
  } catch (error) {
    await writer.abort(error).catch(() => {});
    await reader.cancel().catch(() => {});
    throw error;
  }
  parts.push(chunk("IEND", new Uint8Array()));
  return new Blob(parts, { type: "image/png" });
}

/**
 * Encodes an uncompressed RGBA pixel buffer directly into a compressed PNG Blob.
 */
export async function encodeRgbaPng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Blob> {
  if (width > 0x7fffffff || height > 0x7fffffff)
    throw new Error("These dimensions exceed the PNG file format.");
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // color type RGBA

  const parts: BlobPart[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("sRGB", new Uint8Array([0])),
  ];

  const rowBytes = width * 4 + 1;
  const filtered = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    filtered[y * rowBytes] = 0; // Filter: None
    filtered.set(
      rgba.subarray(y * width * 4, (y + 1) * width * 4),
      y * rowBytes + 1,
    );
  }

  const compression = new CompressionStream("deflate");
  const writer = compression.writable.getWriter();
  const reader = compression.readable.getReader();
  const collect = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(chunk("IDAT", value));
    }
  })();
  void collect.catch(() => {});

  try {
    await writer.write(filtered);
    await writer.close();
    await collect;
  } catch (error) {
    await writer.abort(error).catch(() => {});
    await reader.cancel().catch(() => {});
    throw error;
  }

  parts.push(chunk("IEND", new Uint8Array()));
  return new Blob(parts, { type: "image/png" });
}
