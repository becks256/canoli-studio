import {lensCorrectionSchema} from './lens';
import {z} from 'zod';

export const rawDevelopOptionsSchema=z.object({
  lens:lensCorrectionSchema.optional(),
  image:z.number().int().nonnegative().max(0xffffffff).default(0),
  whiteBalance:z.enum(['camera','auto','daylight','custom']).default('camera'),
  demosaic:z.enum(['linear','vng','ppg','ahd','dcb','dht','aahd']).default('ahd'),
  exposure:z.number().finite().min(-2).max(3).default(0),
  highlightPreservation:z.number().finite().min(0).max(1).default(0),
  highlights:z.number().int().min(0).max(9).default(0),
  multipliers:z.object({red:z.number().finite().min(0.01).max(64).default(1),green:z.number().finite().min(0.01).max(64).default(1),blue:z.number().finite().min(0.01).max(64).default(1)}).strict().prefault({}),
}).strict();
export type RawDevelopOptions=z.input<typeof rawDevelopOptionsSchema>;
export type RawDevelopSettings=z.output<typeof rawDevelopOptionsSchema>;
export const rawDecodeOptionsSchema=z.object({allowPrecisionLoss:z.boolean().default(false),development:rawDevelopOptionsSchema.prefault({})}).strict();
export type RawDecodeOptions=z.input<typeof rawDecodeOptionsSchema>;
export type RawDecodeSettings=z.output<typeof rawDecodeOptionsSchema>;
export function parseRawDevelopmentOptions(input:RawDecodeOptions):RawDecodeSettings{
  const settings=rawDecodeOptionsSchema.parse(input);if(!settings.allowPrecisionLoss)throw new Error('RAW working output requires explicit 8-bit precision-loss consent.');return settings;
}

const dimension=z.number().int().positive().max(0x7fffffff);
export const rawImportReportSchema=z.object({
  version:z.literal(1),nativeVersion:z.string().min(1).max(256),
  make:z.string().max(256),model:z.string().max(256),decoder:z.string().max(256),
  rawWidth:dimension,rawHeight:dimension,width:dimension,height:dimension,displayWidth:dimension,displayHeight:dimension,
  flip:z.number().int().min(0).max(7),imageCount:z.number().int().positive().max(0xffffffff),image:z.number().int().nonnegative().max(0xffffffff),
  channels:z.number().int().min(1).max(4),filters:z.number().int().nonnegative().max(0xffffffff),cfaDescription:z.string().max(256),
  dngVersion:z.number().int().nonnegative().max(0xffffffff),foveon:z.boolean(),
  bitDepth:z.number().int().min(1).max(64).nullable(),blackLevel:z.number().int().nonnegative().max(0xffffffff),whiteLevel:z.number().int().nonnegative().max(0xffffffff),
  hasCameraWhiteBalance:z.boolean(),hasColorMatrix:z.boolean(),hasExtraSamples:z.boolean(),nativeWarnings:z.number().int().nonnegative().max(0xffffffff),
  canDevelop:z.boolean(),unsupported:z.array(z.string()),warnings:z.array(z.string()),
}).strict().superRefine((report,context)=>{
  if(report.image>=report.imageCount||report.canDevelop!==(report.unsupported.length===0)||report.canDevelop&&(!report.hasColorMatrix||report.hasExtraSamples)||!Number.isSafeInteger(report.rawWidth*report.rawHeight*8)||!Number.isSafeInteger(report.displayWidth*report.displayHeight*8))context.addIssue({code:'custom',message:'Inconsistent RAW import report.'});
});
export type RawImportReport=z.infer<typeof rawImportReportSchema>;
export interface RawImportControl {signal?:AbortSignal;onProgress?:(value:{phase:'inspecting'|'developing'|'encoding';fraction:number|null})=>void}
