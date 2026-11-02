import { nativeLayoutSizeFontBytes } from "./native-layout-size-font";
import { createCanvas, release } from "./canvas";
import type { NativeGlyphFontControl } from "./native-glyph-font";

let serial = 0;
/** Measure the host's shaping scale with an independent one-em GPOS adjustment.
 * Subtracting the unkerned pair removes native raster advances, which can use a
 * different size. Never infer scale from a browser name or artwork/reference
 * pixels. The temporary font is private and retired before returning. */
export async function captureNativeLayoutSize(
  size: number,
  control: NativeGlyphFontControl = {},
): Promise<number> {
  const options = { ...control },
    timeout = options.timeoutMs ?? 60000;
  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    !Number.isInteger(timeout) ||
    timeout <= 0 ||
    timeout > 0x7fffffff
  )
    throw new Error("Invalid native text size request.");
  const set = globalThis.document?.fonts;
  if (!set || typeof FontFace === "undefined")
    throw new Error("Native font size capture requires the browser font host.");
  const current = () => {
    options.signal?.throwIfAborted();
    options.check?.();
    options.signal?.throwIfAborted();
    if (globalThis.document?.fonts !== set)
      throw new Error("The native size font host changed.");
  };
  current();
  const family = "CanoliSize_Layout_" + ++serial,
    face = new FontFace(family, nativeLayoutSizeFontBytes().buffer),
    canvas = createCanvas(1, 1);
  let added = false;
  try {
    await new Promise<void>((resolve, reject) => {
      let ended = false;
      const finish = (error?: unknown) => {
          if (ended) return;
          ended = true;
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
          error === undefined ? resolve() : reject(error);
        },
        abort = () =>
          finish(
            options.signal?.reason ??
              new Error("Native font size capture cancelled."),
          ),
        timer = setTimeout(
          () =>
            finish(
              new Error("Native font size capture exceeded its time budget."),
            ),
          timeout,
        );
      options.signal?.addEventListener("abort", abort, { once: true });
      face.load().then(() => finish(), finish);
      if (options.signal?.aborted) abort();
    });
    current();
    if (face.status !== "loaded")
      throw new Error("Native size font could not be loaded.");
    const state = JSON.stringify(
      [
        "family",
        "status",
        "weight",
        "style",
        "stretch",
        "variationSettings",
        "featureSettings",
        "unicodeRange",
        "ascentOverride",
        "descentOverride",
        "lineGapOverride",
        "sizeAdjust",
      ].map((key) => (face as unknown as Record<string, unknown>)[key]),
    );
    const registered = () => {
      current();
      if (
        !set.has(face) ||
        JSON.stringify(
          [
            "family",
            "status",
            "weight",
            "style",
            "stretch",
            "variationSettings",
            "featureSettings",
            "unicodeRange",
            "ascentOverride",
            "descentOverride",
            "lineGapOverride",
            "sizeAdjust",
          ].map((key) => (face as unknown as Record<string, unknown>)[key]),
        ) !== state ||
        [...set].some((other) => other !== face && other.family === family)
      )
        throw new Error("The native size font registration changed.");
    };
    set.add(face);
    added = true;
    registered();
    const c = canvas.getContext("2d")!;
    c.font = `${size}px ${family}`;
    if (!c.font.includes(family))
      throw new Error("The native size font request is invalid.");
    if (!("fontKerning" in c))
      throw new Error("Native layout size requires kerning control.");
    c.letterSpacing = "0px";
    c.wordSpacing = "0px";
    c.direction = "ltr";
    c.fontKerning = "none";
    if (c.fontKerning !== "none")
      throw new Error("Native layout size requires kerning control.");
    const off = c.measureText("AA").width;
    current();
    c.fontKerning = "normal";
    if (c.fontKerning !== "normal")
      throw new Error("Native layout size requires kerning control.");
    const on = c.measureText("AA").width;
    current();
    const width = on - off;
    registered();
    if (!Number.isFinite(width) || width <= 0)
      throw new Error("The native font size is invalid.");
    return width;
  } finally {
    if (added) set.delete(face);
    release(canvas);
  }
}
