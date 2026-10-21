import type {AffineTransform} from '../core/affine';
import type {SmartFilterData} from '../core/smart/filters';
import {isActiveSmartFilter} from '../core/smart/filters';
import {nativeSamplingGrid,type PixelWorkGrid} from './pixel-work-grid';

/** Tonal equations are pointwise. Exact native placement can share bounded
 * requests without changing resampling or the existing spatial-filter grid. */
export function nativeToneSamplingGrid(
 width:number,height:number,placement:AffineTransform,filters:readonly SmartFilterData[],feather=0,
):PixelWorkGrid|undefined {
 if(placement.a!==1||placement.b!==0||placement.c!==0||placement.d!==1||
    !Number.isSafeInteger(placement.e)||!Number.isSafeInteger(placement.f)||
    !filters.some(filter=>isActiveSmartFilter(filter)&&filter.kind==='tone')||
    filters.some(filter=>isActiveSmartFilter(filter)&&filter.kind!=='tone')||
    !Number.isFinite(feather)||feather<0)return undefined;
 // Include mask sampling support in the work budget. This never constrains
 // master/source dimensions; unsafe or unhelpful partitions retain 256 cores.
 return nativeSamplingGrid(width,height,256,3*Math.ceil(feather/3),4);
}
