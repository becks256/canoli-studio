import type {PreparedPatch} from './patch';
import {encodeFloatPatchAsset} from '../core/float-patch-codec';
import {encodeRgbaPng} from './png';
import type {FloatWetTileControl} from '../core/float-wet-tile';

/** Shared private host/isolated preparation output. Corrected RGB is unmasked;
 * alpha stores scalar coverage once, rather than target transparency. */
export async function encodeRetouchAsset(patch:PreparedPatch,control:FloatWetTileControl={}):Promise<Blob>{
 control.signal?.throwIfAborted();control.check?.();
 if(patch.precision==='float32')return encodeFloatPatchAsset(patch.correctedPixels,patch.coverage,patch.bounds.width,patch.bounds.height,control);
 const rgba=new Uint8Array(patch.correctedPixels);for(let p=0;p<patch.coverage.length;p++)rgba[p*4+3]=patch.coverage[p];const blob=await encodeRgbaPng(rgba,patch.bounds.width,patch.bounds.height);control.signal?.throwIfAborted();control.check?.();return blob;
}
