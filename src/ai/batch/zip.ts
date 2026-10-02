/**
 * Minimal, standard uncompressed ZIP packager.
 * Produces stored ZIP/ZIP64 archives without external dependencies.
 */

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
function safe(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("ZIP geometry exceeds safe integer addressing.");
  return value;
}
function extra(values: number[]): Uint8Array<ArrayBuffer> {
  if (!values.length) return new Uint8Array(0);
  const bytes = new Uint8Array(4 + values.length * 8),
    view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, values.length * 8, true);
  values.forEach((value, i) =>
    view.setBigUint64(4 + i * 8, BigInt(safe(value)), true),
  );
  return bytes;
}

/** Internal header encoder, independently testable at 64-bit boundaries without giant buffers. */
export function zipEntryHeaders(
  name: string,
  size: number,
  crc: number,
  offset: number,
) {
  safe(size);
  safe(offset);
  const encoded = new TextEncoder().encode(name.replace(/\\/g, "/"));
  if (encoded.length > MAX16)
    throw new Error("ZIP entry filename exceeds the format limit.");
  const largeSize = size >= MAX32,
    largeOffset = offset >= MAX32;
  const localExtra = extra(largeSize ? [size, size] : []);
  const centralExtra = extra([
    ...(largeSize ? [size, size] : []),
    ...(largeOffset ? [offset] : []),
  ]);
  const local = new Uint8Array(30 + encoded.length + localExtra.length),
    lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, largeSize ? 45 : 20, true);
  lv.setUint16(6, 0x0800, true);
  lv.setUint16(12, 0x5c21, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, largeSize ? MAX32 : size, true);
  lv.setUint32(22, largeSize ? MAX32 : size, true);
  lv.setUint16(26, encoded.length, true);
  lv.setUint16(28, localExtra.length, true);
  local.set(encoded, 30);
  local.set(localExtra, 30 + encoded.length);
  const central = new Uint8Array(46 + encoded.length + centralExtra.length),
    cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 45, true);
  cv.setUint16(6, largeSize || largeOffset ? 45 : 20, true);
  cv.setUint16(8, 0x0800, true);
  cv.setUint16(14, 0x5c21, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, largeSize ? MAX32 : size, true);
  cv.setUint32(24, largeSize ? MAX32 : size, true);
  cv.setUint16(28, encoded.length, true);
  cv.setUint16(30, centralExtra.length, true);
  cv.setUint32(42, largeOffset ? MAX32 : offset, true);
  central.set(encoded, 46);
  central.set(centralExtra, 46 + encoded.length);
  return { local, central, zip64: largeSize || largeOffset };
}

/** Shared serializer for synchronous callers and cooperatively scheduled Blob exports. */
class ZipBuilder {
  private parts: BlobPart[] = [];
  private directory: Uint8Array<ArrayBuffer>[] = [];
  private offset = 0;
  private directorySize = 0;
  private needs64 = false;
  private count = 0;

  add(name: string, data: Blob, crc: number): void {
    const headers = zipEntryHeaders(name, data.size, crc, this.offset);
    this.parts.push(headers.local, data);
    this.directory.push(headers.central);
    this.offset = safe(this.offset + headers.local.byteLength + data.size);
    this.directorySize = safe(this.directorySize + headers.central.byteLength);
    this.count++;
    this.needs64 ||= headers.zip64 || this.count >= MAX16;
  }

  finish(): Blob {
    const { parts, directory, directorySize } = this;
    let { offset, needs64 } = this;
    const directoryStart = offset;
    for (const header of directory) parts.push(header);
    offset = safe(offset + directorySize);
    needs64 ||= directoryStart >= MAX32 || directorySize >= MAX32;
    if (needs64) {
      const end64 = new Uint8Array(56),
        view = new DataView(end64.buffer);
      view.setUint32(0, 0x06064b50, true);
      view.setBigUint64(4, 44n, true);
      view.setUint16(12, 45, true);
      view.setUint16(14, 45, true);
      view.setBigUint64(24, BigInt(this.count), true);
      view.setBigUint64(32, BigInt(this.count), true);
      view.setBigUint64(40, BigInt(directorySize), true);
      view.setBigUint64(48, BigInt(directoryStart), true);
      const locator = new Uint8Array(20),
        lv = new DataView(locator.buffer);
      lv.setUint32(0, 0x07064b50, true);
      lv.setBigUint64(8, BigInt(offset), true);
      lv.setUint32(16, 1, true);
      parts.push(end64, locator);
    }
    const end = new Uint8Array(22),
      view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, Math.min(this.count, MAX16), true);
    view.setUint16(10, Math.min(this.count, MAX16), true);
    view.setUint32(12, Math.min(directorySize, MAX32), true);
    view.setUint32(16, Math.min(directoryStart, MAX32), true);
    parts.push(end);
    return new Blob(parts, { type: "application/zip" });
  }
}

export function createZipArchive(entries: ZipEntry[]): Blob {
  const builder = new ZipBuilder();
  for (const entry of entries) {
    const snapshot = entry.data.slice();
    builder.add(entry.name, new Blob([snapshot]), crc32(snapshot));
  }
  return builder.finish();
}

export interface ZipBlobEntry {
  name: string;
  data: Blob;
}
export interface ZipExportOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

/** Immutable Blob payloads; bounded CRC reads and task yields allow cancellation between chunks. */
export async function createZipArchiveAsync(
  entries: ZipBlobEntry[],
  options: ZipExportOptions = {},
): Promise<Blob> {
  const captured = entries.map((entry) => ({
    name: entry.name,
    data: entry.data,
  }));
  const { signal, onProgress } = options;
  const builder = new ZipBuilder();
  const checkpoint = async () => {
    signal?.throwIfAborted();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
  };
  await checkpoint();
  for (let index = 0; index < captured.length; index++) {
    const entry = captured[index];
    let crc = 0xffffffff;
    for (let offset = 0; offset < entry.data.size; offset += 1024 * 1024) {
      const bytes = new Uint8Array(
        await entry.data.slice(offset, offset + 1024 * 1024).arrayBuffer(),
      );
      signal?.throwIfAborted();
      for (const byte of bytes)
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      await checkpoint();
    }
    builder.add(entry.name, entry.data, (crc ^ 0xffffffff) >>> 0);
    onProgress?.(index + 1, captured.length);
    if (index % 32 === 31) await checkpoint();
    signal?.throwIfAborted();
  }
  await checkpoint();
  return builder.finish();
}
