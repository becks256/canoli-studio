import type { BrushStrokeData, Rect } from "../core/drawing";
import {
  createWetStrokeSession,
  createFloatWetStrokeSession,
} from "./wet-session";
import type {
  WetProcessor,
  WetStrokeOptions,
  WetStrokeResult,
  FloatWetProcessor,
  FloatWetStrokeOptions,
} from "./wet-state";
export { WetStrokeResult } from "./wet-state";
export type {
  WetStrokeTile,
  WetStrokeControl,
  WetStrokeOptions,
} from "./wet-state";

/** One-shot preparation and retained live sessions share the same native replay.
 * Finishing transfers the private job to the owned immutable result. */
export async function prepareWetStroke(
  input: BrushStrokeData,
  readSource: (region: Rect) => Promise<Uint8ClampedArray>,
  processor: WetProcessor,
  options: WetStrokeOptions = {},
): Promise<WetStrokeResult> {
  const session = await createWetStrokeSession(
    input,
    readSource,
    processor,
    options,
  );
  try {
    return await session.finish();
  } finally {
    await session.dispose();
  }
}

/** Private native linear float replay; output remains Float32 through storage. */
export async function prepareFloatWetStroke(
  input: BrushStrokeData,
  readSource: (region: Rect) => Promise<Float32Array>,
  processor: FloatWetProcessor,
  options: FloatWetStrokeOptions = {},
): Promise<WetStrokeResult<Float32Array>> {
  const session = await createFloatWetStrokeSession(
    input,
    readSource,
    processor,
    options,
  );
  try {
    return await session.finish();
  } finally {
    await session.dispose();
  }
}
