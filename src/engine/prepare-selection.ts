import { PixelProcessor } from './processor';
import type { SelectionModificationRequest, SelectionModificationControl } from '../core/selection-modification';
import { selectionSchema, type SelectionData } from '../core/drawing';

/** Dedicated worker ownership makes cancellation stop queued and active pixel work. */
export async function prepareSelectionModification(
  request: SelectionModificationRequest, control: SelectionModificationControl = {},
  check: () => void = () => {},
): Promise<SelectionData> {
  check(); control.signal?.throwIfAborted();
  const processor = new PixelProcessor();
  const cancel = () => processor.dispose();
  control.signal?.addEventListener('abort',cancel,{once:true});
  try {
    const result = await processor.modifySelection(request, progress => {
      try { check(); control.signal?.throwIfAborted(); control.onProgress?.(progress); }
      catch { processor.dispose(); }
    });
    check(); control.signal?.throwIfAborted();
    return selectionSchema.parse(result);
  } catch (error) {
    check(); control.signal?.throwIfAborted();
    throw error;
  } finally {
    control.signal?.removeEventListener('abort',cancel);
    processor.dispose();
  }
}
