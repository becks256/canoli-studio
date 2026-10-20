import { z } from 'zod';
import { AffineTransform } from './affine';
import { affineSchema } from './transform-schema';

/** Source preparation and immutable authored brush texture contracts. */
export const textureMaskOptionsSchema = z.object({
  channel: z.enum(['alpha', 'luminance']).default('luminance'),
  invert: z.boolean().default(false),
}).strict();
export type TextureMaskOptions = z.input<typeof textureMaskOptionsSchema>;
export type TextureMaskSettings = z.output<typeof textureMaskOptionsSchema>;

export const brushTextureSourceSchema = z.object({
  assetId: z.string().min(1).max(240),
  ...textureMaskOptionsSchema.shape,
}).strict();
export type BrushTextureSource = z.input<typeof brushTextureSourceSchema>;
export const brushTextureSchema=z.object({
  assetId:brushTextureSourceSchema.shape.assetId,
  channel:z.enum(['alpha','luminance']),
  invert:z.boolean(),
}).strict();
export type BrushTextureData=z.infer<typeof brushTextureSchema>;

const coordinate = z.number().finite().nonnegative();
const extent = z.number().finite().positive();
export const textureSampleSchema = z.object({
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
  sourceRect: z.object({ x: coordinate, y: coordinate, width: extent, height: extent }).strict().optional(),
  smoothing: z.boolean().default(true),
}).strict().refine(value => value.width * value.height <= 4_000_000,
  'Split texture sampling into working tiles of at most 4,000,000 pixels.');
export type TextureSample = z.input<typeof textureSampleSchema>;

export const textureAffineSampleSchema = z.object({
  width: textureSampleSchema.shape.width,
  height: textureSampleSchema.shape.height,
  smoothing: textureSampleSchema.shape.smoothing,
  sourceToOutput: affineSchema,
}).strict().refine(value => value.width * value.height <= 4_000_000,
  'Split texture sampling into working tiles of at most 4,000,000 pixels.');
export type TextureAffineSample = z.input<typeof textureAffineSampleSchema>;

/** Original source pixels map directly to this working tile, including rotation/shear. */
export function textureAffineSample(source: {width:number;height:number}, input:TextureAffineSample) {
  const sample=textureAffineSampleSchema.parse(input);
  textureSample(source,{width:sample.width,height:sample.height});
  const mapping=AffineTransform.fromJSON(sample.sourceToOutput);
  mapping.bounds({x:0,y:0,width:source.width,height:source.height});
  return sample;
}

/** Working-output limits only. Neither original image dimensions nor bytes are capped. */
export function textureSample(
  source: { width: number; height: number },
  input: TextureSample,
) {
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width <= 0 || source.height <= 0)
    throw new Error('Texture source dimensions must be positive safe integers.');
  const sample = textureSampleSchema.parse(input);
  const sourceRect = sample.sourceRect ?? { x: 0, y: 0, width: source.width, height: source.height };
  if (sourceRect.x + sourceRect.width > source.width || sourceRect.y + sourceRect.height > source.height ||
      sourceRect.x + sourceRect.width === sourceRect.x || sourceRect.y + sourceRect.height === sourceRect.y)
    throw new Error('Texture sampling must cover a representable region inside the original source image.');
  return { ...sample, sourceRect };
}
