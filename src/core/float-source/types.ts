import{z}from'zod';
import build from'../color/codec/build.json' with{type:'json'};
import{iccIntentSchema,iccRgbPreparationSchema}from'../color/icc-types';
import{tiffDecodeOptionsSchema,tiffFloatColorSchema}from'../interchange/tiff/types';
import{Sha256}from'../sha256';
export const FLOAT_SOURCE_VERSION=1;
export const FLOAT_SOURCE_NATIVE_SHA=build.artifacts['canoli_icc.wasm'].sha256;
const hash=z.string().regex(/^[a-f0-9]{64}$/),integer=z.number().int().positive().safe();
export const floatSourceInputSchema=z.object({original:z.instanceof(Blob),target:z.instanceof(Blob),width:integer,height:integer,tiff:tiffDecodeOptionsSchema,expectedSource:tiffFloatColorSchema.shape.source,intent:iccIntentSchema,blackPointCompensation:z.boolean()}).strict();
export type FloatSourceInput=z.infer<typeof floatSourceInputSchema>;
export const floatSourceDescriptorSchema=z.object({version:z.literal(1),format:z.literal('rgba-float32-le'),sourceSha256:hash,sourceBytes:integer,width:integer,height:integer,orientation:z.number().int().min(1).max(8),tiff:tiffDecodeOptionsSchema,sourceProfileSha256:hash,targetProfileSha256:hash,intent:iccIntentSchema,blackPointCompensation:z.boolean(),nativeWasmSha256:z.literal(FLOAT_SOURCE_NATIVE_SHA),tileWidth:integer.max(256),tileHeight:integer.max(64)}).strict().superRefine((v,c)=>{if(!Number.isSafeInteger(Math.ceil(v.width/v.tileWidth)*Math.ceil(v.height/v.tileHeight)))c.addIssue({code:'custom',message:'Float source tile addressing exceeds numeric precision.'});});
export type FloatSourceDescriptor=z.infer<typeof floatSourceDescriptorSchema>;
export const floatTileMetaSchema=z.object({index:z.number().int().nonnegative().safe(),width:integer.max(256),height:integer.max(64),rawBytes:integer.max(256*64*16),encodedBytes:integer.max(256*64*16+65536),rawSha256:hash,encodedSha256:hash}).strict();
export type FloatTileMeta=z.infer<typeof floatTileMetaSchema>;
export const floatManifestSchema=z.object({version:z.literal(1),key:hash,buildId:z.string().uuid(),descriptor:floatSourceDescriptorSchema,prepared:iccRgbPreparationSchema,tiles:z.array(floatTileMetaSchema)}).strict();
export type FloatSourceManifest=z.infer<typeof floatManifestSchema>;
export interface FloatEncodedTile{meta:FloatTileMeta;blob:Blob}
export interface FloatSourceProgress{phase:'inspecting'|'hashing'|'waiting'|'converting'|'reading'|'cached';fraction:number|null}
export interface FloatSourceControl{signal?:AbortSignal;onProgress?:(progress:FloatSourceProgress)=>void}
export interface FloatSourceWindow{x:number;y:number;width:number;height:number}
export function descriptorKey(input:FloatSourceDescriptor){const value=floatSourceDescriptorSchema.parse(input);return new Sha256().update(new TextEncoder().encode(JSON.stringify(value))).digest();}
export function tileCount(d:FloatSourceDescriptor){return Math.ceil(d.width/d.tileWidth)*Math.ceil(d.height/d.tileHeight);}
export function tileGeometry(d:FloatSourceDescriptor,index:number){const across=Math.ceil(d.width/d.tileWidth);if(!Number.isSafeInteger(index)||index<0||index>=tileCount(d))throw new Error('Float tile index exceeds original geometry.');const x=index%across*d.tileWidth,y=Math.floor(index/across)*d.tileHeight;return{x,y,width:Math.min(d.tileWidth,d.width-x),height:Math.min(d.tileHeight,d.height-y)};}
export function validateTileMeta(d:FloatSourceDescriptor,input:FloatTileMeta){const value=floatTileMetaSchema.parse(input),bounds=tileGeometry(d,value.index);if(value.width!==bounds.width||value.height!==bounds.height||value.rawBytes!==bounds.width*bounds.height*16||value.encodedBytes>value.rawBytes+65536)throw new Error('Float tile metadata differs from original geometry.');return value;}
export function validateFloatPreparation(d:FloatSourceDescriptor,input:unknown){const prepared=iccRgbPreparationSchema.parse(input);if(prepared.settings.inputFormat!=='rgba-float32'||prepared.settings.outputFormat!=='rgba-float32'||prepared.settings.intent!==d.intent||prepared.settings.blackPointCompensation!==d.blackPointCompensation||prepared.source.colorSpace!=='RGB '||prepared.destination.colorSpace!=='RGB ')throw new Error('Float source conversion receipt differs from its identity.');return prepared;}
export function validateManifest(input:unknown,descriptor?:FloatSourceDescriptor):FloatSourceManifest{
 const value=floatManifestSchema.parse(input),d=value.descriptor;if(value.key!==descriptorKey(d)||descriptor&&JSON.stringify(d)!==JSON.stringify(descriptor)||value.tiles.length!==tileCount(d))throw new Error('Float source manifest identity or completeness differs.');
 validateFloatPreparation(d,value.prepared);
 for(let i=0;i<value.tiles.length;i++){if(value.tiles[i].index!==i)throw new Error('Float source tile order is incomplete.');validateTileMeta(d,value.tiles[i]);}return value;
}
export function validateWindow(input:FloatSourceWindow){const v=z.object({x:z.number().int().safe(),y:z.number().int().safe(),width:integer,height:integer}).strict().parse(input);if(!Number.isSafeInteger(v.x+v.width)||!Number.isSafeInteger(v.y+v.height)||!Number.isSafeInteger(v.width*v.height)||v.width*v.height>262144)throw new Error('Float read window exceeds the 262144-pixel working-buffer budget; original geometry is unchanged.');return v;}
export function windowTiles(d:FloatSourceDescriptor,input:FloatSourceWindow){const b=validateWindow(input),left=Math.max(0,b.x),right=Math.min(d.width,b.x+b.width),top=Math.max(0,b.y),bottom=Math.min(d.height,b.y+b.height),indices:number[]=[];if(right<=left||bottom<=top)return indices;const across=Math.ceil(d.width/d.tileWidth);for(let y=Math.floor(top/d.tileHeight);y<=Math.floor((bottom-1)/d.tileHeight);y++)for(let x=Math.floor(left/d.tileWidth);x<=Math.floor((right-1)/d.tileWidth);x++)indices.push(y*across+x);return indices;}
