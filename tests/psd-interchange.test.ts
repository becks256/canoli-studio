import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodePackBits,
  encodePackBits,
} from "../src/core/interchange/psd/packbits";
import {
  parsePsd,
  getPsdCapabilityReport,
} from "../src/core/interchange/psd/parser";
import { buildPsd } from "../src/core/interchange/psd/builder";
import {
  documentToPsd,
  psdToDocument,
} from "../src/core/interchange/psd/bridge";
import {
  PsdColorMode,
  PsdCompression,
} from "../src/core/interchange/psd/types";
import {
  createDocument,
  createRaster,
  type RasterLayerData,
} from "../src/core/model";
import { ByteWriter } from "../src/core/interchange/psd/stream";

// Polyfill ImageData for test environment if missing
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
    constructor(arg1: number | Uint8ClampedArray, arg2: number, arg3?: number) {
      if (typeof arg1 === "number") {
        this.width = arg1;
        this.height = arg2;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = arg1;
        this.width = arg2;
        this.height = arg3 ?? arg1.length / (arg2 * 4);
      }
    }
  } as unknown as typeof ImageData;
}

describe("PSD / PSB Interchange Engine (F11)", () => {
  describe("Apple PackBits RLE codec", () => {
    it("encodes and decodes literal byte sequences", () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encoded = encodePackBits(original);
      const decoded = decodePackBits(encoded, original.length);
      expect(decoded).toEqual(original);
    });

    it("compresses repetitive runs of identical bytes", () => {
      const original = new Uint8Array(64).fill(42);
      const encoded = encodePackBits(original);
      // PackBits repeat packet is 2 bytes: count (-63) + value (42)
      expect(encoded.length).toBe(2);
      const decoded = decodePackBits(encoded, original.length);
      expect(decoded).toEqual(original);
    });

    it("encodes and decodes mixed literal and run patterns", () => {
      const original = new Uint8Array([
        10,
        20,
        30, // 3 literals
        99,
        99,
        99,
        99,
        99, // 5 repeats
        1,
        2, // 2 literals
        7,
        7,
        7,
        7, // 4 repeats
      ]);
      const encoded = encodePackBits(original);
      const decoded = decodePackBits(encoded, original.length);
      expect(decoded).toEqual(original);
    });
  });

  describe("PSD binary serialization and parser", () => {
    it("builds a valid 8BPS header and parses it back", async () => {
      const doc = createDocument("Test Doc", 400, 300);
      const psdBytes = await buildPsd(doc, [], { embedIcc: true });

      expect(psdBytes.length).toBeGreaterThan(100);

      const parsed = parsePsd(psdBytes);
      expect(parsed.header.signature).toBe("8BPS");
      expect(parsed.header.version).toBe(1);
      expect(parsed.header.width).toBe(400);
      expect(parsed.header.height).toBe(300);
      expect(parsed.header.depth).toBe(8);
      expect(parsed.header.colorMode).toBe(PsdColorMode.RGB);
      expect(parsed.header.channels).toBe(4);

      // Verify embedded resolution info and ICC profile
      expect(parsed.resolution?.hRes).toBe(72);
      expect(parsed.resolution?.vRes).toBe(72);
      expect(parsed.iccProfile).toBeDefined();
    });

    it("round-trips multi-layer document with bounds, opacity, and blend modes", async () => {
      const doc = createDocument("Multi-Layer Project", 200, 150);

      // Layer 1: Background red rectangle
      const img1 = new ImageData(200, 150);
      for (let i = 0; i < img1.data.length; i += 4) {
        img1.data[i] = 220; // R
        img1.data[i + 1] = 20; // G
        img1.data[i + 2] = 60; // B
        img1.data[i + 3] = 255; // A
      }
      const layer1 = createRaster("Red Background", "asset-1", 200, 150);
      layer1.x = 0;
      layer1.y = 0;
      layer1.opacity = 1;
      layer1.blendMode = "normal";
      layer1.visible = true;

      // Layer 2: Overlay blue patch at (20, 30) of size 80x60 with multiply blend
      const img2 = new ImageData(80, 60);
      for (let i = 0; i < img2.data.length; i += 4) {
        img2.data[i] = 30;
        img2.data[i + 1] = 144;
        img2.data[i + 2] = 255;
        img2.data[i + 3] = 200; // Semi-transparent
      }
      const layer2 = createRaster("Blue Patch", "asset-2", 80, 60);
      layer2.x = 20;
      layer2.y = 30;
      layer2.opacity = 0.75;
      layer2.blendMode = "multiply";
      layer2.visible = true;

      doc.children.push(layer1);
      doc.children.push(layer2);

      const assets = new Map<string, ImageData>([
        ["asset-1", img1],
        ["asset-2", img2],
      ]);

      // Export to PSD bytes
      const psdBytes = await documentToPsd(doc, (id) => assets.get(id) ?? null);
      expect(psdBytes.length).toBeGreaterThan(500);

      // Import PSD back into Luma Document
      const importResult = psdToDocument(psdBytes, { mode: "layered" });
      const importedDoc = importResult.document;

      expect(importedDoc.width).toBe(200);
      expect(importedDoc.height).toBe(150);
      expect(importedDoc.children.length).toBe(2);

      const importedLayer1 = importedDoc.children[0] as RasterLayerData;
      expect(importedLayer1.name).toBe("Red Background");
      expect(importedLayer1.x).toBe(0);
      expect(importedLayer1.y).toBe(0);
      expect(importedLayer1.width).toBe(200);
      expect(importedLayer1.height).toBe(150);
      expect(importedLayer1.opacity).toBeCloseTo(1.0, 2);
      expect(importedLayer1.blendMode).toBe("normal");

      const importedLayer2 = importedDoc.children[1] as RasterLayerData;
      expect(importedLayer2.name).toBe("Blue Patch");
      expect(importedLayer2.x).toBe(20);
      expect(importedLayer2.y).toBe(30);
      expect(importedLayer2.width).toBe(80);
      expect(importedLayer2.height).toBe(60);
      expect(importedLayer2.opacity).toBeCloseTo(0.75, 2);
      expect(importedLayer2.blendMode).toBe("multiply");

      // Verify pixel data preservation in asset store
      const restoredImg2 = importResult.assets.get(importedLayer2.assetId);
      expect(restoredImg2).toBeDefined();
      expect(restoredImg2!.width).toBe(80);
      expect(restoredImg2!.height).toBe(60);
      expect(restoredImg2!.data[0]).toBe(30);
      expect(restoredImg2!.data[1]).toBe(144);
      expect(restoredImg2!.data[2]).toBe(255);
      expect(restoredImg2!.data[3]).toBe(200);
    });

    it("imports PSD in flatten mode to single composite layer", async () => {
      const doc = createDocument("Composite Test", 100, 100);
      const img = new ImageData(100, 100);
      img.data.fill(128);
      const layer = createRaster("Layer 1", "asset-1", 100, 100);
      doc.children.push(layer);

      const psdBytes = await documentToPsd(doc, () => img, {
        includeComposite: true,
      });

      const importResult = psdToDocument(psdBytes, { mode: "flatten" });
      expect(importResult.document.children.length).toBe(1);
      expect(importResult.document.children[0].name).toBe("Background");
    });
  });

  describe("Capability reporting and unsupported construct detection", () => {
    it("reports warnings and degradation for unsupported CMYK color mode", () => {
      // Construct a minimal CMYK PSD header
      const writer = new ByteWriter();
      writer.writeAscii("8BPS");
      writer.writeUint16(1); // Version 1
      for (let i = 0; i < 6; i++) writer.writeUint8(0);
      writer.writeUint16(4); // 4 channels
      writer.writeUint32(100); // height
      writer.writeUint32(100); // width
      writer.writeUint16(8); // 8-bit
      writer.writeUint16(PsdColorMode.CMYK); // CMYK
      writer.writeUint32(0); // Color mode data length
      writer.writeUint32(0); // Resources length
      writer.writeUint32(0); // Layer mask length
      writer.writeUint16(PsdCompression.Raw); // Composite compression
      for (let i = 0; i < 40000; i++) writer.writeUint8(0); // 4 channels * 100 * 100

      const cmykBytes = writer.getBuffer();
      const parsed = parsePsd(cmykBytes);
      const report = getPsdCapabilityReport(parsed);

      expect(report.colorMode).toBe("CMYK");
      expect(report.warnings.some((w) => w.includes("CMYK"))).toBe(true);
      expect(report.degradedFeatures.some((d) => d.includes("CMYK"))).toBe(
        true,
      );
    });

    it("reports warning when encountering 16-bit depth channels", () => {
      const writer = new ByteWriter();
      writer.writeAscii("8BPS");
      writer.writeUint16(1);
      for (let i = 0; i < 6; i++) writer.writeUint8(0);
      writer.writeUint16(3);
      writer.writeUint32(50);
      writer.writeUint32(50);
      writer.writeUint16(16); // 16-bit depth
      writer.writeUint16(PsdColorMode.RGB);
      writer.writeUint32(0);
      writer.writeUint32(0);
      writer.writeUint32(0);
      writer.writeUint16(PsdCompression.Raw);

      const psd16Bytes = writer.getBuffer();
      const parsed = parsePsd(psd16Bytes);
      const report = getPsdCapabilityReport(parsed);

      expect(report.bitDepth).toBe(16);
      expect(report.warnings.some((w) => w.includes("16-bit"))).toBe(true);
      expect(
        report.degradedFeatures.some((d) =>
          d.toLowerCase().includes("quantiz"),
        ),
      ).toBe(true);
    });
  });

  describe("Independent PSD Disk Fixtures", () => {
    it("loads and parses basic-rgb-8bit.psd fixture with layer fidelity", () => {
      const filePath = path.resolve(
        process.cwd(),
        "tests/fixtures/psd/basic-rgb-8bit.psd",
      );
      const buffer = fs.readFileSync(filePath);
      const res = psdToDocument(buffer, { mode: "layered" });

      expect(res.document.width).toBe(160);
      expect(res.document.height).toBe(120);
      expect(res.document.children.length).toBe(2);
      expect(res.report.canImportAsLayers).toBe(true);
      expect(res.report.hasIccProfile).toBe(true);
    });

    it("evaluates cmyk-unsupported.psd fixture with warnings and composite fallback", () => {
      const filePath = path.resolve(
        process.cwd(),
        "tests/fixtures/psd/cmyk-unsupported.psd",
      );
      const buffer = fs.readFileSync(filePath);
      const res = psdToDocument(buffer);

      expect(res.report.colorMode).toBe("CMYK");
      expect(res.report.warnings.some((w) => w.includes("CMYK"))).toBe(true);
    });

    it("evaluates 16bit-gradient.psd fixture with quantization warning", () => {
      const filePath = path.resolve(
        process.cwd(),
        "tests/fixtures/psd/16bit-gradient.psd",
      );
      const buffer = fs.readFileSync(filePath);
      const res = psdToDocument(buffer);

      expect(res.report.bitDepth).toBe(16);
      expect(res.report.warnings.some((w) => w.includes("16-bit"))).toBe(true);
    });
  });
});

it.each(['raw', 'rle'] as const)('honors %s compression with straight layer RGBA and a white-matted merged preview', async(compression)=>{
  const doc=createDocument('Compression',3,2);
  const layer=createRaster('source','Pixels',3,2);
  doc.children.push(layer);
  const pixels=new ImageData(new Uint8ClampedArray([
    255,0,0,255, 0,255,0,128, 0,0,255,255,
    12,34,56,255, 78,90,123,64, 210,180,150,255,
  ]),3,2);
  const bytes=await documentToPsd(doc,()=>pixels,{compression});
  // Walk the three length-prefixed sections after the fixed PSD header.
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let offset=26;
  for(let section=0;section<3;section++)offset+=4+view.getUint32(offset);
  expect(view.getUint16(offset)).toBe(compression==='raw'?PsdCompression.Raw:PsdCompression.Rle);
  const parsed=parsePsd(bytes);
  // 8-bit white matting quantizes the merged preview at partial alpha; the
  // independent-reader regression checks the stored white-matted channels too.
  const preview=new Uint8ClampedArray([
    255,0,0,255, 0,255,0,128, 0,0,255,255,
    12,34,56,255, 80,92,124,64, 210,180,150,255,
  ]);
  expect(parsed.composite!.data).toEqual(preview);
  expect([...parsed.layers[0].imageData!.data]).toEqual([...pixels.data]);
  const flat=psdToDocument(bytes,{mode:'flatten'});
  expect([...flat.assets.values()][0].data).toEqual(preview);
});

it('retains legacy positive-count straight-alpha files while rejecting unrendered rich content',async()=>{
  const doc=createDocument('Legacy',1,1),layer=createRaster('Source','source',1,1);doc.children=[layer];
  const source=new ImageData(new Uint8ClampedArray([80,120,150,128]),1,1);
  const bytes=await documentToPsd(doc,()=>source,{compression:'raw'});
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let section=26;
  for(let i=0;i<2;i++)section+=4+view.getUint32(section);
  expect(view.getInt16(section+8)).toBe(-1);
  view.setInt16(section+8,1); // Legacy writer did not flag or white-matte transparency.
  const composite=section+4+view.getUint32(section)+2;
  bytes.set(source.data,composite); // One-pixel planar RGBA has the same byte order.
  // Recreate the old writer's exact section layout (no global-mask length).
  const end=section+4+view.getUint32(section),legacy=new Uint8Array(bytes.length-4);
  legacy.set(bytes.subarray(0,end-4));legacy.set(bytes.subarray(end),end-4);
  new DataView(legacy.buffer).setUint32(section,view.getUint32(section)-4);
  expect(parsePsd(legacy).composite!.data).toEqual(source.data);
  expect(parsePsd(legacy,{legacyStraightAlpha:false}).composite!.data[3]).toBe(255);
  // A standard positive-count file may reuse Canoli's ICC profile without using
  // its old container layout. Its extra alpha channel must not hide the image.
  expect(parsePsd(bytes).composite!.data[3]).toBe(255);
  layer.effects=[{id:'tone',kind:'tone',enabled:true,exposure:1,contrast:0,saturation:0}];
  await expect(documentToPsd(doc,()=>source)).rejects.toThrow(/rendered PSD export/);
  layer.effects=[];layer.width=2;
  await expect(documentToPsd(doc,()=>source)).rejects.toThrow(/Scaled raster/);
  layer.width=1;await expect(documentToPsd(doc,()=>null)).rejects.toThrow(/Missing image/);
});

it('imports independent psd-tools transparency and separate-alpha fixtures without confusing extra channels',()=>{
  const bytes=fs.readFileSync('tests/fixtures/psd/psd-tools-transparency.psd');
  const parsed=parsePsd(bytes);
  expect(parsed.layers.map(layer=>layer.name)).toEqual(['Base transparency','Top','Hidden']);
  expect([...parsed.layers[0].imageData!.data.slice(0,4)]).toEqual([80,120,150,128]);
  expect([...parsed.composite!.data.slice(0,4)]).toEqual([80,120,149,128]);
  expect([...parsed.composite!.data.slice(8,12)]).toEqual([200,30,60,255]);
  const layered=psdToDocument(bytes,{mode:'layered'});
  expect(layered.document.children).toHaveLength(3);expect(layered.document.children[2].visible).toBe(false);
  const opaque=fs.readFileSync('tests/fixtures/psd/psd-tools-extra-alpha.psd');
  expect([...parsePsd(opaque).composite!.data.slice(0,4)]).toEqual([30,100,210,255]);
  expect([...parsePsd(opaque,{legacyStraightAlpha:true}).composite!.data.slice(0,4)]).toEqual([30,100,210,0]);
  expect([...psdToDocument(opaque,{mode:'flatten',legacyStraightAlpha:true}).assets.values()][0].data[3]).toBe(0);
});
