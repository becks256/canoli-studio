import {z} from 'zod';
import {freezeOwnedData} from '../core/immutable';
import {fontDigest,fontFaceId,fontInspectionSchema,type FontPreparedBytes} from './types';

const sha256=z.string().regex(/^[a-f0-9]{64}$/);
export const fontResourceDescriptorSchema=z.object({
  version:z.literal(1),
  report:fontInspectionSchema.refine(value=>value.faces.length===1,'A font resource owns exactly one selected face.'),
  render:z.object({sha256,byteLength:z.number().int().positive().safe(),format:z.enum(['ttf','otf','woff','woff2'])}).strict(),
  extracted:z.boolean(),repacked:z.boolean(),omittedTables:z.array(z.literal('DSIG')).max(1),
}).strict().superRefine((value,context)=>{
  const collection=['ttc','dfont'].includes(value.report.format);
  if(value.extracted!==collection||value.repacked!==(value.report.format==='ttc')||value.omittedTables.length&&!value.repacked)
    context.addIssue({code:'custom',message:'Inconsistent font resource transformation.'});
  if(!collection&&(value.report.format!==value.render.format||value.report.sha256!==value.render.sha256||value.report.byteLength!==value.render.byteLength))
    context.addIssue({code:'custom',message:'Standalone font resources must retain exact source bytes.'});
});
export type FontResourceDescriptor=z.infer<typeof fontResourceDescriptorSchema>;
export interface FontResourceInput {descriptor:FontResourceDescriptor;original:Blob;renderBlob:Blob}
export interface FontResource extends FontResourceInput {readonly id:string;readonly cssFamily:string}

export function describePreparedFont(prepared:FontPreparedBytes):FontResourceDescriptor{
  const report=fontInspectionSchema.parse(prepared.report);
  if(report.faces.length!==1||report.offset!==prepared.faceIndex||report.faces[0].index!==prepared.faceIndex)throw new Error('Font resource selection does not match its source.');
  return fontResourceDescriptorSchema.parse({version:1,report,render:{sha256:prepared.renderSha256,byteLength:prepared.renderBlob.size,format:prepared.renderFormat},extracted:prepared.extracted,repacked:prepared.repacked,omittedTables:prepared.omittedTables});
}

/** Own declarations before yielding; Blobs themselves are immutable. No native
 * registration, model mutation or claim of parser/native validation occurs here. */
export async function ownFontResource(input:FontResourceInput,check:()=>void=()=>{}):Promise<Readonly<FontResource>>{
  const descriptor=fontResourceDescriptorSchema.parse(input.descriptor),original=input.original,renderBlob=input.renderBlob;
  if(!(original instanceof Blob)||!(renderBlob instanceof Blob)||original.size!==descriptor.report.byteLength||renderBlob.size!==descriptor.render.byteLength)throw new Error('Font resource byte lengths differ from their declarations.');
  if(renderBlob.type!==`font/${descriptor.render.format}`)throw new Error('Native font MIME differs from its format.');
  check();
  if(await fontDigest(await original.arrayBuffer())!==descriptor.report.sha256)throw new Error('Original font checksum mismatch.');check();
  if(await fontDigest(await renderBlob.arrayBuffer())!==descriptor.render.sha256)throw new Error('Native font checksum mismatch.');check();
  const face=descriptor.report.faces[0];
  if(face.id!==await fontFaceId(descriptor.report.sha256,face.index))throw new Error('Font resource identity differs from its source.');check();
  const header=await renderBlob.slice(0,4).arrayBuffer();check();
  const signatures={ttf:[0x00010000,0x74727565],otf:[0x4f54544f],woff:[0x774f4646],woff2:[0x774f4632]};
  if(header.byteLength!==4||!signatures[descriptor.render.format].includes(new DataView(header).getUint32(0)))throw new Error('Native font signature differs from its format.');
  const owned=await freezeOwnedData(descriptor);check();
  return Object.freeze({id:face.id,cssFamily:face.cssFamily,descriptor:owned,original,renderBlob});
}

export const sameFontResource=(a:FontResourceDescriptor,b:FontResourceDescriptor)=>JSON.stringify(fontResourceDescriptorSchema.parse(a))===JSON.stringify(fontResourceDescriptorSchema.parse(b));
