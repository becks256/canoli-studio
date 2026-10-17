import { z } from 'zod';
import { selectionSchema } from './drawing';
import type { SelectionModificationControl } from './selection-modification';

export const MAX_ALPHA_CHANNELS = 64;
const identifier = z.string().min(1).max(240);
export const alphaChannelSchema = z.object({
  id: identifier, name: identifier, selection: selectionSchema,
}).strict();
export type AlphaChannelData = z.infer<typeof alphaChannelSchema>;
export const channelLoadOptionsSchema = z.object({
  operation: z.enum(['replace','add','subtract','intersect']).default('replace'),
  invert: z.boolean().default(false),
}).strict();
export type ChannelLoadOptions = z.input<typeof channelLoadOptionsSchema>;
export const channelLoadSchema = channelLoadOptionsSchema.extend({id:identifier});
export type ChannelLoadSettings = z.output<typeof channelLoadSchema>;
export type ChannelLoadControl = SelectionModificationControl;
export const channelCoverageSchema = channelLoadOptionsSchema.extend({
  selection: selectionSchema, base: selectionSchema.nullable(),
  width: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type ChannelCoverageRequest = z.output<typeof channelCoverageSchema>;
