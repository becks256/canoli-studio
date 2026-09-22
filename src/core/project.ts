import { AssetStore } from "./assets";
import type { SerializedAsset } from "./assets";
import { referencedAssets, validateDocument } from "./model";
import type { DocumentData } from "./model";

interface ProjectFile {
  format: "luma";
  version: 1;
  document: DocumentData;
  assets: SerializedAsset[];
}

export function serializeProject(
  document: DocumentData,
  assets: AssetStore,
): string {
  const referenced = referencedAssets(document);
  const project: ProjectFile = {
    format: "luma",
    version: 1,
    document,
    assets: assets.serialize(referenced),
  };
  return JSON.stringify(project);
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
      asset.name.length > 240 ||
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
  text: string,
): Promise<{ document: DocumentData; assets: AssetStore }> {
  const project = parseProject(text);
  const assets = new AssetStore();
  try {
    for (const entry of project.assets) {
      const response = await fetch(entry.dataUrl);
      const asset = await assets.add(
        await response.blob(),
        entry.name,
        entry.id,
      );
      if (asset.width !== entry.width || asset.height !== entry.height)
        throw new Error("Embedded image dimensions do not match the project.");
    }
    return { document: project.document, assets };
  } catch (error) {
    assets.dispose();
    throw error;
  }
}
