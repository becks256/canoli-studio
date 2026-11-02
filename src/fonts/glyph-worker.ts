import { compileGlyphSelectors } from "./glyph-sfnt";
let started = false;
self.onmessage = (event: MessageEvent) => {
  try {
    if (started) throw new Error("This glyph worker already owns a source.");
    started = true;
    const value = event.data;
    if (
      !value ||
      !(value.bytes instanceof Uint8Array) ||
      !Number.isInteger(value.timeoutMs) ||
      value.timeoutMs <= 0 ||
      value.timeoutMs > 0x7fffffff ||
      Object.keys(value).some((key) => !["bytes", "timeoutMs"].includes(key))
    )
      throw new Error("Invalid glyph font worker request.");
    const deadline = performance.now() + value.timeoutMs,
      check = () => {
        if (performance.now() > deadline)
          throw new Error("Native glyph preparation exceeded its time budget.");
      },
      result = compileGlyphSelectors(value.bytes, check);
    check();
    self.postMessage(result, {
      transfer: [result.bytes.buffer, result.selectors.buffer],
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
