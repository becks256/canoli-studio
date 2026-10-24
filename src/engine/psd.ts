import type { DocumentData } from "../core/model";
import type { AssetStore } from "../core/assets";
import { STANDARD_PROFILES } from "../core/color/icc";
import { ByteWriter } from "../core/interchange/psd/stream";
import {PhotoshopEncoder} from './photoshop-encoder';
import { LUMA_TO_PSD_BLEND_MAP } from "../core/interchange/psd/types";
import { planPsdExport, validatePsdDimensions, photoshopVersion, type PhotoshopFormat, type PsdExportMode, type PsdRenderedLayer, type PsdRenderedMask, type PsdGroupRecord } from "../core/interchange/psd/export-plan";
import {photoshopLength} from '../core/interchange/psd/length';
import {captureRasterExportDocuments} from './raster-export-source';
import {rasterExportRows} from './raster-export-grid';
import type { DocumentRenderer } from "./renderer";
import { checkExport, type ExportControl } from "./export-control";
import { release } from "./canvas";
import {applyMaskSettings} from './masks';
import type {PhotoshopChannelEncoding} from './photoshop-strip';

interface Channels { tables: Uint8Array<ArrayBuffer>[]; data: Blob[] }
const bytes = (writer: ByteWriter) => new Uint8Array(writer.getBuffer());
function uint32(value: number): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error("This export exceeds a 32-bit Photoshop resource length.");
  const writer = new ByteWriter(); writer.writeUint32(value); return bytes(writer);
}
function header(document: DocumentData,format:PhotoshopFormat): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.writeAscii("8BPS"); writer.writeUint16(photoshopVersion(format));
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
  layer: PsdRenderedLayer|PsdRenderedMask, assets: AssetStore, renderer: DocumentRenderer,
  progress: (rows: number) => void, control: ExportControl|undefined, encoding: PhotoshopChannelEncoding,
  format:PhotoshopFormat,current:()=>void,encoder:PhotoshopEncoder,
): Promise<Channels & { preview?: Channels }> {
  const { width, height, left, top } = layer;
  const channelCount = encoding==='mask'?1:encoding === "both" ? 7 : 4;
  const rowBytes=format==='psb'?4:2;
  const tables = Array.from({ length: channelCount }, () => new Uint8Array(height * rowBytes));
  const views = tables.map(table => new DataView(table.buffer));
  const parts: Blob[][] = Array.from({ length: channelCount }, () => []);
  const rowsPerStrip = format==='psb'?rasterExportRows(width):Math.max(1, Math.min(64, Math.floor(1_000_000 / (width * 4))));
  for (let y = 0; y < height; y += rowsPerStrip) {
    current();
    const rows = Math.min(rowsPerStrip, height - y), strip = new Uint8ClampedArray(width * rows * 4);
    for (let x = 0; x < width; x += 2048) {
      current();
      const tileWidth = Math.min(2048, width - x);
      let tile:HTMLCanvasElement;
      if(encoding==='mask'){
        if(!renderer.renderMaskCoverage||!('world'in layer))throw new Error('Editable Photoshop mask export requires native mask coverage. Choose Flatten or use the native renderer.');
        const origin=layer.world.point({x:0,y:0});
        tile=await renderer.renderMaskCoverage({...layer.mask,enabled:true},{x:left+x,y:top+y,width:tileWidth,height:rows,sx:1,sy:1},origin.x,origin.y,`photoshop-mask:${layer.id}`,false,layer.world,assets);
      }else tile = await renderer.render(layer.document, assets, {
          region: { x: left + x, y: top + y, width: tileWidth, height: rows },
          cache: false, readback: true, isCancelled: () => !!control?.signal?.aborted,
        });
      try {
        current();
        if (tile.width !== tileWidth || tile.height !== rows)
          throw new Error("PSD rendering did not produce native-resolution pixels.");
        if(encoding==='mask'&&'world'in layer)applyMaskSettings(tile,layer.mask);
        const pixels = tile.getContext("2d")!.getImageData(0, 0, tileWidth, rows).data;
        for (let row = 0; row < rows; row++)
          strip.set(pixels.subarray(row * tileWidth * 4, (row + 1) * tileWidth * 4), (row * width + x) * 4);
      } finally { release(tile); }
    }
    current();
    const encodedChannels=await encoder.encode(strip,width,rows,encoding,control);
    current();
    for (let c = 0; c < channelCount; c++) {
      const channel=encodedChannels[c];
      for (let row = 0; row < rows; row++) {
        const length=channel.lengths[row];
        if (length > (rowBytes===2?0xffff:0xffffffff)) throw new Error(`A ${format.toUpperCase()} RLE scanline exceeds its length field.`);
        if(rowBytes===4)views[c].setUint32((y+row)*4,length);else views[c].setUint16((y + row) * 2,length);
      }
      parts[c].push(channel.data);
    }
    current();progress(rows);current();
    // The worker reply already provides a task boundary. Avoid a clamped timer
    // after every strip; the next worker request also leaves the UI runnable.
  }
  current();
  const data = parts.map(chunks => new Blob(chunks));
  return { tables: tables.slice(0, 4), data: data.slice(0, 4), preview: encoding === "both" ? {
    tables: [...tables.slice(4), tables[3]], data: [...data.slice(4), data[3]],
  } : undefined };
}

function layerRecord(layer: PsdRenderedLayer|PsdGroupRecord, channels: Channels,format:PhotoshopFormat,divider?:1|3,maskChannels?:Channels): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.writeInt32(layer.top); writer.writeInt32(layer.left);
  writer.writeInt32(layer.top + layer.height); writer.writeInt32(layer.left + layer.width);
  writer.writeUint16(maskChannels?5:4);
  [0, 1, 2, -1].forEach((id, index) => {
    writer.writeInt16(id);
    writer.writeBytes(photoshopLength(2 + channels.tables[index].length + channels.data[index].size,format));
  });
  if(maskChannels){writer.writeInt16(-2);writer.writeBytes(photoshopLength(2+maskChannels.tables[0].length+maskChannels.data[0].size,format));}
  writer.writeAscii("8BIM"); writer.writeAscii(layer.blendMode==='pass-through'?'norm':LUMA_TO_PSD_BLEND_MAP[layer.blendMode], 4);
  writer.writeUint8(Math.round(layer.opacity * 255)); writer.writeUint8(0);
  writer.writeUint8((layer.visible?0:2)|(divider?0x18:0)|(layer.locked?1:0)); writer.writeUint8(0);
  const extra = new ByteWriter();
  if(maskChannels&&layer.mask){const mask=layer.mask;extra.writeUint32(20);extra.writeInt32(mask.top);extra.writeInt32(mask.left);extra.writeInt32(mask.top+mask.height);extra.writeInt32(mask.left+mask.width);extra.writeUint8(0);extra.writeUint8(mask.enabled?0:2);extra.writeUint16(0);}else extra.writeUint32(0);
  extra.writeUint32(0); extra.writePascalString(layer.name, 4);
  extra.writeAscii("8BIM"); extra.writeAscii("luni");
  const name = new ByteWriter(); name.writeUnicodeString(layer.name);
  const unicode = bytes(name); extra.writeUint32(unicode.length); extra.writeBytes(unicode);
  if(divider){extra.writeAscii('8BIM');extra.writeAscii('lsct');extra.writeUint32(divider===1?12:4);extra.writeUint32(divider);if(divider===1){extra.writeAscii('8BIM');extra.writeAscii(layer.blendMode==='pass-through'?'pass':LUMA_TO_PSD_BLEND_MAP[layer.blendMode]);}}
  if(layer.locked){extra.writeAscii('8BIM');extra.writeAscii('lspf');extra.writeUint32(4);extra.writeUint32(0x80000007);}
  if((layer.fillOpacity??1)!==1){extra.writeAscii('8BIM');extra.writeAscii('iOpa');extra.writeUint32(2);extra.writeUint8(Math.round((layer.fillOpacity??1)*255));extra.writeUint8(0);}
  const data = bytes(extra); writer.writeUint32(data.length); writer.writeBytes(data);
  return bytes(writer);
}

export async function exportPsd(
  document: DocumentData, assets: AssetStore, renderer: DocumentRenderer,
  mode: PsdExportMode = "layers", control?: ExportControl,
  format:PhotoshopFormat='psd',
): Promise<Blob> {
  checkExport(control); validatePsdDimensions(document.width, document.height,format);
  const plan = planPsdExport(document, mode,format);
  if (plan.records.length > 32767) throw new Error("Photoshop output cannot represent more than 32,767 layer records.");
  const current=captureRasterExportDocuments([document,...plan.layers.map(layer=>layer.document),...plan.masks.map(mask=>mask.document)],assets,control,format.toUpperCase()+' export');
  try{
  const encoder=new PhotoshopEncoder();
  try{
  const totalRows = plan.layers.reduce((total, layer) => total + layer.height, 0)+plan.masks.reduce((total,mask)=>total+mask.height,0) + (plan.reuseComposite ? 0 : document.height);
  let completedRows = 0;
  const progress = (rows: number) => {
    current();completedRows += rows; control?.onProgress?.({ phase: "rendering", fraction: completedRows / totalRows });current();
  };
  const records: Uint8Array<ArrayBuffer>[] = [], payloads: Blob[] = [];
  let composite: Channels | undefined;
  current();control?.onProgress?.({phase:'rendering',fraction:0});current();
  for (const entry of plan.records) {
    current();const layer=entry.kind==='pixels'?entry.layer:entry.group;
    const channels=entry.kind==='pixels'?await renderChannels(entry.layer, assets, renderer, progress, control, plan.reuseComposite ? "both" : "layer",format,current,encoder):{tables:Array.from({length:4},()=>new Uint8Array(0)),data:Array.from({length:4},()=>new Blob())};
    const maskChannels=layer.mask?await renderChannels(layer.mask,assets,renderer,progress,control,'mask',format,current,encoder):undefined;
    records.push(layerRecord(layer, channels,format,entry.kind==='group'?1:entry.kind==='group-end'?3:undefined,maskChannels));
    for (let c = 0; c < 4; c++) payloads.push(new Blob([new Uint8Array([0,entry.kind==='pixels'?1:0]), channels.tables[c], channels.data[c]]));
    if(maskChannels)payloads.push(new Blob([new Uint8Array([0,1]),maskChannels.tables[0],maskChannels.data[0]]));
    if (plan.reuseComposite&&'preview'in channels) composite = channels.preview;
  }
  if (!composite) composite = await renderChannels({
    name: document.name, document, left: 0, top: 0, width: document.width, height: document.height,
    opacity: 1, blendMode: "normal", visible: true, merged: true,
  }, assets, renderer, progress, control, "preview",format,current,encoder);
  current(); control?.onProgress?.({ phase: "encoding", fraction: null });current();
  const count = new ByteWriter();
  // Negative count identifies channel four as merged transparency, per Adobe.
  count.writeInt16(-plan.records.length);
  const layerInfo = new Blob([bytes(count), ...records, ...payloads]);
  const padding = layerInfo.size % 2 ? new Uint8Array(1) : new Uint8Array(0);
  const layerAndMask = new Blob([photoshopLength(layerInfo.size + padding.length,format), layerInfo, padding, uint32(0)]);
  const blob = new Blob([
    header(document,format), photoshopLength(layerAndMask.size,format), layerAndMask,
    new Uint8Array([0, 1]), ...composite.tables, ...composite.data,
  ], { type: "image/vnd.adobe.photoshop" });
  if(format==='psd'&&blob.size>0x7fffffff)throw new Error("This output exceeds PSD's 2 GB file limit. Choose PSB or save a native project.");
  if(!Number.isSafeInteger(blob.size))throw new Error('Photoshop output exceeds exact browser addressing.');
  current();
  return blob;
  }finally{encoder.dispose();}
  }finally{current.release();}
}
