import {styleSchema,type LayerStyleData} from './drawing';
import {srgbToLinear} from './color/spaces';

/** Existing authored colors are sRGB; mixing takes place in working linear RGB.
 * Blend If keeps continuous encoded-sRGB 0..255 selector units, not byte pixels. */
export function compileFloatStyle(input:LayerStyleData){
 const style=styleSchema.parse(input),overlay=style.colorOverlay;
 if(style.dropShadow.enabled)throw new Error('Drop shadows require their float document integration.');
 const opacity=overlay.enabled?overlay.opacity:0;
 return{style,active:opacity!==0||style.blendIf.enabled,channel:['luminance','red','green','blue'].indexOf(style.blendIf.channel),
  values:[opacity,...[1,3,5].map(at=>srgbToLinear(parseInt(overlay.color.slice(at,at+2),16)/255)),Number(style.blendIf.enabled),...style.blendIf.source,...style.blendIf.underlying]};
}
