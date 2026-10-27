import {verifyDeliveryContract} from './delivery-contract';
/**
 * Delivery Manifest generation, filename templating,
 * SHA-256 cryptographic verification, and package export.
 *
 * Implements W02/W03 delivery manifest specification from docs/AI_FEATURE_SPECS.md.
 */

import { id } from "../../core/model";
import type {
  BatchItem,
  BatchRun,
  DeliveryManifest,
  DeliveryManifestDeliverable,
  DeliveryVariantSpec,
} from "./types";
import { validateDeliveryManifest } from "./schema";

/**
 * Computes a standard hexadecimal SHA-256 digest string.
 * Supports ArrayBuffer, Uint8Array, and UTF-8 strings.
 * Requires Web Crypto SHA-256; unavailable or failed hashing rejects explicitly.
 */
export async function computeSha256(
  data: ArrayBuffer | Uint8Array | string,
): Promise<string> {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);

  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("SHA-256 requires Web Crypto in a secure context.");
  }
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes),
  );
  return Array.from(new Uint8Array(hashBuffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Sanitizes a filename to prevent path traversal or filesystem incompatibilities.
 */
const fileNameEncoder = new TextEncoder();
const fileNameDecoder = new TextDecoder();

/** Bound UTF-8 bytes without splitting a scalar; repair lone surrogates before deduplication. */
function truncateFileStem(name: string, maxBytes = 180): string {
  const wellFormed = fileNameDecoder.decode(fileNameEncoder.encode(name));
  let result = "",
    bytes = 0;
  for (const character of wellFormed) {
    const size = fileNameEncoder.encode(character).length;
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

export function sanitizeFileName(name: string): string {
  return truncateFileStem(
    name
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/^\.+/, ""),
  );
}

/** Limit the stem before adding the required format extension. */
function deliveryFileName(name: string, format: string): string {
  const extension = `.${format}`;
  const stem = name.toLowerCase().endsWith(extension)
    ? name.slice(0, -extension.length)
    : name;
  return `${sanitizeFileName(stem.normalize("NFC")) || "output"}${extension}`;
}

/**
 * Generates a formatted deliverable filename from a naming template.
 * Supported variables:
 * - {name}       Item name
 * - {variant}    Variant name (sanitized)
 * - {width}      Target width
 * - {height}     Target height
 * - {aspect}     Aspect ratio (e.g. "1x1", "9x16")
 * - {format}     File extension (png, jpeg, webp)
 */
export function formatDeliverableFileName(
  template: string,
  item: BatchItem,
  variant: DeliveryVariantSpec,
): string {
  const safeItemName = sanitizeFileName(
    item.name.replace(/\.[a-zA-Z0-9]+$/, ""),
  );
  const safeVariantName = sanitizeFileName(
    variant.name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
  );
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const div = gcd(variant.targetWidth, variant.targetHeight);
  const aspectStr = `${variant.targetWidth / div}x${variant.targetHeight / div}`;

  let out = template
    .replace(/\{name\}/g, safeItemName)
    .replace(/\{variant\}/g, safeVariantName)
    .replace(/\{width\}/g, String(variant.targetWidth))
    .replace(/\{height\}/g, String(variant.targetHeight))
    .replace(/\{aspect\}/g, aspectStr)
    .replace(/\{format\}/g, variant.format);

  return deliveryFileName(out, variant.format);
}

/**
 * Generates a complete, verifiable DeliveryManifest from a BatchRun.
 */
export async function generateDeliveryManifest(
  run: BatchRun,
  generatorName = "Canoli Studio Editor Batch Runner v0.1.0",
): Promise<DeliveryManifest> {
  const deliverables: DeliveryManifestDeliverable[] = [];
  const usedPaths = new Set<string>();
  const allocatePath = (fileName: string, format: string): string => {
    const safe = deliveryFileName(fileName, format);
    const dot = safe.lastIndexOf(".");
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const extension = dot > 0 ? safe.slice(dot) : "";
    let name = safe;
    let suffix = 2;
    while (usedPaths.has(name.toLowerCase())) {
      const ending = `_${suffix++}`;
      name = `${truncateFileStem(stem, 180 - ending.length)}${ending}${extension}`;
    }
    usedPaths.add(name.toLowerCase());
    return `deliverables/${name}`;
  };
  let totalCostCents = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let flaggedCount = 0;

  for (const item of run.items) {
    totalCostCents += item.actualCostCents;
    if (item.reviewState === "approved") approvedCount++;
    else if (item.reviewState === "rejected") rejectedCount++;
    else if (item.reviewState === "flagged") flaggedCount++;

    if (item.deliverables.length === 0) continue;
    const sourceHash = item.source.sha256;
    if (!sourceHash || !/^[a-f0-9]{64}$/.test(sourceHash)) {
      throw new Error(
        `Source provenance is unavailable for '${item.name}'. Create a new batch from the original source; existing outputs cannot be assigned a source digest retroactively.`,
      );
    }

    for (const deliv of item.deliverables) {
      const variant=run.config.variants?.find(value=>value.id===deliv.variantId);
      if(!variant&&(deliv.settingsSha256||deliv.color))throw new Error('Delivery variant is missing from its accepted settings.');
      if(variant)await verifyDeliveryContract(variant,deliv);
      deliverables.push({
        deliverableId: deliv.id,
        itemId: item.id,
        itemName: item.name,
        sourceHash,
        ...(deliv.color||['tiff','pdf'].includes(deliv.format)?{settingsSha256:deliv.settingsSha256,...(deliv.color?{color:deliv.color}:{})}:{}),
        variantName: deliv.variantName,
        filePath: allocatePath(deliv.fileName, deliv.format),
        format: deliv.format,
        width: deliv.width,
        height: deliv.height,
        aspectRatio: deliv.aspectRatio,
        byteLength: deliv.byteLength,
        sha256: deliv.sha256,
        reviewState: item.reviewState,
        actualCostCents:
          Math.round(
            (item.actualCostCents / (item.deliverables.length || 1)) * 100,
          ) / 100,
      });
    }
  }

  const manifest: DeliveryManifest = {
    schemaVersion: deliverables.some(row=>row.color||row.settingsSha256)?3:2,
    manifestId: `manifest-${id()}`,
    batchId: run.id,
    batchName: run.config.name,
    generatedAt: new Date().toISOString(),
    generator: generatorName,
    summary: {
      totalItems: run.items.length,
      totalDeliverables: deliverables.length,
      totalCostCents: Math.round(totalCostCents * 100) / 100,
      approvedCount,
      rejectedCount,
      flaggedCount,
    },
    deliverables,
    integrity: {
      manifestHash: "0".repeat(64),
    },
  };

  const validation = validateDeliveryManifest(manifest);
  if (!validation.valid) {
    throw new Error(
      `Generated manifest failed schema validation: ${validation.errors.join("; ")}`,
    );
  }

  manifest.integrity.manifestHash = await computeSha256(
    manifestPayload(manifest),
  );
  return manifest;
}

/** Stable JSON key order; arrays retain their delivery order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function manifestPayload(manifest: DeliveryManifest): string {
  const { integrity: _checksum, ...payload } = manifest;
  return canonicalJson(payload);
}

/** Verify the complete v2 manifest. Legacy partial checksums are not sufficient. */
export async function verifyDeliveryManifest(
  input: unknown,
): Promise<{ valid: boolean; calculatedHash: string }> {
  const validation = validateDeliveryManifest(input);
  if (!validation.valid || !validation.data)
    return { valid: false, calculatedHash: "" };
  const manifest = validation.data;
  const calculatedHash = await computeSha256(manifestPayload(manifest));
  return {
    valid: calculatedHash === manifest.integrity.manifestHash,
    calculatedHash,
  };
}
