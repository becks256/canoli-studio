import type { DocumentData } from "../core/model";
import type { AssetStore } from "../core/assets";
import { STANDARD_PROFILES } from "../core/color/icc";
import { ByteWriter } from "../core/interchange/psd/stream";
import { encodePackBits } from "../core/interchange/psd/packbits";
import { mattePreviewChannel } from "../core/interchange/psd/composite";
import { LUMA_TO_PSD_BLEND_MAP } from "../core/interchange/psd/types";
import { planPsdExport, validatePsdDimensions, type PsdExportMode, type PsdRenderedLayer } from "../core/interchange/psd/export-plan";
import type { DocumentRenderer } from "./renderer";
import { checkExport, type ExportControl } from "./export-control";
import { release } from "./canvas";

interface Channels { tables: Uint8Array<ArrayBuffer>[]; data: Blob[] }
const bytes = (writer: ByteWriter) => new Uint8Array(writer.getBuffer());
function uint32(value: number): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error("This export exceeds PSD's 32-bit section length. PSB export is not implemented.");
  const writer = new ByteWriter(); writer.writeUint32(value); return bytes(writer);
}
function header(document: DocumentData): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.writeAscii("8BPS"); writer.writeUint16(1);
  for (let i = 0; i < 6; i++) writer.writeUint8(0);
  writer.writeUint16(4); writer.writeUint32(document.height); writer.writeUint32(document.width);
  writer.writeUint16(8); writer.writeUint16(3); writer.writeUint32(0);
  const resources = new ByteWriter();
  resources.writeAscii("8BIM"); resources.writeUint16(1005); resources.writePascalString("", 2); resources.writeUint32(16);
  for (let i = 0; i < 2; i++) { resources.writeUint32(72 * 65536); resources.writeUint16(1); resources.writeUint16(1); }
  const profile = STANDARD_PROFILES.srgb.iccBytes;
  if (profile?.length) {
    resources.writeAscii("8BIM"); resources.writeUint16(1039); resources.writePascalString("", 2);
    resources.writeUint32(profile.length); resources.writeBytes(profile);
    if (profile.length % 2) resources.writeUint8(0);
  }
  const data = bytes(resources); writer.writeUint32(data.length); writer.writeBytes(data);
  return bytes(writer);
}

/** Read native tiles into a bounded strip and retain only compressed channel data.
 * No document-sized canvas, ImageData, or uncompressed layer buffer is allocated.
 */
async function renderChannels(
  layer: PsdRenderedLayer, assets: AssetStore, renderer: DocumentRenderer,
  progress: (rows: number) => void, control?: ExportControl, encoding: "layer" | "preview" | "both" = "layer",
): Promise<Channels & { preview?: Channels }> {
  const { width, height, left, top } = layer;
  const channelCount = encoding === "both" ? 7 : 4;
  const tables = Array.from({ length: channelCount }, () => new Uint8Array(height * 2));
  const views = tables.map(table => new DataView(table.buffer));
  const parts: Blob[][] = Array.from({ length: channelCount }, () => []);
  const rowsPerStrip = Math.max(1, Math.min(64, Math.floor(1_000_000 / (width * 4))));
  for (let y = 0; y < height; y += rowsPerStrip) {
    checkExport(control);
    const rows = Math.min(rowsPerStrip, height - y), strip = new Uint8ClampedArray(width * rows * 4);
    for (let x = 0; x < width; x += 2048) {
      checkExport(control);
      const tileWidth = Math.min(2048, width - x);
      const tile = await renderer.render(layer.document, assets, {
        region: { x: left + x, y: top + y, width: tileWidth, height: rows },
        cache: false, readback: true, isCancelled: () => !!control?.signal?.aborted,
      });
      try {
        checkExport(control);
        if (tile.width !== tileWidth || tile.height !== rows)
          throw new Error("PSD rendering did not produce native-resolution pixels.");
        const pixels = tile.getContext("2d")!.getImageData(0, 0, tileWidth, rows).data;
        for (let row = 0; row < rows; row++)
          strip.set(pixels.subarray(row * tileWidth * 4, (row + 1) * tileWidth * 4), (row * width + x) * 4);
      } finally { release(tile); }
    }
    for (let c = 0; c < channelCount; c++) {
      const compressed: Uint8Array<ArrayBuffer>[] = [];
      for (let row = 0; row < rows; row++) {
        const plane = new Uint8Array(width);
        for (let x = 0; x < width; x++) {
          const index = (row * width + x) * 4, color = c >= 4 ? c - 4 : c;
          const value = strip[index + color];
          plane[x] = c >= 4 || (encoding === "preview" && c < 3) ? mattePreviewChannel(value, strip[index + 3]) : value;
        }
        const encoded = new Uint8Array(encodePackBits(plane));
        if (encoded.length > 0xffff) throw new Error("A PSD RLE scanline exceeds its 16-bit length field.");
        views[c].setUint16((y + row) * 2, encoded.length);
        compressed.push(encoded);
      }
      parts[c].push(new Blob(compressed));
    }
    progress(rows);
    // Allow Cancel, navigation and status updates between bounded strips.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  checkExport(control);
  const data = parts.map(chunks => new Blob(chunks));
  return { tables: tables.slice(0, 4), data: data.slice(0, 4), preview: encoding === "both" ? {
    tables: [...tables.slice(4), tables[3]], data: [...data.slice(4), data[3]],
  } : undefined };
}

function layerRecord(layer: PsdRenderedLayer, channels: Channels): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.writeInt32(layer.top); writer.writeInt32(layer.left);
  writer.writeInt32(layer.top + layer.height); writer.writeInt32(layer.left + layer.width);
  writer.writeUint16(4);
  [0, 1, 2, -1].forEach((id, index) => {
    writer.writeInt16(id);
    writer.writeBytes(uint32(2 + channels.tables[index].length + channels.data[index].size));
  });
  writer.writeAscii("8BIM"); writer.writeAscii(LUMA_TO_PSD_BLEND_MAP[layer.blendMode], 4);
  writer.writeUint8(Math.round(layer.opacity * 255)); writer.writeUint8(0);
  writer.writeUint8(layer.visible ? 0 : 2); writer.writeUint8(0);
  const extra = new ByteWriter(); extra.writeUint32(0); extra.writeUint32(0); extra.writePascalString(layer.name, 4);
  extra.writeAscii("8BIM"); extra.writeAscii("luni");
  const name = new ByteWriter(); name.writeUnicodeString(layer.name);
  const unicode = bytes(name); extra.writeUint32(unicode.length); extra.writeBytes(unicode);
  const data = bytes(extra); writer.writeUint32(data.length); writer.writeBytes(data);
  return bytes(writer);
}

export async function exportPsd(
  document: DocumentData, assets: AssetStore, renderer: DocumentRenderer,
  mode: PsdExportMode = "layers", control?: ExportControl,
): Promise<Blob> {
  checkExport(control); validatePsdDimensions(document.width, document.height);
  const plan = planPsdExport(document, mode);
  if (plan.layers.length > 32767) throw new Error("PSD cannot represent more than 32,767 layer records.");
  const totalRows = plan.layers.reduce((total, layer) => total + layer.height, 0) + (plan.reuseComposite ? 0 : document.height);
  let completedRows = 0;
  const progress = (rows: number) => {
    completedRows += rows; control?.onProgress?.({ phase: "rendering", fraction: completedRows / totalRows });
  };
  const records: Uint8Array<ArrayBuffer>[] = [], payloads: Blob[] = [];
  let composite: Channels | undefined;
  for (const layer of plan.layers) {
    const channels = await renderChannels(layer, assets, renderer, progress, control, plan.reuseComposite ? "both" : "layer");
    records.push(layerRecord(layer, channels));
    for (let c = 0; c < 4; c++) payloads.push(new Blob([new Uint8Array([0, 1]), channels.tables[c], channels.data[c]]));
    if (plan.reuseComposite) composite = channels.preview;
  }
  if (!composite) composite = await renderChannels({
    name: document.name, document, left: 0, top: 0, width: document.width, height: document.height,
    opacity: 1, blendMode: "normal", visible: true, merged: true,
  }, assets, renderer, progress, control, "preview");
  checkExport(control); control?.onProgress?.({ phase: "encoding", fraction: null });
  const count = new ByteWriter();
  // Negative count identifies channel four as merged transparency, per Adobe.
  count.writeInt16(-plan.layers.length);
  const layerInfo = new Blob([bytes(count), ...records, ...payloads]);
  const padding = layerInfo.size % 2 ? new Uint8Array(1) : new Uint8Array(0);
  const layerAndMask = new Blob([uint32(layerInfo.size + padding.length), layerInfo, padding, uint32(0)]);
  const blob = new Blob([
    header(document), uint32(layerAndMask.size), layerAndMask,
    new Uint8Array([0, 1]), ...composite.tables, ...composite.data,
  ], { type: "image/vnd.adobe.photoshop" });
  if (blob.size > 0x7fffffff) throw new Error("This output exceeds PSD's 2 GB file limit. Save a Canoli Studio project; PSB export is not implemented.");
  checkExport(control);
  return blob;
}
