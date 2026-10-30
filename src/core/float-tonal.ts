import {z} from 'zod';
import type {DodgeBurnOptions} from './retouch/types';

/** Float strokes apply exposure in working-linear RGB. Coverage already
 * includes brush flow; it is not applied again by the scene compositor. */
export const floatTonalOptionsSchema = z.object({
  mode: z.enum(['dodge', 'burn']),
  range: z.enum(['shadows', 'midtones', 'highlights']),
  exposure: z.number().finite().min(0).max(1),
  flow: z.number().finite().min(0).max(1).default(1),
  protectTones: z.boolean().default(true),
}).strict();
export type FloatTonalOptions = DodgeBurnOptions;
