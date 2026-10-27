import {z}from 'zod';
import {iccIntentSchema,type IccIntent}from './icc-types';
import {IccProfile,iccTarget,isIccProfile,type IccTarget}from './profile-source';
import {IccSession,type IccControl}from './icc-client';
import {builtinIccIdSchema,colorSettingsRecordSchema,type ColorSettingsRecord,type IccTargetRecord}from './color-settings-record';
export interface ColorOutput{profile:IccTarget;intent?:IccIntent;blackPointCompensation?:boolean}
export interface ColorProof{readonly profile:IccTarget;readonly intent:IccIntent;readonly blackPointCompensation:boolean;readonly proofIntent:IccIntent;readonly gamutWarning:boolean;readonly warningColor:string}
export interface ColorSettings{readonly output:Readonly<Required<ColorOutput>>;readonly proof:ColorProof|null}
const profileSchema=z.union([builtinIccIdSchema,z.custom<IccProfile>(isIccProfile,'Use an inspected ICC profile resource.')]);
const common={profile:profileSchema,intent:iccIntentSchema.default('relative-colorimetric'),blackPointCompensation:z.boolean().default(false)};
export const colorOutputSchema=z.object(common).strict();
const settingsSchema=z.object({output:colorOutputSchema,proof:z.object({...common,proofIntent:iccIntentSchema.default('relative-colorimetric'),gamutWarning:z.boolean().default(false),warningColor:z.string().regex(/^#[a-f0-9]{6}$/i).transform(v=>v.toLowerCase()).default('#00ffff')}).strict().nullable()}).strict();
export function normalizeColorOutput(value:ColorOutput):Readonly<Required<ColorOutput>>{
 const parsed=colorOutputSchema.parse(value),report=iccTarget(parsed.profile).report;
 if(report&&report.colorSpace!=='RGB ')throw new Error('Color delivery requires an RGB output profile. Use a device profile for proofing.');return Object.freeze(parsed);
}
export function normalizeColorSettings(value:ColorSettings):ColorSettings{
 const result=settingsSchema.parse(value);return Object.freeze({output:normalizeColorOutput(result.output),proof:result.proof?Object.freeze(result.proof):null});
}
export const DEFAULT_COLOR_SETTINGS:ColorSettings=normalizeColorSettings({output:{profile:'srgb',intent:'relative-colorimetric',blackPointCompensation:false},proof:null});
export function colorProofKey(proof:ColorProof):string{return JSON.stringify([iccTarget(proof.profile).key,proof.intent,proof.proofIntent,proof.blackPointCompensation,proof.gamutWarning,proof.warningColor]);}
export const proofTransformSettings=(proof:ColorProof)=>({mode:'proof' as const,intent:proof.intent,proofIntent:proof.proofIntent,blackPointCompensation:proof.blackPointCompensation,gamutWarning:proof.gamutWarning,warningColor:proof.warningColor});
const targetRecord=(profile:IccTarget):IccTargetRecord=>typeof profile==='string'?{kind:'builtin',id:profile}:{kind:'icc',name:profile.name,sha256:profile.sha256,source:profile.source};
export function serializeColorSettings(value:ColorSettings):ColorSettingsRecord{
 const settings=normalizeColorSettings(value);return{version:1,output:{...settings.output,profile:targetRecord(settings.output.profile)},proof:settings.proof?{...settings.proof,profile:targetRecord(settings.proof.profile)}:null};
}
export async function restoreColorSettings(value:ColorSettingsRecord,control:IccControl={}):Promise<ColorSettings>{
 const record=colorSettingsRecordSchema.parse(value);
 const target=async(value:IccTargetRecord):Promise<IccTarget>=>{if(value.kind==='builtin')return value.id;const profile=await IccProfile.inspect(value.source,value.name,control);if(profile.sha256!==value.sha256)throw new Error('Saved ICC profile source does not match its fingerprint.');return profile;};
 const output={...record.output,profile:await target(record.output.profile)},proof=record.proof?{...record.proof,profile:await target(record.proof.profile)}:null;control.signal?.throwIfAborted();return normalizeColorSettings({output,proof});
}

export async function preflightColorSettings(value:ColorSettings,control:IccControl={},check:()=>void=()=>{}):Promise<readonly string[]>{
 const settings=normalizeColorSettings(value),warnings:string[]=[];
 const targets=[[settings.output.profile,{mode:'convert' as const,intent:settings.output.intent,blackPointCompensation:settings.output.blackPointCompensation}],...(settings.proof?[[settings.proof.profile,proofTransformSettings(settings.proof)]as const]:[])] as const;
 for(const[profile,options]of targets){
  check();control.signal?.throwIfAborted();const prepared=await IccSession.prepare(iccTarget(profile).source,options,control);
  try{check();control.signal?.throwIfAborted();warnings.push(...prepared.prepared.warnings);}finally{prepared.session.dispose();}
 }
 return Object.freeze([...new Set(warnings)]);
}
