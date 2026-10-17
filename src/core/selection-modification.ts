import { z } from 'zod';
import { selectionSchema, type SelectionData } from './drawing';

export const selectionModificationSchema = z.object({
  operation: z.enum(['expand', 'contract', 'feather']),
  radius: z.number().int().min(1).max(128),
}).strict();
export type SelectionModificationOptions = z.infer<typeof selectionModificationSchema>;
export interface SelectionModificationProgress { completed: number; total: number }
export interface SelectionModificationControl {
  signal?: AbortSignal;
  onProgress?(progress: SelectionModificationProgress): void;
}
export const selectionModificationRequestSchema = selectionModificationSchema.extend({
  selection: selectionSchema,
  width: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type SelectionModificationRequest = SelectionModificationOptions & {
  selection: SelectionData; width: number; height: number;
};
