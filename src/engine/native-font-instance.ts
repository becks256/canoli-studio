import {selectNativeFontInstance,CSS_FONT_WIDTHS,type FontRunCss} from '../fonts/css-instance';
import type {FontDescriptors} from '../fonts/types';
/** Preserve an authored numeric weight; Canvas shorthand serialization can
 * discard its fraction. Preserve the supplied size for the same reason; Canvas
 * serialization can round it. Relative weights come from the native request. */
export function captureNativeFontInstance(context:CanvasRenderingContext2D,authoredWeight:string,descriptors:readonly Readonly<FontDescriptors>[],authoredSize?:number):FontRunCss{
 const original=authoredWeight.trim().toLowerCase(),numeric=/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(original)?Number(original):undefined;
 const parsed=context.font.match(/^(.*?)\s*((?:\d+(?:\.\d*)?|\.\d+))px(?:\s|\/)/),prefix=parsed?.[1];if(prefix===undefined)throw new Error('Cannot resolve the native font request.');
 const tokens=prefix.trim().split(/\s+/),resolved=tokens.find(t=>/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t)),weight=numeric??(original==='normal'?400:original==='bold'?700:resolved?Number(resolved):tokens.includes('bold')?700:400),stretch=context.fontStretch??'normal',width=CSS_FONT_WIDTHS[stretch]??(/^\d+(?:\.\d+)?%$/.test(stretch)?Number(stretch.slice(0,-1)):NaN);
 const style=tokens.includes('italic')?'italic':tokens.includes('oblique')?'oblique':'normal';
 return selectNativeFontInstance({weight,width,style,opticalSize:authoredSize??Number(parsed![2])},descriptors);
}
