import { describe, expect, it } from "vitest";
import { Document, RasterLayer } from "../src/dom";
import { readProject, serializeProject } from "../src/core/project";

function fixture() {
  const document = new Document({ width: 10000, height: 5000 });
  document.layers.add(
    new RasterLayer({ assetId: "original", width: 10000, height: 5000 }),
  );
  const asset = {
    id: "original",
    name: "Original",
    width: 10000,
    height: 5000,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], {
      type: "image/png",
    }),
  };
  return { document: document.toJSON(), asset, source: { get: () => asset } };
}

describe("binary project container", () => {
  it("preserves original bytes and geometry without base64", async () => {
    const { document, asset, source } = fixture();
    const file = await serializeProject(document, source);
    const result = await readProject(file);
    expect(result.document).toEqual(document);
    expect(result.entries[0].width).toBe(10000);
    expect(await result.entries[0].blob.arrayBuffer()).toEqual(
      await asset.blob.arrayBuffer(),
    );
    expect((await file.text()).includes("dataUrl")).toBe(false);
  });
  it("reads legacy v1 projects", async () => {
    const { document } = fixture();
    const result = await readProject(
      new Blob([
        JSON.stringify({
          format: "luma",
          version: 1,
          document,
          assets: [
            {
              id: "original",
              name: "Original",
              width: 10000,
              height: 5000,
              dataUrl: "data:image/png;base64,iVBORwECAwQ=",
            },
          ],
        }),
      ]),
    );
    expect(result.document).toEqual(document);
    expect([
      ...new Uint8Array(await result.entries[0].blob.arrayBuffer()),
    ]).toEqual([137, 80, 78, 71, 1, 2, 3, 4]);
  });
  it("rejects truncated headers, manifests and assets and trailing bytes", async () => {
    const { document, source } = fixture();
    const file = await serializeProject(document, source);
    for (const size of [8, 15, 18, file.size - 1])
      await expect(readProject(file.slice(0, size))).rejects.toThrow();
    await expect(readProject(new Blob([file, "extra"]))).rejects.toThrow(
      /Unexpected/,
    );
  });
  it("rejects duplicate IDs, missing assets and overlapping offsets", async () => {
    const { document, source } = fixture();
    const file = await serializeProject(document, source);
    const header = new Uint8Array(await file.slice(0, 48).arrayBuffer());
    const length = Number(new DataView(header.buffer).getBigUint64(8, true));
    const original = JSON.parse(await file.slice(48, 48 + length).text());
    for (const mode of ["duplicate", "missing", "offset"]) {
      const manifest = structuredClone(original);
      if (mode === "duplicate") manifest.assets.push(manifest.assets[0]);
      if (mode === "missing") manifest.assets[0].id = "other";
      if (mode === "offset") manifest.assets[0].offset = -1;
      const json = new TextEncoder().encode(JSON.stringify(manifest));
      new DataView(header.buffer).setBigUint64(8, BigInt(json.length), true);
      header.set(
        new Uint8Array(await crypto.subtle.digest("SHA-256", json)),
        16,
      );
      await expect(
        readProject(new Blob([header, json, file.slice(48 + length)])),
      ).rejects.toThrow();
    }
  });
});

it("detects changed manifest and image bytes independently", async () => {
  const { document, source } = fixture();
  const file = await serializeProject(document, source);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const damagedManifest = bytes.slice();
  damagedManifest[60] ^= 1;
  await expect(readProject(new Blob([damagedManifest]))).rejects.toThrow(
    "manifest checksum mismatch",
  );
  const damagedAsset = bytes.slice();
  damagedAsset[damagedAsset.length - 1] ^= 1;
  await expect(readProject(new Blob([damagedAsset]))).rejects.toThrow(
    "asset checksum mismatch",
  );
});

it("reads v2 containers and resaves their source bytes as v3", async () => {
  const { document, source, asset } = fixture();
  const modern = await serializeProject(document, source);
  const header = new Uint8Array(await modern.slice(0, 16).arrayBuffer());
  const length = Number(new DataView(header.buffer).getBigUint64(8, true));
  const manifest = JSON.parse(await modern.slice(48, 48 + length).text());
  manifest.version = 2;
  delete manifest.assets[0].sha256;
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  header[4] = 50;
  new DataView(header.buffer).setBigUint64(8, BigInt(json.length), true);
  const old = await readProject(new Blob([header, json, asset.blob]));
  expect(old.document).toEqual(document);
  const next = await serializeProject(old.document, {
    get: () => old.entries[0],
  });
  expect(new Uint8Array(await next.slice(0, 8).arrayBuffer())[4]).toBe(51);
  expect(await (await readProject(next)).entries[0].blob.arrayBuffer()).toEqual(
    await asset.blob.arrayBuffer(),
  );
});

it("captures a coherent snapshot before asynchronous hashing", async () => {
  const { document, source } = fixture();
  const before = structuredClone(document);
  const saving = serializeProject(document, source);
  document.name = "Changed after save began";
  expect((await readProject(await saving)).document).toEqual(before);
});

it("workspace containers include history-only sources once while ordinary projects omit history", async () => {
  const { document, asset, source } = fixture();
  const current = structuredClone(document);
  current.children = [];
  const entry = { document, label: "Remove image", canvasChanged: false };
  const history = { version: 1 as const, past: [entry], future: [entry] };
  const file = await serializeProject(current, source, history);
  const restored = await readProject(file);
  expect(restored.history).toEqual(history);
  expect(restored.entries).toHaveLength(1);
  expect(await restored.entries[0].blob.arrayBuffer()).toEqual(
    await asset.blob.arrayBuffer(),
  );
  const ordinary = await readProject(await serializeProject(current, source));
  expect(ordinary.history).toBeUndefined();
  expect(ordinary.entries).toHaveLength(0);
  await expect(
    serializeProject(
      current,
      {
        get: () => {
          throw new Error("Missing source");
        },
      },
      history,
    ),
  ).rejects.toThrow();
});

async function rewriteManifest(
  file: Blob,
  mutate: (manifest: any) => void,
): Promise<Blob> {
  const header = new Uint8Array(await file.slice(0, 48).arrayBuffer());
  const length = Number(new DataView(header.buffer).getBigUint64(8, true));
  const manifest = JSON.parse(await file.slice(48, 48 + length).text());
  mutate(manifest);
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  new DataView(header.buffer).setBigUint64(8, BigInt(bytes.length), true);
  header.set(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), 16);
  return new Blob([header, bytes, file.slice(48 + length)]);
}

it("rejects valid-checksum containers with invalid history or missing historical image references", async () => {
  const { document, source } = fixture();
  const current = structuredClone(document);
  current.children = [];
  const file = await serializeProject(current, source, {
    version: 1,
    past: [],
    future: [{ document, label: "Import", canvasChanged: false }],
  });
  const missing = await rewriteManifest(file, (manifest) => {
    manifest.history.future[0].document.children[0].assetId = "missing";
  });
  await expect(readProject(missing)).rejects.toThrow(
    "Missing history image asset",
  );
  const invalid = await rewriteManifest(file, (manifest) => {
    manifest.history.future[0].document.width = -1;
  });
  await expect(readProject(invalid)).rejects.toThrow();
  const bytes = new Uint8Array(await file.arrayBuffer());
  bytes[60] ^= 1;
  await expect(readProject(new Blob([bytes]))).rejects.toThrow(
    "manifest checksum mismatch",
  );
});

it("refuses to certify a linked snapshot whose digest, length or geometry differs from its cached asset", async () => {
  const { document, asset, source } = fixture();
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await asset.blob.arrayBuffer()),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  document.components = [
    {
      id: "linked",
      name: "Linked",
      source: {
        kind: "asset",
        assetId: asset.id,
        width: asset.width,
        height: asset.height,
        link: {
          kind: "local-file",
          name: "original.png",
          sha256,
          byteLength: asset.blob.size,
          lastModified: 123,
        },
      },
    },
  ];
  await expect(serializeProject(document, source)).resolves.toBeInstanceOf(
    Blob,
  );
  for (const patch of [
    { sha256: "0".repeat(64) },
    { byteLength: asset.blob.size + 1 },
  ]) {
    const invalid = structuredClone(document),
      linked = invalid.components![0].source;
    if (linked.kind !== "asset") throw new Error("Expected asset");
    Object.assign(linked.link!, patch);
    await expect(serializeProject(invalid, source)).rejects.toThrow(
      /fingerprint/,
    );
  }
  const linked = document.components[0].source;
  if (linked.kind !== "asset") throw new Error("Expected asset");
  linked.width++;
  await expect(serializeProject(document, source)).rejects.toThrow(
    /fingerprint/,
  );
});

it("preserves long asset display names in current and legacy containers", async () => {
  const { document, asset, source } = fixture();
  asset.name = "界".repeat(245) + ".png";
  const current = await readProject(await serializeProject(document, source));
  expect(current.entries[0].name).toBe(asset.name);
  expect(await current.entries[0].blob.arrayBuffer()).toEqual(
    await asset.blob.arrayBuffer(),
  );
  const legacy = await readProject(
    new Blob([
      JSON.stringify({
        format: "luma",
        version: 1,
        document,
        assets: [
          {
            id: asset.id,
            name: asset.name,
            width: asset.width,
            height: asset.height,
            dataUrl: "data:image/png;base64,iVBORwECAwQ=",
          },
        ],
      }),
    ]),
  );
  expect(legacy.entries[0].name).toBe(asset.name);
});
