import {z} from 'zod';
import {hasLensCorrection,validateLensGeometry} from '../../core/interchange/raw/lens';
import {rawDecodeOptionsSchema,rawImportReportSchema} from '../../core/interchange/raw/types';

/** Reviewed metadata only. Accepted pixels/provenance belong to the later prepared project. */
export const batchRawSourceSchema=z.object({version:z.literal(1),originalName:z.string().min(1),options:rawDecodeOptionsSchema,report:rawImportReportSchema}).strict().superRefine((value,context)=>{
  if(hasLensCorrection(value.options.development.lens)){try{validateLensGeometry(value.options.development.lens!,value.report.displayWidth,value.report.displayHeight);}catch(error){context.addIssue({code:'custom',message:String(error)});}}
  if(!value.options.allowPrecisionLoss||!value.report.canDevelop||value.options.development.image!==value.report.image||value.options.development.whiteBalance==='camera'&&value.report.channels>1&&!value.report.hasCameraWhiteBalance)
    context.addIssue({code:'custom',message:'RAW batch input requires explicit precision-loss consent and supported native settings.'});
});
export type BatchRawSource=z.infer<typeof batchRawSourceSchema>;
