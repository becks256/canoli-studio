import {z} from 'zod';

export const layerAlignmentSchema=z.enum(['left','center','right','top','middle','bottom']);
export const alignmentTargetSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('selection')}).strict(),
  z.object({type:z.literal('canvas')}).strict(),
  z.object({type:z.literal('layer'),id:z.string().min(1).max(240)}).strict(),
]);
export type LayerAlignment=z.infer<typeof layerAlignmentSchema>;
export type AlignmentTarget=z.infer<typeof alignmentTargetSchema>;
