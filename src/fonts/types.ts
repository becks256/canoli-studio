import {z} from 'zod';

export const fontFormatSchema=z.enum(['ttf','otf','woff','woff2','ttc','dfont']);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const name=z.string().max(65536).nullable();
export const fontDescriptorsSchema=z.object({
  style:z.enum(['normal','italic','oblique']),
  weight:z.string().regex(/^\d+(?:\.\d+)?(?: \d+(?:\.\d+)?)?$/),
  stretch:z.string().regex(/^\d+(?:\.\d+)?%(?: \d+(?:\.\d+)?%)?$/),
}).strict();
export const fontFaceInfoSchema=z.object({
  index:z.number().int().nonnegative(),id:digest,cssFamily:z.string().regex(/^CanoliFont_[a-f0-9]{64}$/),
  family:name,subfamily:name,fullName:name,postscriptName:name,copyright:name,
  unitsPerEm:z.number().int().positive().max(65535),glyphCount:z.number().int().positive().max(65535),
  weightClass:z.number().int().nonnegative().max(65535).nullable(),
  widthClass:z.number().int().nonnegative().max(65535).nullable(),
  embeddingFlags:z.number().int().nonnegative().max(65535).nullable(),
  axes:z.array(z.object({tag:z.string().regex(/^[\x20-\x7e]{4}$/),name:z.string().max(65536).nullable(),min:z.number().finite(),default:z.number().finite(),max:z.number().finite()}).strict().refine(a=>a.min<=a.default&&a.default<=a.max,'Invalid font variation range.')),
  descriptors:z.array(fontDescriptorsSchema).min(1).max(2),
}).strict().superRefine((face,ctx)=>{
  if(face.cssFamily!==`CanoliFont_${face.id}`)ctx.addIssue({code:'custom',message:'Font family identity does not match its face.'});
  if(new Set(face.axes.map(a=>a.tag)).size!==face.axes.length)ctx.addIssue({code:'custom',message:'Duplicate font axis.'});
  for(const entry of face.descriptors){
    const weights=entry.weight.split(' ').map(Number),widths=entry.stretch.split(' ').map(v=>Number(v.slice(0,-1)));
    if(weights.some(v=>v<1||v>1000)||weights.length===2&&weights[0]>weights[1]||widths.some(v=>v<=0)||widths.length===2&&widths[0]>widths[1])ctx.addIssue({code:'custom',message:'Invalid native font descriptor range.'});
  }
});
export const fontInspectionSchema=z.object({
  version:z.literal(1),parser:z.literal('fontkit-2.0.4'),format:fontFormatSchema,
  byteLength:z.number().int().positive().safe(),sha256:digest,
  faceCount:z.number().int().positive().safe(),offset:z.number().int().nonnegative().safe(),
  faces:z.array(fontFaceInfoSchema).min(1).max(128),
}).strict().superRefine((report,ctx)=>{
  if(report.offset+report.faces.length>report.faceCount||report.faces.some((face,i)=>face.index!==report.offset+i))ctx.addIssue({code:'custom',message:'Font inspection page does not match its collection.'});
});
export const fontInspectOptionsSchema=z.object({offset:z.number().int().nonnegative().safe().default(0),limit:z.number().int().min(1).max(128).default(32)}).strict();
export const fontPrepareOptionsSchema=z.object({faceIndex:z.number().int().nonnegative().safe().optional()}).strict();
export const fontProgressSchema=z.object({phase:z.enum(['reading','inspecting','extracting','validating']),fraction:z.number().min(0).max(1).nullable()}).strict();
export const fontPreparedBytesSchema=z.object({
  report:fontInspectionSchema,faceIndex:z.number().int().nonnegative(),renderBlob:z.instanceof(Blob),
  renderSha256:digest,renderFormat:z.enum(['ttf','otf','woff','woff2']),extracted:z.boolean(),repacked:z.boolean(),omittedTables:z.array(z.literal('DSIG')).max(1),
}).strict();
export type FontFaceInfo=z.infer<typeof fontFaceInfoSchema>;
export type FontInspection=z.infer<typeof fontInspectionSchema>;
export type FontDescriptors=z.infer<typeof fontDescriptorsSchema>;
export type FontPreparedBytes=z.infer<typeof fontPreparedBytesSchema>;
export type FontInspectOptions=z.input<typeof fontInspectOptionsSchema>;
export type FontPrepareOptions=z.input<typeof fontPrepareOptionsSchema>;
export interface FontSourceControl {signal?:AbortSignal;timeoutMs?:number;onProgress?(progress:z.infer<typeof fontProgressSchema>):void}
export interface PreparedFontSource extends FontPreparedBytes {
  readonly original:Blob;
  /** Caller-owned loaded faces, deliberately absent from document.fonts. */
  readonly fontFaces:readonly FontFace[];
}
export async function fontDigest(bytes:ArrayBuffer|Uint8Array):Promise<string>{
  const buffer=bytes instanceof Uint8Array?Uint8Array.from(bytes).buffer:bytes;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export const fontFaceId=(sha256:string,index:number)=>fontDigest(new TextEncoder().encode(`canoli-font-face-v1\0${sha256}\0${index}`));
