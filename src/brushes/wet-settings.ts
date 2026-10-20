import {z} from 'zod';
export const wetToolSettingsSchema=z.object({load:z.number().finite().min(0).max(1),wetness:z.number().finite().min(0).max(1),pickup:z.number().finite().min(0).max(1)}).strict();
export type WetToolSettings=z.infer<typeof wetToolSettingsSchema>;
export const DEFAULT_SMUDGE: Readonly<WetToolSettings>=Object.freeze({load:0,wetness:0,pickup:.5});
export const DEFAULT_MIXER: Readonly<WetToolSettings>=Object.freeze({load:1,wetness:.25,pickup:.5});
