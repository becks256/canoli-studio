import { z } from "zod";
import { yieldTask } from "./task-yield";

export type LutInterpolation = "tetrahedral" | "trilinear";
export interface CubeLutData {
  title: string;
  dimension: 1 | 3;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** Canonical base64 of red-fastest RGB float32 values, little endian. */
  data: string;
}
export interface LutAdjustmentData { kind: "lut"; lut: CubeLutData; amount: number; interpolation: LutInterpolation }
const triple = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const cache = new Map<string, Float32Array>();
let cacheBytes = 0;
const CACHE_BUDGET = 32 * 1024 * 1024;
function retain(data: string, values: Float32Array) {
  const cost = values.byteLength + data.length * 2;
  if (cost > CACHE_BUDGET || cache.has(data)) return;
  while (cache.size && (cache.size >= 4 || cacheBytes + cost > CACHE_BUDGET)) {
    const key = cache.keys().next().value!;
    cacheBytes -= cache.get(key)!.byteLength + key.length * 2; cache.delete(key);
  }
  cache.set(data, values); cacheBytes += cost;
}

function encode(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 24576)
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 24576))));
  return chunks.join("");
}

/** Internal read-only decoded view. Callers must never mutate or transfer it. */
export function lutValues(lut: CubeLutData): Float32Array {
  const count = 3 * (lut.dimension === 1 ? lut.size : lut.size ** 3), bytes = count * 4;
  if (!Number.isSafeInteger(count) || lut.data.length !== Math.ceil(bytes / 3) * 4)
    throw new Error("LUT payload length does not match its table size.");
  const hit = cache.get(lut.data);
  if (hit) { cache.delete(lut.data); cache.set(lut.data, hit); return hit; }
  let binary: string;
  try { binary = atob(lut.data); } catch { throw new Error("LUT data must be canonical base64 float32 values."); }
  if (binary.length !== bytes) throw new Error("LUT payload length does not match its table size.");
  // RGB float32 payloads are multiples of 12 bytes, so canonical base64 has no
  // padding. Exact encoded/decoded lengths plus atob's alphabet validation also
  // reject whitespace and padding, without re-encoding millions of bytes.
  const raw = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) raw[i] = binary.charCodeAt(i);
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const view = new DataView(raw.buffer), values = littleEndian ? new Float32Array(raw.buffer) : new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const value = view.getFloat32(i * 4, true);
    if (!Number.isFinite(value)) throw new Error("LUT table values must be finite float32 numbers.");
    if (!littleEndian) values[i] = value;
  }
  retain(lut.data, values);
  return values;
}

const cubeHeaderSchema = z.object({
  title: z.string().max(240).regex(/^[^"\r\n]*$/), dimension: z.union([z.literal(1), z.literal(3)]),
  size: z.number().int().min(2).max(65536), domainMin: triple, domainMax: triple, data: z.string(),
}).strict().superRefine((lut, context) => {
  if (lut.dimension === 3 && lut.size > 256) {
    context.addIssue({ code: "custom", message: "A .cube 3D table size must be between 2 and 256." }); return;
  }
  if (lut.domainMin.some((value, i) => !(lut.domainMax[i] > value) || !Number.isFinite(lut.domainMax[i] - value))) {
    context.addIssue({ code: "custom", message: "LUT domain maxima must exceed minima by finite positive spans." }); return;
  }
});
export const cubeLutSchema = cubeHeaderSchema.superRefine((lut, context) => {
  try { lutValues(lut); } catch (error) { context.addIssue({ code: "custom", message: (error as Error).message }); }
});

/** Validate/cache imported bytes cooperatively before the synchronous shared command. */
export async function primeLutCache(input: CubeLutData, isCancelled: () => boolean = () => false): Promise<CubeLutData> {
  const lut = cubeHeaderSchema.parse(input), count = 3 * (lut.dimension === 1 ? lut.size : lut.size ** 3), bytes = count * 4;
  const check = () => { if (isCancelled()) throw new DOMException("LUT import cancelled.", "AbortError"); };
  check();
  if (lut.data.length !== bytes / 3 * 4) throw new Error("LUT payload length does not match its table size.");
  if (cache.get(lut.data)?.byteLength === bytes) return lut;
  let binary: string;
  try { binary = atob(lut.data); } catch { throw new Error("LUT data must be canonical base64 float32 values."); }
  if (binary.length !== bytes) throw new Error("LUT payload length does not match its table size.");
  const raw = new Uint8Array(bytes), view = new DataView(raw.buffer);
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const values = littleEndian ? new Float32Array(raw.buffer) : new Float32Array(count);
  let deadline = performance.now() + 2;
  for (let i = 0; i < bytes; i++) {
    raw[i] = binary.charCodeAt(i);
    if (i % 4096 === 0 && performance.now() >= deadline) { await yieldTask(); check(); deadline = performance.now() + 2; }
  }
  for (let i = 0; i < count; i++) {
    const value = view.getFloat32(i * 4, true);
    if (!Number.isFinite(value)) throw new Error("LUT table values must be finite float32 numbers.");
    if (!littleEndian) values[i] = value;
    if (i % 4096 === 0 && performance.now() >= deadline) { await yieldTask(); check(); deadline = performance.now() + 2; }
  }
  check(); retain(lut.data, values); return lut;
}
export const lutOptionsSchema = z.object({
  amount: z.number().finite().min(0).max(100).optional(), interpolation: z.enum(["tetrahedral", "trilinear"]).optional(),
}).strict();
export const lutAdjustmentSchema = z.object({
  kind: z.literal("lut"), lut: cubeLutSchema, amount: z.number().finite().min(0).max(100),
  interpolation: z.enum(["tetrahedral", "trilinear"]),
}).strict();

const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Adobe/IRIDAS Cube 1.0: exactly one 1D or 3D table, with red changing fastest. */
export function parseCubeLut(source: string): CubeLutData {
  if (typeof source !== "string") throw new Error("Expected .cube text.");
  let title = "Untitled LUT", dimension: 1 | 3 | undefined, size = 0, rows = 0;
  let domainMin: [number, number, number] = [0, 0, 0], domainMax: [number, number, number] = [1, 1, 1];
  const seen = new Set<string>(); let raw: Uint8Array | undefined, view: DataView | undefined;
  const fail = (line: number, message: string): never => { throw new Error(`Invalid .cube at line ${line}: ${message}`); };
  let lineNumber = 0;
  // Iterate lines without retaining a second array of all source lines/tokens.
  for (const match of source.replace(/^\uFEFF/, "").matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    lineNumber++;
    const line = match[0].trim(); if (!line || line.startsWith("#")) continue;
    if (line.startsWith("TITLE")) {
      if (rows || seen.has("TITLE")) fail(lineNumber, "Repeated or misplaced TITLE.");
      const name = /^TITLE\s+"([^"\r\n]*)"\s*(?:#.*)?$/.exec(line)?.[1];
      if (name === undefined || name.length > 240) fail(lineNumber, "TITLE must be quoted and at most 240 characters.");
      title = name!; seen.add("TITLE"); continue;
    }
    const tokens = line.split("#", 1)[0].trim().split(/\s+/), key = tokens[0];
    if (["LUT_1D_SIZE", "LUT_3D_SIZE", "DOMAIN_MIN", "DOMAIN_MAX"].includes(key)) {
      if (rows || seen.has(key)) fail(lineNumber, `Repeated or misplaced ${key}.`);
      seen.add(key);
      if (key.startsWith("LUT_")) {
        if (dimension || tokens.length !== 2 || !/^\d+$/.test(tokens[1])) fail(lineNumber, "Declare exactly one 1D or 3D table size.");
        dimension = key === "LUT_1D_SIZE" ? 1 : 3; size = Number(tokens[1]);
        if (size < 2 || size > (dimension === 1 ? 65536 : 256)) fail(lineNumber, "Table size is outside the .cube format range.");
      } else {
        if (tokens.length !== 4 || tokens.slice(1).some(value => !numeric.test(value) || !Number.isFinite(Number(value)))) fail(lineNumber, "Expected three finite domain numbers.");
        const values = tokens.slice(1).map(Number) as [number, number, number];
        if (key === "DOMAIN_MIN") domainMin = values; else domainMax = values;
      }
      continue;
    }
    if (!dimension) fail(lineNumber, "Declare LUT_1D_SIZE or LUT_3D_SIZE before data.");
    if (tokens.length !== 3 || tokens.some(value => !numeric.test(value) || !Number.isFinite(Math.fround(Number(value)))))
      fail(lineNumber, "Expected three finite float32 table values; unsupported directives cannot be ignored.");
    const count = dimension === 1 ? size : size ** 3;
    if (rows >= count) fail(lineNumber, "Too many table rows.");
    if (!raw) { raw = new Uint8Array(count * 12); view = new DataView(raw.buffer); }
    for (let c = 0; c < 3; c++) view!.setFloat32((rows * 3 + c) * 4, Number(tokens[c]), true);
    rows++;
  }
  if (!dimension || rows !== (dimension === 1 ? size : size ** 3)) throw new Error("Incomplete .cube table: row count does not match the declared size.");
  return cubeLutSchema.parse({ title, dimension, size, domainMin, domainMax, data: encode(raw!) });
}

export function serializeCubeLut(input: CubeLutData): string {
  const lut = cubeLutSchema.parse(input), values = lutValues(lut);
  const rows = [`TITLE "${lut.title.replace(/["\r\n]/g, " ")}"`, `LUT_${lut.dimension}D_SIZE ${lut.size}`,
    `DOMAIN_MIN ${lut.domainMin.join(" ")}`, `DOMAIN_MAX ${lut.domainMax.join(" ")}`];
  const number = (value: number) => Object.is(value, -0) ? "-0" : String(value);
  for (let i = 0; i < values.length; i += 3) rows.push(`${number(values[i])} ${number(values[i + 1])} ${number(values[i + 2])}`);
  return rows.join("\n") + "\n";
}
export function defaultLutAdjustment(): LutAdjustmentData {
  return { kind: "lut", lut: parseCubeLut('TITLE "Identity"\nLUT_1D_SIZE 2\n0 0 0\n1 1 1'), amount: 100, interpolation: "tetrahedral" };
}
