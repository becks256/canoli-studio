import type {DeliveryDeliverable,DeliveryVariantSpec} from './types';
import {computeSha256} from './manifest';
import type {ColorOutputReceipt} from '../../core/color/output-record';
import {deliveryVariantSpecSchema} from './schema';
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,child])=>[key,canonical(child)]));
 return value;
}
export function deliverySettingsKey(input:DeliveryVariantSpec):string{
 const variant=deliveryVariantSpecSchema.parse(input),color=variant.color;
 return JSON.stringify(canonical({...variant,...(color?{color:{...color,profile:{name:color.profile.name,sha256:color.profile.sha256,byteLength:color.profile.source.size}}}:{})}));
}
export async function deliverySettingsHash(input:DeliveryVariantSpec){return computeSha256(deliverySettingsKey(input));}
export async function verifyDeliveryContract(variant:DeliveryVariantSpec,delivery:Pick<DeliveryDeliverable,'settingsSha256'|'color'|'format'|'width'|'height'>,receipt?:ColorOutputReceipt){
 if(!delivery.settingsSha256){if(variant.color||['tiff','pdf'].includes(variant.format)||delivery.color)throw new Error('This delivery has no accepted output contract. Create a new batch instead of relabeling old files.');return;}
 if(delivery.settingsSha256!==await deliverySettingsHash(variant)||delivery.format!==variant.format||delivery.width!==variant.targetWidth||delivery.height!==variant.targetHeight)throw new Error('Delivery settings differ from accepted output. Create a new batch.');
 const color=variant.color;
 if(color){
  const actual=delivery.color;
  if(!actual||actual.profileSha256!==color.profile.sha256||actual.profileByteLength!==color.profile.source.size||actual.profileName!==color.profile.name||actual.intent!==color.intent||actual.blackPointCompensation!==color.blackPointCompensation||receipt&&JSON.stringify(canonical(actual))!==JSON.stringify(canonical(receipt)))throw new Error('ICC delivery contract differs from the accepted file. Create a new batch.');
 }else if(delivery.color)throw new Error('An accepted ICC delivery cannot be relabeled as sRGB. Create a new batch.');
}
