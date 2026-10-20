import type { BrushStrokeData, Rect } from '../core/drawing';
import { createWetStrokeSession } from './wet-session';
import type { WetProcessor, WetStrokeOptions, WetStrokeResult } from './wet-state';
export { WetStrokeResult } from './wet-state';
export type { WetStrokeTile, WetStrokeControl, WetStrokeOptions } from './wet-state';

/** One-shot preparation and retained live sessions share the same native replay.
 * Finishing transfers the private job to the owned immutable result. */
export async function prepareWetStroke(input: BrushStrokeData, readSource: (region: Rect) => Promise<Uint8ClampedArray>, processor: WetProcessor, options: WetStrokeOptions = {}): Promise<WetStrokeResult> {
  const session = await createWetStrokeSession(input, readSource, processor, options);
  try { return await session.finish(); } finally { await session.dispose(); }
}
