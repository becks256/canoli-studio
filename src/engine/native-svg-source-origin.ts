import { AffineTransform } from "../core/affine";
import { yieldTask } from "../core/task-yield";
import type { FloatGlyph } from "./float-glyph";

/** Retain one source fragment's paint origin when replaying sideways glyphs.
 * Moving each offset into a separate SVG text address introduces another
 * layout-coordinate conversion. Keep the first captured pose as the common
 * address and express the retained relative poses in their affine placement.
 * This is an additional preparation, never a displacement fitted from pixels.
 * Original ink at both opacities and color ownership still decide publication. */
export async function shareNativeSvgSourceOrigin(
  glyphs: readonly Readonly<FloatGlyph>[],
  check: () => void,
): Promise<readonly Readonly<FloatGlyph>[] | undefined> {
  check();
  const first = glyphs[0];
  if (!first?.origin || glyphs.length < 2) return;
  const world = first.transform,
    fields = ["a", "b", "c", "d", "e", "f"] as const;
  if (
    glyphs.some(
      (glyph) =>
        !glyph.origin ||
        glyph.path ||
        glyph.writing?.orientation !== "sideways" ||
        fields.some((key) => glyph.transform[key] !== world[key]),
    )
  )
    return;
  const origin = Object.freeze({ ...first.origin }),
    result: Readonly<FloatGlyph>[] = [];
  let changed = false,
    deadline = performance.now() + 2;
  for (const glyph of glyphs) {
    check();
    const dx = glyph.origin!.x - origin.x,
      dy = glyph.origin!.y - origin.y;
    if (![dx, dy].every(Number.isFinite))
      throw new Error("Invalid native source-origin displacement.");
    changed ||= dx !== 0 || dy !== 0;
    result.push(
      dx || dy
        ? Object.freeze({
            ...glyph,
            origin,
            transform: glyph.transform.multiply(
              AffineTransform.translation(dx, dy),
            ),
          })
        : glyph,
    );
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  }
  check();
  return changed ? Object.freeze(result) : undefined;
}
