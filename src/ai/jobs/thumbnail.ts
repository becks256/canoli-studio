/** Display-only nearest-sample preview; verification retains full-resolution pixels. */
export function rgbaThumbnail(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): string | undefined {
  if (typeof document === "undefined") return undefined;
  const scale = Math.min(1, 512 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot display the pixel preview.");
    const image = context.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) {
      const sourceY = Math.min(
        height - 1,
        Math.floor(((y + 0.5) * height) / canvas.height),
      );
      for (let x = 0; x < canvas.width; x++) {
        const sourceX = Math.min(
          width - 1,
          Math.floor(((x + 0.5) * width) / canvas.width),
        );
        const source = (sourceY * width + sourceX) * 4;
        image.data.set(
          pixels.subarray(source, source + 4),
          (y * canvas.width + x) * 4,
        );
      }
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    canvas.width = canvas.height = 0;
  }
}
