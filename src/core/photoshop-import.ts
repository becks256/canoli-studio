import {z} from 'zod';
import {allLayers,type DocumentData} from './model';

/** Empty PSD folders are editable content even when no image source is needed. */
export function isPhotoshopGroupOnlyDocument(document:DocumentData):boolean{
 const nodes=allLayers(document.children);return nodes.length>0&&nodes.every(node=>node.kind==='group');
}

export type PhotoshopInput=Blob|ArrayBuffer|Uint8Array;
export interface PhotoshopImportProgress {phase:'inspecting'|'decoding'|'encoding'|'installing';fraction:number|null}
export interface PhotoshopImportControl {signal?:AbortSignal;onProgress?(value:PhotoshopImportProgress):void}
export const photoshopOptionsSchema=z.object({mode:z.enum(['layered','flatten']).optional(),legacyStraightAlpha:z.boolean().optional(),convertCmyk:z.boolean().optional(),preserveMasks:z.boolean().optional()}).strict();
export const photoshopProgressSchema=z.object({phase:z.enum(['inspecting','decoding','encoding','installing']),fraction:z.number().min(0).max(1).nullable()}).strict();
export const photoshopReportSchema=z.object({supportedConstructs:z.array(z.string()),warnings:z.array(z.string()),degradedFeatures:z.array(z.string()),layerCount:z.number().int().nonnegative(),colorMode:z.string(),bitDepth:z.number().int().positive(),hasComposite:z.boolean(),hasIccProfile:z.boolean(),canImportAsLayers:z.boolean()}).strict();
const integer=z.number().int().safe();
export const photoshopInspectionSchema=z.object({version:z.literal(1),header:z.object({signature:z.literal('8BPS'),version:z.union([z.literal(1),z.literal(2)]),channels:integer.min(1).max(56),height:integer.positive().max(300000),width:integer.positive().max(300000),depth:z.union([z.literal(1),z.literal(8),z.literal(16),z.literal(32)]),colorMode:integer.min(0).max(65535)}).strict(),layers:z.array(z.object({name:z.string(),width:integer.nonnegative(),height:integer.nonnegative(),blendModeKey:z.string(),opacity:integer.min(0).max(255),isGroup:z.boolean().optional(),isGroupEnd:z.boolean().optional()}).strict()),resolution:z.object({hRes:z.number().finite(),vRes:z.number().finite()}).strict().optional(),report:photoshopReportSchema}).strict().superRefine((value,context)=>{
 if(value.report.layerCount!==value.layers.length||value.report.bitDepth!==value.header.depth)context.addIssue({code:'custom',message:'Photoshop inspection counts do not match the header/records.'});
 if(value.header.version===1&&(value.header.width>30000||value.header.height>30000))context.addIssue({code:'custom',message:'Invalid PSD dimensions.'});
});
export type PhotoshopInspection=z.infer<typeof photoshopInspectionSchema>;

/** Snapshot mutable legacy buffers; Blob/File sources remain immutable and shared. */
export function photoshopInputBlob(source:PhotoshopInput):Blob {
 if(source instanceof Blob)return source;
 if(source instanceof ArrayBuffer)return new Blob([source]);
 if(!(source instanceof Uint8Array))throw new Error('Choose a Photoshop file or byte buffer.');
 return new Blob([new Uint8Array(source).buffer]);
}
