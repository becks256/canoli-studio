import type {
  GenerationRequest,
  ProviderCapabilities,
} from "../providers/types";

/** Validate pixel geometry before reserving budget or invoking a provider. */
export function validateGenerationRequest(request: GenerationRequest): void {
  if (typeof request.prompt !== "string" || !request.prompt.trim())
    throw new Error("Generation prompt cannot be empty.");
  const dimensions = (width: number, height: number, label: string): number => {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      !Number.isSafeInteger(width * height * 4)
    ) {
      throw new Error(
        `${label} dimensions must be positive safe integers with a representable RGBA byte count.`,
      );
    }
    return width * height;
  };
  dimensions(request.targetWidth, request.targetHeight, "Target generation");
  const reference = request.referenceImage;
  if (reference) {
    const pixels = dimensions(
      reference.width,
      reference.height,
      "Reference image",
    );
    if (
      !(reference.data instanceof Uint8Array) ||
      reference.data.length !== pixels * 4
    ) {
      throw new Error(
        "Reference image must contain exactly width × height × 4 RGBA bytes.",
      );
    }
  }
  if (request.modality === "masked-edit" && !reference)
    throw new Error("Masked edits require a reference image.");
  for (const mask of [request.mask, request.protectedMask]) {
    if (!mask) continue;
    const pixels = dimensions(mask.width, mask.height, "Mask");
    if (
      mask.width !== request.targetWidth ||
      mask.height !== request.targetHeight ||
      !(mask.coverage instanceof Uint8Array) ||
      mask.coverage.length !== pixels
    ) {
      throw new Error(
        "Mask dimensions must match the target and contain one coverage byte per pixel.",
      );
    }
  }
  if (
    request.mask ||
    request.protectedMask ||
    request.protectedRegions?.length ||
    request.modality === "masked-edit"
  ) {
    if (
      !reference ||
      reference.width !== request.targetWidth ||
      reference.height !== request.targetHeight
    ) {
      throw new Error(
        "Protected edits require a reference image matching the target dimensions.",
      );
    }
  }
  if (
    request.featherRadius !== undefined &&
    (!Number.isFinite(request.featherRadius) || request.featherRadius < 0)
  ) {
    throw new Error("Feather radius must be finite and nonnegative.");
  }
  for (const region of request.protectedRegions ?? []) {
    if (
      (region.shape !== undefined &&
        region.shape !== "rectangle" &&
        region.shape !== "ellipse") ||
      ![region.x, region.y, region.width, region.height].every(
        Number.isFinite,
      ) ||
      region.width <= 0 ||
      region.height <= 0
    ) {
      throw new Error(
        "Protected regions require finite coordinates and positive dimensions.",
      );
    }
  }
}

/** Provider output constraints are independent of document/import geometry. */
export function validateProviderRequest(
  request: GenerationRequest,
  provider: ProviderCapabilities,
): void {
  const { targetWidth: width, targetHeight: height } = request;
  const d = provider.dimensions;
  if (
    width < d.minWidth ||
    width > d.maxWidth ||
    height < d.minHeight ||
    height > d.maxHeight ||
    width * height > d.maxMegapixels * 1_000_000 ||
    (d.stepSize !== undefined &&
      (width % d.stepSize !== 0 || height % d.stepSize !== 0)) ||
    (d.discreteSizes !== undefined &&
      !d.discreteSizes.some(
        (size) => size.width === width && size.height === height,
      ))
  ) {
    throw new Error(
      `Provider "${provider.name}" does not support output dimensions ${width}×${height}.`,
    );
  }
  if (request.requireAlpha && provider.alpha === "unsupported") {
    throw new Error(
      `Provider "${provider.name}" does not support alpha transparency.`,
    );
  }
}
