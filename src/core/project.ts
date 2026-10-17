import { freezeOwnedData } from "./immutable";
import { AssetStore } from "./assets";
import type { SerializedAsset, ImageAsset } from "./assets";
import { allLayers, referencedAssets, validateDocument, validateDocumentCooperatively } from "./model";
import type { DocumentData } from "./model";
import { parseRetainedHistory, type RetainedHistory } from "./history";
import {tiffDecodeOptionsSchema,type TiffDecodeSettings} from './interchange/tiff/types';

interface ProjectFile {
  format: "luma";
  version: 1;
  document: DocumentData;
  assets: SerializedAsset[];
}

// Container v3 adds a SHA-256 manifest digest and per-asset checksums.
// v2 remains readable; document schema versions are independent.
const MAGIC = new Uint8Array([76, 85, 77, 65, 50, 13, 10, 0]);
interface BinaryAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  type: string;
  size: number;
  offset: number;
  sha256?: string;
  tiff?: TiffDecodeSettings;
}
interface BinaryManifest {
  format: "luma";
  version: 2 | 3;
  document: DocumentData;
  assets: BinaryAsset[];
  history?: RetainedHistory;
}
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
async function hashBlob(blob: Blob): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
}
function verifyLinkedSnapshots(
  documents: DocumentData[],
  entries: BinaryAsset[],
): void {
  const assets = new Map(entries.map((entry) => [entry.id, entry]));
  for (const document of documents)
    for (const definition of document.components ?? []) {
      const source = definition.source;
      if (source.kind !== "asset" || !source.link) continue;
      const asset = assets.get(source.assetId);
      if (
        !asset ||
        asset.sha256 !== source.link.sha256 ||
        asset.size !== source.link.byteLength ||
        asset.width !== source.width ||
        asset.height !== source.height
      )
        throw new Error(
          `Linked source snapshot does not match its recorded fingerprint: ${source.link.name}`,
        );
    }
}
export interface ProjectAssetSource {
  get(
    id: string,
  ): Pick<ImageAsset, "id" | "name" | "width" | "height" | "blob" | "tiff">;
}
export async function serializeProject(
  document: DocumentData,
  assets: ProjectAssetSource,
  retainedHistory?: RetainedHistory,
): Promise<Blob> {
  validateDocument(document);
  document = structuredClone(document);
  const history =
    retainedHistory === undefined
      ? undefined
      : parseRetainedHistory(retainedHistory, document);
  const assetIds = new Set(referencedAssets(document));
  for (const entry of [...(history?.past ?? []), ...(history?.future ?? [])]) {
    for (const assetId of referencedAssets(entry.document))
      assetIds.add(assetId);
  }
  const entries: BinaryAsset[] = [];
  const blobs: Blob[] = [];
  let offset = 0;
  for (const assetId of assetIds) {
    const asset = assets.get(assetId);
    entries.push({
      id: asset.id,
      name: asset.name,
      width: asset.width,
      height: asset.height,
      type: asset.blob.type,
      size: asset.blob.size,
      offset,
      ...(asset.tiff?{tiff:tiffDecodeOptionsSchema.parse(asset.tiff)}:{}),
    });
    blobs.push(asset.blob);
    offset += asset.blob.size;
    if (!Number.isSafeInteger(offset))
      throw new Error("Project size exceeds safely representable offsets.");
  }
  for (let i = 0; i < entries.length; i++)
    entries[i].sha256 = await hashBlob(blobs[i]);
  verifyLinkedSnapshots(
    [
      document,
      ...(history?.past ?? []).map((entry) => entry.document),
      ...(history?.future ?? []).map((entry) => entry.document),
    ],
    entries,
  );
  const manifest: BinaryManifest = {
    format: "luma",
    version: 3,
    document,
    assets: entries,
    ...(history ? { history } : {}),
  };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const header = new Uint8Array(48);
  header.set(MAGIC);
  header[4] = 51;
  header.set(new Uint8Array(await crypto.subtle.digest("SHA-256", json)), 16);
  new DataView(header.buffer).setBigUint64(8, BigInt(json.byteLength), true);
  // Blob parts avoid full-source base64 strings and document-sized byte arrays.
  return new Blob([header, json, ...blobs], { type: "application/x-luma" });
}

/** Internal editing preparation is opt-in; ordinary readers retain mutable owned data. */
export async function readProject(file: Blob, options: { prepareImmutable?: boolean } = {}): Promise<{
  document: DocumentData;
  history?: RetainedHistory;
  entries: {
    id: string;
    name: string;
    width: number;
    height: number;
    blob: Blob;
    tiff?:TiffDecodeSettings;
  }[];
}> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const version3 =
    header[4] === 51 &&
    MAGIC.every((value, index) => index === 4 || header[index] === value);
  const headerSize = version3 ? 48 : 16;
  if (!version3 && !MAGIC.every((value, index) => header[index] === value)) {
    const legacy = parseProject(await file.text());
    const entries = await Promise.all(
      legacy.assets.map(async (entry) => ({
        id: entry.id,
        name: entry.name,
        width: entry.width,
        height: entry.height,
        blob: await (await fetch(entry.dataUrl)).blob(),
      })),
    );
    if (options.prepareImmutable) {
      await freezeOwnedData(legacy.document);
      await validateDocumentCooperatively(legacy.document);
    }
    return { document: legacy.document, entries };
  }
  if (header.byteLength !== 16)
    throw new Error("Truncated Canoli Studio project header.");
  const length = Number(new DataView(header.buffer).getBigUint64(8, true));
  if (
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > file.size - headerSize
  )
    throw new Error("Invalid or truncated project manifest.");
  const manifestBytes = await file
    .slice(headerSize, headerSize + length)
    .arrayBuffer();
  if (version3) {
    const expected = hex(await file.slice(16, 48).arrayBuffer());
    const actual = hex(await crypto.subtle.digest("SHA-256", manifestBytes));
    if (expected !== actual)
      throw new Error("Project manifest checksum mismatch.");
  }
  const manifest: BinaryManifest = JSON.parse(
    new TextDecoder().decode(manifestBytes),
  );
  if (
    !manifest ||
    manifest.format !== "luma" ||
    manifest.version !== (version3 ? 3 : 2) ||
    !Array.isArray(manifest.assets)
  )
    throw new Error("Unsupported project manifest.");
  if (options.prepareImmutable) {
    await freezeOwnedData(manifest.document);
    await validateDocumentCooperatively(manifest.document);
  } else validateDocument(manifest.document);
  if (manifest.history !== undefined && !version3)
    throw new Error(
      "Retained history requires a checksummed project container.",
    );
  const history =
    manifest.history === undefined
      ? undefined
      : parseRetainedHistory(manifest.history, manifest.document);
  let offset = 0;
  const ids = new Set<string>();
  const entries = manifest.assets.map((entry) => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !entry.id ||
      entry.id.length > 240 ||
      ids.has(entry.id) ||
      typeof entry.name !== "string" ||
      !Number.isSafeInteger(entry.width) ||
      entry.width < 1 ||
      !Number.isSafeInteger(entry.height) ||
      entry.height < 1 ||
      !["image/png", "image/jpeg", "image/webp", "image/tiff"].includes(entry.type) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      entry.offset !== offset ||
      !Number.isSafeInteger(offset + entry.size) ||
      offset + entry.size > file.size - headerSize - length
    )
      throw new Error("Invalid, duplicate or truncated project asset.");
    if (
      version3 &&
      (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256))
    )
      throw new Error("Missing or invalid project asset checksum.");
    ids.add(entry.id);
    if(entry.tiff!==undefined&&entry.type!=='image/tiff')throw new Error('TIFF settings on a non-TIFF project asset.');
    const tiff=entry.type==='image/tiff'?tiffDecodeOptionsSchema.parse(entry.tiff??{}):undefined;
    const blob = file.slice(
      headerSize + length + offset,
      headerSize + length + offset + entry.size,
      entry.type,
    );
    offset += entry.size;
    return {
      id: entry.id,
      name: entry.name,
      width: entry.width,
      height: entry.height,
      blob,
      ...(tiff?{tiff}:{}),
    };
  });
  if (offset !== file.size - headerSize - length)
    throw new Error("Unexpected data after project assets.");
  for (const assetId of referencedAssets(manifest.document))
    if (!ids.has(assetId)) throw new Error(`Missing image asset: ${assetId}`);
  for (const entry of [...(history?.past ?? []), ...(history?.future ?? [])]) {
    for (const assetId of referencedAssets(entry.document))
      if (!ids.has(assetId))
        throw new Error(`Missing history image asset: ${assetId}`);
  }
  if (version3) {
    for (let i = 0; i < entries.length; i++)
      if ((await hashBlob(entries[i].blob)) !== manifest.assets[i].sha256)
        throw new Error(`Project asset checksum mismatch: ${entries[i].name}`);
  }
  return {
    document: manifest.document,
    entries,
    ...(history ? { history } : {}),
  };
}

export function parseProject(text: string): ProjectFile {
  const project = JSON.parse(text) as ProjectFile;
  if (
    !project ||
    project.format !== "luma" ||
    project.version !== 1 ||
    !Array.isArray(project.assets)
  ) {
    throw new Error(
      "Unsupported project. Choose a .luma file saved by this editor.",
    );
  }
  validateDocument(project.document);
  const ids = new Set<string>();
  for (const asset of project.assets) {
    if (
      !asset ||
      typeof asset.id !== "string" ||
      !asset.id ||
      asset.id.length > 240 ||
      ids.has(asset.id) ||
      typeof asset.name !== "string" ||
      !Number.isSafeInteger(asset.width) ||
      !Number.isSafeInteger(asset.height) ||
      asset.width < 1 ||
      asset.height < 1 ||
      typeof asset.dataUrl !== "string" ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(
        asset.dataUrl,
      )
    ) {
      throw new Error(
        "Invalid embedded image. Projects only accept local PNG, JPEG, and WebP data.",
      );
    }
    ids.add(asset.id);
  }
  for (const assetId of referencedAssets(project.document))
    if (!ids.has(assetId)) throw new Error(`Missing image asset: ${assetId}`);
  return project;
}

export async function loadProject(
  input: string | Blob,
  options: { prepareImmutable?: boolean } = {},
): Promise<{
  document: DocumentData;
  assets: AssetStore;
  history?: RetainedHistory;
}> {
  const project = await readProject(
    typeof input === "string" ? new Blob([input]) : input,
    options,
  );
  const assets = new AssetStore();
  const rasterAssets = new Set(
    allLayers(project.document.children)
      .filter((layer) => layer.kind === "raster")
      .map((layer) => layer.assetId),
  );
  try {
    for (const entry of project.entries) {
      const asset = await assets.add(
        entry.blob,
        entry.name,
        entry.id,
        rasterAssets.has(entry.id),
        {tiff:entry.tiff},
      );
      if (asset.width !== entry.width || asset.height !== entry.height)
        throw new Error("Embedded image dimensions do not match the project.");
    }
    const documents = [
      project.document,
      ...(project.history?.past ?? []).map((entry) => entry.document),
      ...(project.history?.future ?? []).map((entry) => entry.document),
    ];
    const linkedIds = new Set(
      documents.flatMap((document) =>
        (document.components ?? []).flatMap((definition) =>
          definition.source.kind === "asset" && definition.source.link
            ? [definition.source.assetId]
            : [],
        ),
      ),
    );
    const snapshots: BinaryAsset[] = [];
    for (const key of linkedIds) {
      const asset = assets.get(key);
      snapshots.push({
        id: key,
        name: asset.name,
        width: asset.width,
        height: asset.height,
        type: asset.blob.type,
        size: asset.blob.size,
        offset: 0,
        sha256: await hashBlob(asset.blob),
      });
    }
    verifyLinkedSnapshots(documents, snapshots);
    return {
      document: project.document,
      assets,
      ...(project.history ? { history: project.history } : {}),
    };
  } catch (error) {
    assets.dispose();
    throw error;
  }
}
