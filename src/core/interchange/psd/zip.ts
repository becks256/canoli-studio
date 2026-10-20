/** Photoshop ZIP is a zlib stream, with optional per-row byte prediction. */
export interface PsdZipRequest {
  bytes: Uint8Array;
  width: number;
  rows: number;
  prediction: boolean;
}

export async function decodePsdZip(request: PsdZipRequest): Promise<Uint8Array> {
  const { bytes, width, rows, prediction } = request;
  const expected = width * rows;
  if (!Number.isSafeInteger(width) || width < 0 ||
      !Number.isSafeInteger(rows) || rows < 0 || !Number.isSafeInteger(expected))
    throw new Error("Invalid Photoshop ZIP channel geometry.");
  if (typeof DecompressionStream === "undefined")
    throw new Error("Photoshop ZIP decoding requires native Deflate support.");

  // Bound output by declared geometry, not compressed file size or an image cap.
  // Own only this compressed range; the caller's complete input stays untouched.
  const output = new Uint8Array(expected);
  const source = new Blob([new Uint8Array(bytes)]).stream();
  const reader = source.pipeThrough(new DecompressionStream("deflate")).getReader();
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > expected - offset)
        throw new Error("Photoshop ZIP output exceeds its channel extent.");
      output.set(value, offset);
      offset += value.length;
    }
    if (offset !== expected)
      throw new Error("Truncated Photoshop ZIP channel output.");
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw new Error("Invalid Photoshop ZIP data.", { cause: error });
  } finally {
    reader.releaseLock();
  }

  // 8-bit horizontal differences wrap modulo 256, resetting at every row,
  // including channel boundaries in the planar merged-image stream.
  if (prediction) {
    for (let y = 0; y < rows; y++) {
      const start = y * width, end = start + width;
      for (let p = start + 1; p < end; p++) output[p] += output[p - 1];
    }
  }
  return output;
}
