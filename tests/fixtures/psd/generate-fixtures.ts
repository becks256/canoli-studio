/**
 * Generates independent, specification-compliant PSD binary test fixtures.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { buildPsd } from "../../../src/core/interchange/psd/builder";
import { ByteWriter } from "../../../src/core/interchange/psd/stream";
import {
  PsdColorMode,
  PsdCompression,
} from "../../../src/core/interchange/psd/types";
import { createDocument, createRaster } from "../../../src/core/model";

// Polyfill ImageData if needed
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  } as unknown as typeof ImageData;
}

const FIXTURE_DIR = path.resolve(process.cwd(), "tests/fixtures/psd");

async function generateFixtures() {
  console.log("Generating PSD reference fixtures in", FIXTURE_DIR);

  // 1. basic-rgb-8bit.psd (2 layers, resolution 72 DPI, embedded sRGB ICC)
  {
    const doc = createDocument("Basic RGB 8-bit", 160, 120);
    const bgImg = new ImageData(160, 120);
    for (let i = 0; i < bgImg.data.length; i += 4) {
      bgImg.data[i] = 240;
      bgImg.data[i + 1] = 240;
      bgImg.data[i + 2] = 240;
      bgImg.data[i + 3] = 255;
    }
    const bgLayer = createRaster("Background", "asset-bg", 160, 120);

    const fgImg = new ImageData(60, 40);
    for (let i = 0; i < fgImg.data.length; i += 4) {
      fgImg.data[i] = 45;
      fgImg.data[i + 1] = 120;
      fgImg.data[i + 2] = 210;
      fgImg.data[i + 3] = 230;
    }
    const fgLayer = createRaster("Blue Card", "asset-fg", 60, 40);
    fgLayer.x = 50;
    fgLayer.y = 40;
    fgLayer.blendMode = "multiply";
    fgLayer.opacity = 0.9;

    doc.children.push(bgLayer, fgLayer);

    const bytes = await buildPsd(
      doc,
      [
        { layer: bgLayer, imageData: bgImg },
        { layer: fgLayer, imageData: fgImg },
      ],
      { embedIcc: true, includeComposite: true },
    );

    fs.writeFileSync(path.join(FIXTURE_DIR, "basic-rgb-8bit.psd"), bytes);
    console.log(
      "  ✓ Generated basic-rgb-8bit.psd (" + bytes.length + " bytes)",
    );
  }

  // 2. cmyk-unsupported.psd
  {
    const writer = new ByteWriter();
    writer.writeAscii("8BPS");
    writer.writeUint16(1); // Version 1
    for (let i = 0; i < 6; i++) writer.writeUint8(0);
    writer.writeUint16(4); // 4 channels: C, M, Y, K
    writer.writeUint32(80); // height
    writer.writeUint32(80); // width
    writer.writeUint16(8); // 8-bit
    writer.writeUint16(PsdColorMode.CMYK); // CMYK
    writer.writeUint32(0); // Color mode data length
    writer.writeUint32(0); // Resources length
    writer.writeUint32(0); // Layer mask length
    writer.writeUint16(PsdCompression.Raw); // Composite compression
    // 4 planes * 80 * 80 bytes
    for (let i = 0; i < 4 * 80 * 80; i++) {
      writer.writeUint8(i % 256);
    }

    const bytes = writer.getBuffer();
    fs.writeFileSync(path.join(FIXTURE_DIR, "cmyk-unsupported.psd"), bytes);
    console.log(
      "  ✓ Generated cmyk-unsupported.psd (" + bytes.length + " bytes)",
    );
  }

  // 3. 16bit-gradient.psd
  {
    const writer = new ByteWriter();
    writer.writeAscii("8BPS");
    writer.writeUint16(1);
    for (let i = 0; i < 6; i++) writer.writeUint8(0);
    writer.writeUint16(3); // 3 channels: R, G, B
    writer.writeUint32(64);
    writer.writeUint32(64);
    writer.writeUint16(16); // 16-bit depth
    writer.writeUint16(PsdColorMode.RGB);
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeUint16(PsdCompression.Raw);
    // 3 planes * 64 * 64 * 2 bytes = 24576 bytes
    for (let i = 0; i < 3 * 64 * 64 * 2; i++) {
      writer.writeUint8((i * 7) % 256);
    }

    const bytes = writer.getBuffer();
    fs.writeFileSync(path.join(FIXTURE_DIR, "16bit-gradient.psd"), bytes);
    console.log(
      "  ✓ Generated 16bit-gradient.psd (" + bytes.length + " bytes)",
    );
  }

  console.log("Fixture generation complete.");
}

generateFixtures().catch((err) => {
  console.error("Fixture generation failed:", err);
  process.exit(1);
});
