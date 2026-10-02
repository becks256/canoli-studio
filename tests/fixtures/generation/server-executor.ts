import type { ApiServerOptions } from "../../../server/app";

/** Deliberately procedural fixture, explicitly injected by REST tests only. */
export const executeFixtureGeneration: NonNullable<
  ApiServerOptions["executeGeneration"]
> = async (request, signal) => {
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 80);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  signal.throwIfAborted();
  const pixels = new Uint8Array(request.targetWidth * request.targetHeight * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255;
    pixels[i + 3] = 255;
  }
  return pixels;
};
