import type {DeliveryVariantSpec} from './types';
import {deliverySettingsHash} from './delivery-contract';
import {prepareColorOutputSource} from '../../core/color/output-source';
import type {IccControl} from '../../core/color/icc-client';
import {deliveryVariantSpecSchema} from './schema';
export async function prepareDeliveryVariants(variants:readonly DeliveryVariantSpec[],control:IccControl={}){
 const prepared=new Map<string,Awaited<ReturnType<typeof prepareColorOutputSource>>>();
 for(const value of variants){const variant=deliveryVariantSpecSchema.parse(value);control.signal?.throwIfAborted();if(variant.color){const key=await deliverySettingsHash(variant);prepared.set(key,await prepareColorOutputSource(variant.color,control));}}
 return prepared;
}
