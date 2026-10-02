import type { AuthoredMetadataData } from "../../core/metadata";
export interface MetadataField {
  id: string;
  label: string;
  namespace: string;
  value: string | number | boolean | (string | number)[];
  origin: "computed" | "embedded";
  privacy: "technical" | "attribution" | "private";
}
export interface AssetMetadata {
  version: 1;
  parser: "exifr/7.1.3";
  fields: MetadataField[];
  warnings: string[];
}
export interface MetadataInput {
  blob: Blob;
  name: string;
  width: number;
  height: number;
}
export type MetadataState =
  | { status: "pending" }
  | { status: "ready"; result: AssetMetadata }
  | { status: "error"; message: string };

const attribution = new Set([
  "Artist",
  "Copyright",
  "creator",
  "rights",
  "Creator",
  "CopyrightNotice",
  "Byline",
  "Credit",
  "Source",
  "UsageTerms",
]);
const technical = new Set([
  "Make",
  "Model",
  "LensModel",
  "ExposureTime",
  "FNumber",
  "ISO",
  "FocalLength",
  "Orientation",
  "ExifImageWidth",
  "ExifImageHeight",
  "ImageWidth",
  "ImageHeight",
  "ColorSpace",
  "ProfileDescription",
  "ProfileVersion",
  "ColorSpaceData",
  "width",
  "height",
  "bitDepth",
  "colorType",
]);

/** Keep parser output as inert, bounded values; do not merge conflicting namespaces. */
export function normalizeMetadata(
  input: Omit<MetadataInput, "blob"> & { size: number; type: string },
  parsed: unknown,
  warnings: string[] = [],
): AssetMetadata {
  let shortened = false;
  const bounded = (text: string, limit: number) => {
    if (text.length > limit) shortened = true;
    return text.slice(0, limit);
  };
  const fields: MetadataField[] = [
    {
      id: "file:name",
      label: "File name",
      namespace: "file",
      value: bounded(input.name, 4096),
      origin: "computed",
      privacy: "private",
    },
    {
      id: "file:type",
      label: "File type",
      namespace: "file",
      value: input.type,
      origin: "computed",
      privacy: "technical",
    },
    {
      id: "file:size",
      label: "Original bytes",
      namespace: "file",
      value: input.size,
      origin: "computed",
      privacy: "technical",
    },
    {
      id: "file:width",
      label: "Decoded width",
      namespace: "file",
      value: input.width,
      origin: "computed",
      privacy: "technical",
    },
    {
      id: "file:height",
      label: "Decoded height",
      namespace: "file",
      value: input.height,
      origin: "computed",
      privacy: "technical",
    },
  ];
  const valueOf = (value: unknown): MetadataField["value"] | undefined => {
    if (typeof value === "string") {
      if (value.length > 4096) shortened = true;
      return value.slice(0, 4096);
    }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "boolean") return value;
    if (Array.isArray(value)) {
      if (value.length > 64) shortened = true;
      const preview = value.slice(0, 64);
      if (
        preview.every(
          (v) =>
            typeof v === "string" ||
            (typeof v === "number" && Number.isFinite(v)),
        )
      ) {
        return preview.map((v) =>
          typeof v === "string" ? bounded(v, 4096) : v,
        );
      }
    }
    return undefined;
  };
  let visited = 0;
  const walk = (
    object: unknown,
    namespace: string,
    depth: number,
    privateParent = false,
  ) => {
    if (!object || typeof object !== "object" || ArrayBuffer.isView(object))
      return;
    if (depth > 4 || fields.length >= 512) {
      shortened = true;
      return;
    }
    for (const key in object) {
      if (!Object.hasOwn(object, key)) continue;
      if (fields.length >= 512 || visited >= 2048) {
        shortened = true;
        break;
      }
      visited++;
      const raw = (object as Record<string, unknown>)[key];
      const label = bounded(key, 160);
      const privateField = privateParent || /gps/i.test(key);
      const value = valueOf(raw);
      if (value !== undefined) {
        fields.push({
          id: `embedded:${fields.length}`,
          label,
          namespace,
          value,
          origin: "embedded",
          privacy: privateField
            ? "private"
            : attribution.has(key)
              ? "attribution"
              : technical.has(key)
                ? "technical"
                : "private",
        });
      } else walk(raw, `${namespace}.${label}`, depth + 1, privateField);
    }
  };
  walk(parsed, "embedded", 0);
  const resultWarnings = [...warnings];
  if (shortened)
    resultWarnings.push(
      "Some metadata exceeded display bounds and was shortened or omitted. Original bytes are unchanged.",
    );
  return {
    version: 1,
    parser: "exifr/7.1.3",
    fields,
    warnings: resultWarnings,
  };
}

export function metadataSidecar(
  metadata: AssetMetadata,
  policy: { attribution: boolean; private: boolean },
  authored?: AuthoredMetadataData,
) {
  const fields = metadata.fields.filter(
    (field) =>
      field.privacy === "technical" ||
      (field.privacy === "attribution" ? policy.attribution : policy.private),
  );
  return {
    format: "luma-asset-metadata",
    version: 1,
    parser: metadata.parser,
    policy,
    authored: authored
      ? Object.fromEntries(
          Object.entries(authored).filter(([key]) =>
            ["creator", "copyright", "license"].includes(key)
              ? policy.attribution
              : policy.private,
          ),
        )
      : undefined,
    authoredOrigin: authored ? "user" : undefined,
    fields,
    excludedFieldCount: metadata.fields.length - fields.length,
    warnings: metadata.warnings,
  };
}
