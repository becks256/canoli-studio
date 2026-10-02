import { expect, it } from "vitest";
import {
  generateDeliveryManifest,
  sanitizeFileName,
  verifyDeliveryManifest,
} from "../src/ai/batch/manifest";
import { createZipArchive } from "../src/ai/batch/zip";
import type { BatchRun } from "../src/ai/batch/types";

it("exports distinct UTF-8 paths and payloads after scalar and byte truncation", async () => {
  const names = [
    "a".repeat(179) + "😀.png",
    "a".repeat(179) + "𠀀.png",
    "界".repeat(180) + ".png",
    "界".repeat(180) + ".png",
    "bad\ud800.png",
    "bad\ud801.png",
  ];
  const run = {
    id: "unicode",
    config: { name: "Unicode" },
    items: names.map((name, i) => ({
      id: `i${i}`,
      name,
      actualCostCents: 0,
      reviewState: "approved",
      source: { sha256: "a".repeat(64) },
      deliverables: [
        {
          id: `d${i}`,
          variantName: "Small",
          fileName: name,
          format: "png",
          width: 16,
          height: 16,
          aspectRatio: "1:1",
          byteLength: 1,
          sha256: "b".repeat(64),
        },
      ],
    })),
  } as unknown as BatchRun;
  const manifest = await generateDeliveryManifest(run);
  expect((await verifyDeliveryManifest(manifest)).valid).toBe(true);
  const paths = manifest.deliverables.map((d) => d.filePath);
  const bytes = new Uint8Array(
    await createZipArchive(
      paths.map((name, i) => ({ name, data: new Uint8Array([i]) })),
    ).arrayBuffer(),
  );
  const view = new DataView(bytes.buffer),
    files = new Map<string, number[]>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const length = view.getUint16(offset + 26, true);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset + 30, offset + 30 + length),
    );
    const start = offset + 30 + length + view.getUint16(offset + 28, true);
    const end = start + view.getUint32(offset + 18, true);
    files.set(name, [...bytes.subarray(start, end)]);
    offset = end;
  }
  expect(files.size).toBe(names.length);
  paths.forEach((path, i) => {
    expect(files.get(path)).toEqual([i]);
    expect(
      new TextEncoder().encode(path.slice("deliverables/".length)).length,
    ).toBeLessThanOrEqual(184);
    expect(path.endsWith(".png")).toBe(true);
  });
  expect(sanitizeFileName("a".repeat(176) + "😀")).toBe("a".repeat(176) + "😀");
});
