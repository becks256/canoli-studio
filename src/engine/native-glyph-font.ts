import {
  compressedFontFormat,
  decodedFontWireSchema,
  verifyDecodedFontFingerprints,
  validateDecodedFontSteps,
} from "../fonts/compressed-font";
import type { FontAxisRange } from "../fonts/css-instance";
import type { FontDescriptors } from "../fonts/types";
import {
  normalizeFontRun,
  type FontRunInput,
  type OwnedFontRun,
} from "../fonts/shaping-types";
import {
  parseFontVariations,
  formatFontVariations,
} from "../core/font-variations";
import type { AssetStore } from "../core/assets";
import { yieldTask } from "../core/task-yield";
import { acquireFontWorkerSlot } from "../fonts/client";
import {
  glyphFeatureSettings,
  validateGlyphSelectorSteps,
  type GlyphSelectorBytes,
} from "../fonts/glyph-sfnt";
import type {
  NativeSvgMetricsStyle,
  NativeSvgMetrics,
  NativeSvgMetricsRequest,
} from "./native-svg-metrics";
import type { FontRunCss } from "../fonts/css-instance";

export interface NativeGlyphFontControl {
  signal?: AbortSignal;
  timeoutMs?: number;
  check?: () => void;
}
export interface NativeGlyphFont {
  readonly signal?: AbortSignal;
  readonly axes: readonly Readonly<FontAxisRange>[];
  readonly descriptors: readonly Readonly<FontDescriptors>[];
  readonly sourceFamily: string;
  readonly family: string;
  readonly glyphCount: number;
  readonly settings: string;
  readonly monochrome: boolean;
  shapeRun(
    input: FontRunInput,
    control?: NativeGlyphFontControl,
  ): Promise<OwnedFontRun>;
  character(glyphId: number): string;
  svgFont?(
    control?: NativeGlyphFontControl,
  ): Promise<Readonly<{ definitions: string; features: string }>>;
  svgMetrics?(
    ids: readonly number[],
    style: NativeSvgMetricsStyle,
    css: FontRunCss,
    computedSize: number,
    control?: NativeGlyphFontControl,
    projection?: NativeSvgMetricsRequest,
  ): Promise<NativeSvgMetrics>;
  check(): void;
  release(): void;
}
let serial = 0;
const nativeState = (face: FontFace) =>
  JSON.stringify(
    [
      "family",
      "style",
      "weight",
      "stretch",
      "unicodeRange",
      "status",
      "ascentOverride",
      "descentOverride",
      "lineGapOverride",
      "featureSettings",
      "variationSettings",
      "display",
      "sizeAdjust",
    ].map((key) => (face as unknown as Record<string, unknown>)[key]),
  );
/** Private original-source shaping and glyph-ID access, without a new grant. */
export async function captureNativeGlyphFont(
  assets: AssetStore,
  id: string,
  settings = "normal",
  control: NativeGlyphFontControl = {},
): Promise<NativeGlyphFont> {
  control = { ...control };
  const original = assets.captureLifetime();
  original();
  control.signal?.throwIfAborted();
  control.check?.();
  const timeout = control.timeoutMs ?? 60000;
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 0x7fffffff)
    throw new Error("Invalid native glyph preparation time budget.");
  const lease = assets.fonts.retain(id),
    source = lease.resource,
    info = source.descriptor.report.faces[0],
    ranges = new Map(info.axes.map((axis) => [axis.tag, axis]));
  let released = false,
    worker: Worker | undefined,
    slot: (() => void) | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    selectors: Uint32Array | undefined,
    shapeBytes: Uint8Array | undefined,
    svgBlob: Blob | undefined,
    svgData: string | undefined;
  const abort = new AbortController(),
    faces: FontFace[] = [],
    states: string[] = [],
    family = "CanoliGlyph_" + info.id + "_" + ++serial,
    set = globalThis.document?.fonts;
  const signal = AbortSignal.any([
    abort.signal,
    ...(control.signal ? [control.signal] : []),
  ]);
  const cancel = () =>
    abort.abort(
      control.signal?.reason ??
        new Error("Native glyph preparation cancelled."),
    );
  const release = () => {
    if (released) return;
    released = true;
    abort.abort(new Error("The native glyph font was released."));
    worker?.terminate();
    worker = undefined;
    for (const face of faces) set?.delete(face);
    faces.length = 0;
    states.length = 0;
    selectors = undefined;
    shapeBytes = undefined;
    svgBlob = undefined;
    svgData = undefined;
    lease.release();
  };
  const check = () => {
    if (released) throw new Error("The native glyph font was released.");
    abort.signal.throwIfAborted();
    control.signal?.throwIfAborted();
    original();
    lease.check();
    control.check?.();
    if (released) throw new Error("The native glyph font was released.");
    abort.signal.throwIfAborted();
    control.signal?.throwIfAborted();
    lease.check();
    if (set && globalThis.document?.fonts !== set)
      throw new Error("The native glyph font host changed.");
    if (
      faces.some(
        (face, i) =>
          !set?.has(face) ||
          face.status !== "loaded" ||
          nativeState(face) !== states[i],
      )
    )
      throw new Error("The native glyph font registration changed.");
    if (
      set &&
      [...set]
        .filter((face) => face.family === family)
        .some((face) => !faces.includes(face))
    )
      throw new Error("The native glyph font family changed.");
  };
  try {
    const axes = parseFontVariations(settings).flatMap((axis) => {
        const range = ranges.get(axis.tag);
        return range
          ? [
              {
                tag: axis.tag,
                value: Math.max(range.min, Math.min(range.max, axis.value)),
              },
            ]
          : [];
      }),
      effective = formatFontVariations(axes);
    check();
    if (
      !set ||
      typeof FontFace === "undefined" ||
      typeof Worker === "undefined"
    )
      throw new Error(
        "Native glyph fonts require the browser font/worker host.",
      );
    control.signal?.addEventListener("abort", cancel, { once: true });
    if (control.signal?.aborted) cancel();
    slot = await acquireFontWorkerSlot(abort.signal);
    check();
    timer = setTimeout(
      () =>
        abort.abort(
          new Error("Native glyph preparation exceeded its time budget."),
        ),
      timeout,
    );
    const guarded = <T>(promise: Promise<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        const stopped = () => {
          abort.signal.removeEventListener("abort", stopped);
          reject(abort.signal.reason);
        };
        abort.signal.addEventListener("abort", stopped, { once: true });
        promise.then(
          (value) => {
            abort.signal.removeEventListener("abort", stopped);
            resolve(value);
          },
          (error) => {
            abort.signal.removeEventListener("abort", stopped);
            reject(error);
          },
        );
        if (abort.signal.aborted) stopped();
      });
    const originalBytes = new Uint8Array(
      await guarded(source.renderBlob.arrayBuffer()),
    );
    check();
    let bytes = originalBytes;
    if (compressedFontFormat(originalBytes)) {
      worker = new Worker(
        new URL("../generated/font-decoder-worker.js", import.meta.url),
        { type: "module" },
      );
      const reply = decodedFontWireSchema.parse(
        await guarded(
          new Promise<unknown>((resolve, reject) => {
            worker!.onmessage = (event) =>
              event.data?.error
                ? reject(new Error(String(event.data.error)))
                : resolve(event.data);
            worker!.onerror = () =>
              reject(new Error("Native font decoder worker failed."));
            worker!.onmessageerror = () =>
              reject(new Error("Invalid native font decoder response."));
            worker!.postMessage({
              bytes: originalBytes,
              identity: {
                unitsPerEm: info.unitsPerEm,
                glyphCount: info.glyphCount,
              },
              timeoutMs: timeout,
            });
          }),
        ),
      );
      worker.terminate();
      worker = undefined;
      check();
      const decoded = { ...reply, bytes: Uint8Array.from(reply.bytes) };
      await guarded(verifyDecodedFontFingerprints(originalBytes, decoded));
      check();
      let deadline = performance.now() + 2;
      for (const _ of validateDecodedFontSteps(
        originalBytes,
        decoded.bytes,
        info,
      )) {
        if (performance.now() >= deadline) {
          await guarded(yieldTask());
          check();
          deadline = performance.now() + 2;
        }
        void _;
      }
      const native = new FontFace(
        "CanoliDecodedValidation_" + info.id,
        Uint8Array.from(decoded.bytes).buffer,
        info.descriptors[0],
      );
      await guarded(native.load());
      check();
      if (native.status !== "loaded")
        throw new Error("Cannot validate the decoded native font.");
      bytes = decoded.bytes;
    }
    shapeBytes = bytes;
    worker = new Worker(
      new URL("../generated/glyph-selector-worker.js", import.meta.url),
      { type: "module" },
    );
    const result = await guarded(
      new Promise<GlyphSelectorBytes>((resolve, reject) => {
        worker!.onmessage = (event) => {
          const value = event.data;
          if (value?.error) reject(new Error(String(value.error)));
          else if (
            !value ||
            Object.keys(value).some(
              (key) => !["bytes", "selectors", "glyphCount"].includes(key),
            )
          )
            reject(new Error("Invalid glyph font worker response."));
          else resolve(value);
        };
        worker!.onerror = () =>
          reject(new Error("Native glyph font worker failed."));
        worker!.onmessageerror = () =>
          reject(new Error("Invalid glyph font worker response."));
        worker!.postMessage({ bytes, timeoutMs: timeout });
      }),
    );
    worker.terminate();
    worker = undefined;
    check();
    let deadline = performance.now() + 2;
    for (const _ of validateGlyphSelectorSteps(bytes, result)) {
      if (performance.now() >= deadline) {
        await guarded(yieldTask());
        check();
        deadline = performance.now() + 2;
      }
      void _;
    }
    check();
    if (result.glyphCount !== info.glyphCount)
      throw new Error("Native glyph count differs from its retained source.");
    selectors = result.selectors;
    const featureSettings = glyphFeatureSettings(bytes);
    svgBlob = new Blob([Uint8Array.from(result.bytes).buffer], {
      type:
        new DataView(result.bytes.buffer, result.bytes.byteOffset).getUint32(
          0,
        ) === 0x4f54544f
          ? "font/otf"
          : "font/ttf",
    });
    const svgMetrics = async (
      input: readonly number[],
      style: NativeSvgMetricsStyle,
      css: FontRunCss,
      size: number,
      options: NativeGlyphFontControl = {},
      projection: NativeSvgMetricsRequest = {},
    ): Promise<NativeSvgMetrics> => {
      const projected = { ...projection },
        ids = [...input],
        paint = { ...style },
        request = normalizeFontRun({
          text: "",
          css,
          nominal: true,
          direction: projected.direction,
        }),
        child = { ...options },
        childSignal = AbortSignal.any([
          signal,
          ...(child.signal ? [child.signal] : []),
        ]),
        current = () => {
          childSignal.throwIfAborted();
          check();
          child.check?.();
          check();
          childSignal.throwIfAborted();
        };
      current();
      if (
        ids.some((n) => !Number.isInteger(n) || n < 1 || n >= info.glyphCount)
      )
        throw new Error(
          "Native SVG metrics require original nonzero glyph IDs.",
        );
      const names = ids.map((n) => String.fromCodePoint(selectors![n])),
        blob = svgBlob!,
        bytes = new Uint8Array(await blob.arrayBuffer());
      current();
      if (svgBlob !== blob)
        throw new Error("Native SVG metric source changed.");
      const { captureNativeSvgMetrics } = await import("./native-svg-metrics");
      current();
      return captureNativeSvgMetrics(
        assets,
        id,
        bytes,
        family,
        effective,
        ids,
        names,
        paint,
        request.css!,
        size,
        { ...child, signal: childSignal, check: current },
        projected,
      );
    };
    const svgFont = async (input: NativeGlyphFontControl = {}) => {
      const child = { ...input },
        time = child.timeoutMs ?? 60000;
      if (!Number.isInteger(time) || time <= 0 || time > 0x7fffffff)
        throw new Error("Invalid SVG glyph font time budget.");
      const signal = AbortSignal.any([
          abort.signal,
          ...(control.signal ? [control.signal] : []),
          ...(child.signal ? [child.signal] : []),
        ]),
        current = () => {
          signal.throwIfAborted();
          check();
          child.check?.();
          signal.throwIfAborted();
          check();
        };
      current();
      if (!svgData) {
        const blob = svgBlob!,
          data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            let ended = false;
            const finish = (error?: unknown) => {
                if (ended) return;
                ended = true;
                clearTimeout(timer);
                signal.removeEventListener("abort", cancel);
                reader.onload = reader.onerror = reader.onabort = null;
                if (error !== undefined) {
                  if (reader.readyState === 1) reader.abort();
                  reject(error);
                } else resolve(String(reader.result));
              },
              cancel = () =>
                finish(
                  signal.reason ??
                    new Error("SVG glyph font encoding cancelled."),
                ),
              timer = setTimeout(
                () =>
                  finish(
                    new Error(
                      "SVG glyph font encoding exceeded its time budget.",
                    ),
                  ),
                time,
              );
            reader.onload = () => finish();
            reader.onerror = () =>
              finish(
                reader.error ?? new Error("Cannot encode the SVG glyph font."),
              );
            reader.onabort = () =>
              finish(new Error("SVG glyph font encoding aborted."));
            signal.addEventListener("abort", cancel, { once: true });
            try {
              reader.readAsDataURL(blob);
              if (signal.aborted) cancel();
            } catch (error) {
              finish(error);
            }
          });
        current();
        if (svgBlob !== blob)
          throw new Error("The SVG glyph font source changed.");
        svgData = data;
      }
      current();
      const defs = globalThis.document.createElementNS(
          "http://www.w3.org/2000/svg",
          "defs",
        ),
        style = globalThis.document.createElementNS(
          "http://www.w3.org/2000/svg",
          "style",
        );
      style.setAttribute("type", "text/css");
      style.textContent = info.descriptors
        .map(
          (d) =>
            `@font-face{font-family:"${family}";src:url("${svgData}");font-style:${d.style};font-weight:${d.weight};font-stretch:${d.stretch};font-feature-settings:${featureSettings};font-variation-settings:${effective};}`,
        )
        .join("\n");
      defs.append(style);
      return Object.freeze({
        definitions: new XMLSerializer().serializeToString(defs),
        features: featureSettings,
      });
    };
    for (const descriptor of info.descriptors) {
      check();
      const face = new FontFace(family, Uint8Array.from(result.bytes).buffer, {
        ...descriptor,
        variationSettings: effective,
        featureSettings,
      });
      await guarded(face.load());
      check();
      if (
        featureSettings !== "normal" &&
        (typeof face.featureSettings !== "string" ||
          face.featureSettings === "normal")
      )
        throw new Error("Native glyph feature control is unavailable.");
      if (face.status !== "loaded")
        throw new Error("Cannot load native glyph font.");
      faces.push(face);
      states.push(nativeState(face));
      set.add(face);
      check();
    }
    const colorTables = [
        "COLR",
        "CPAL",
        "CBDT",
        "CBLC",
        "EBDT",
        "EBLC",
        "sbix",
        "SVG ",
      ],
      v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      tags = Array.from({ length: v.getUint16(4) }, (_, i) =>
        String.fromCharCode(...bytes.subarray(12 + i * 16, 16 + i * 16)),
      ),
      monochrome = !tags.some((tag) => colorTables.includes(tag));
    check();
    return Object.freeze({
      axes: Object.freeze(
        info.axes.map((a) =>
          Object.freeze({ tag: a.tag, min: a.min, max: a.max }),
        ),
      ),
      descriptors: Object.freeze(
        info.descriptors.map((d) => Object.freeze({ ...d })),
      ),
      sourceFamily: info.cssFamily,
      family,
      signal,
      svgFont,
      svgMetrics,
      glyphCount: info.glyphCount,
      settings: effective,
      monochrome,
      async shapeRun(
        input: FontRunInput,
        requested: NativeGlyphFontControl = {},
      ) {
        const run = normalizeFontRun(input),
          child = { ...requested };
        check();
        const { captureNativeFontRun } = await import("./native-font-shape");
        check();
        const signals = [
          abort.signal,
          ...(control.signal ? [control.signal] : []),
          ...(child.signal ? [child.signal] : []),
        ];
        return captureNativeFontRun(
          assets,
          id,
          run,
          effective,
          {
            ...child,
            signal: AbortSignal.any(signals),
            check() {
              check();
              child.check?.();
              check();
            },
          },
          shapeBytes!,
        );
      },
      character(glyphId: number) {
        check();
        if (glyphId === 0)
          throw new Error(
            "Glyph zero requires missing-glyph paint integration.",
          );
        if (
          !Number.isInteger(glyphId) ||
          glyphId < 1 ||
          glyphId >= info.glyphCount
        )
          throw new Error("Native glyph ID is outside its original font.");
        return String.fromCodePoint(selectors![glyphId]);
      },
      check,
      release,
    });
  } catch (error) {
    release();
    throw error;
  } finally {
    worker?.terminate();
    worker = undefined;
    if (timer) clearTimeout(timer);
    slot?.();
    control.signal?.removeEventListener("abort", cancel);
  }
}
