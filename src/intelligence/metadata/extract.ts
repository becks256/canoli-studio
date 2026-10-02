import { parse } from "exifr";
import { normalizeMetadata } from "./model";
import type { AssetMetadata, MetadataInput } from "./model";

/** Exifr reads Blob ranges. Host deadlines terminate the worker on malformed/slow input. */
export async function extractMetadata(
  input: MetadataInput,
): Promise<AssetMetadata> {
  const signature = new Uint8Array(await input.blob.slice(0, 12).arrayBuffer());
  const matches = (bytes: number[], offset = 0) =>
    bytes.every((value, index) => signature[offset + index] === value);
  const type = matches([137, 80, 78, 71, 13, 10, 26, 10])
    ? "image/png"
    : matches([255, 216, 255])
      ? "image/jpeg"
      : matches([82, 73, 70, 70]) && matches([87, 69, 66, 80], 8)
        ? "image/webp"
        : "application/octet-stream";
  let parsed: unknown;
  const warnings: string[] = [];
  try {
    parsed = await parse(input.blob, {
      mergeOutput: false,
      translateValues: false,
      reviveValues: false,
      ifd1: false,
      makerNote: false,
      userComment: false,
      xmp: true,
      icc: true,
      iptc: true,
      ihdr: true,
    });
  } catch {
    warnings.push(
      "Some embedded metadata could not be read. Editing and the original image are unaffected.",
    );
  }
  return normalizeMetadata(
    {
      name: input.name,
      width: input.width,
      height: input.height,
      size: input.blob.size,
      type,
    },
    parsed,
    warnings,
  );
}
