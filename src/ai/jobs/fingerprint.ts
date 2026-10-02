import { computeSha256 } from "../batch/manifest";
import type { GenerationRequest } from "../providers/types";

/** Hash request semantics without writing prompts or input image bytes to the journal. */
export async function generationFingerprint(
  request: GenerationRequest,
): Promise<string> {
  async function canonical(value: unknown): Promise<unknown> {
    if (value instanceof Uint8Array)
      return { sha256: await computeSha256(value), bytes: value.byteLength };
    if (Array.isArray(value)) return Promise.all(value.map(canonical));
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort()) {
        const item = (value as Record<string, unknown>)[key];
        if (item !== undefined) result[key] = await canonical(item);
      }
      return result;
    }
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("Generation request contains a nonfinite value.");
    return value;
  }
  return computeSha256(
    JSON.stringify(await canonical(structuredClone(request))),
  );
}
