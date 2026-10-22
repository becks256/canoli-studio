import {z} from 'zod';

export const avifDecodeOptionsSchema=z.object({
  allowPrecisionLoss:z.boolean().default(false),
  assumeSrgb:z.boolean().default(false),
}).strict();
export type AvifDecodeOptions=z.input<typeof avifDecodeOptionsSchema>;
export type AvifDecodeSettings=z.output<typeof avifDecodeOptionsSchema>;
export interface AvifImportControl {signal?:AbortSignal;onProgress?:(value:{phase:'inspecting'|'decoding';fraction:number|null})=>void}
const dimension=z.number().int().positive().max(0x7fffffff);
export const avifImportReportSchema=z.object({
  version:z.literal(1),primaryItem:z.number().int().positive().safe(),
  width:dimension,height:dimension,displayWidth:dimension,displayHeight:dimension,
  bitDepth:z.union([z.literal(8),z.literal(10),z.literal(12)]).nullable(),alpha:z.boolean(),
  grid:z.boolean(),rotation:z.number().int().min(0).max(3),mirror:z.union([z.literal(0),z.literal(1)]).nullable(),
  crop:z.object({x:z.number().int().nonnegative().safe(),y:z.number().int().nonnegative().safe(),width:dimension,height:dimension}).strict(),
  color:z.object({kind:z.enum(['srgb','display-p3','linear-srgb','icc','unspecified','unsupported']),
    primaries:z.number().int().nonnegative().nullable(),transfer:z.number().int().nonnegative().nullable(),matrix:z.number().int().nonnegative().nullable(),fullRange:z.boolean().nullable()}).strict(),
  requiresPrecisionLoss:z.boolean(),requiresColorAssumption:z.boolean(),canDecode:z.boolean(),
  unsupported:z.array(z.string()),warnings:z.array(z.string()),
}).strict().superRefine((report,context)=>{
  const crop=report.crop,swapped=report.rotation%2===1;
  if(!Number.isSafeInteger(report.width*report.height*4)||crop.x+crop.width>report.width||crop.y+crop.height>report.height||report.displayWidth!==(swapped?crop.height:crop.width)||report.displayHeight!==(swapped?crop.width:crop.height)||report.requiresPrecisionLoss!==(report.bitDepth!==null&&report.bitDepth>8)||report.requiresColorAssumption!==(report.color.kind==='unspecified')||report.canDecode!==(report.unsupported.length===0)||report.canDecode&&(report.color.kind==='unsupported'||report.bitDepth===null))context.addIssue({code:'custom',message:'Inconsistent AVIF import report.'});
});
export type AvifImportReport=z.infer<typeof avifImportReportSchema>;
export const avifUnidentifiedColorWarning='Container properties do not fully identify RGB. Allow an sRGB fallback before decoding; any identified native AV1 color takes precedence.';

/** RGB sample interpretation only; YUV matrix/range validation is separate. */
export function avifRgbKind(primaries:number,transfer:number):AvifImportReport['color']['kind']{
  if([1,2].includes(primaries)&&[2,13].includes(transfer))return primaries===2||transfer===2?'unspecified':'srgb';
  if(primaries===12&&transfer===13)return 'display-p3';
  if(primaries===1&&transfer===8)return 'linear-srgb';
  return 'unsupported';
}
