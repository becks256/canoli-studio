import {IccSession}from '../core/color/icc-client';
import {iccTarget}from '../core/color/profile-source';
import {normalizeColorOutput,type ColorOutput}from '../core/color/color-settings';
import {checkExport,type ExportControl}from './export-control';
export interface IccOutput{
 readonly profile:Uint8Array<ArrayBuffer>;
 readonly warnings:readonly string[];
 apply(pixels:Uint8Array|Uint8ClampedArray):Promise<Uint8ClampedArray<ArrayBuffer>>;
 dispose():void;
}
/** Conversion occurs after native readback, without a second premultiplying canvas. */
export async function prepareIccOutput(value:ColorOutput|undefined,control?:ExportControl):Promise<IccOutput|null>{
 checkExport(control);if(!value)return null;
 const settings=normalizeColorOutput(value),target=iccTarget(settings.profile),{session,prepared}=await IccSession.prepare(target.source,{mode:'convert',intent:settings.intent,blackPointCompensation:settings.blackPointCompensation},{signal:control?.signal});
 try{
  const profile=new Uint8Array(await target.source.arrayBuffer());checkExport(control);
  return{profile,warnings:prepared.warnings,async apply(pixels){checkExport(control);const result=await session.apply(pixels);checkExport(control);return result;},dispose(){session.dispose();}};
 }catch(error){session.dispose();throw error;}
}
export function colorOutputForFormat(format:string,color?:ColorOutput):Readonly<Required<ColorOutput>>|undefined{
 if(!color)return;
 if(!['png','tiff','pdf'].includes(format))throw new Error('ICC output conversion currently supports PNG, TIFF and PDF. This format uses sRGB.');
 return normalizeColorOutput(color);
}
