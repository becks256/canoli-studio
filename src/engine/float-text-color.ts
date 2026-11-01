import {srgbToLinear} from '../core/color/spaces';
import {yieldTask} from '../core/task-yield';

export type LinearTextColor=readonly [number,number,number,number];
export interface FloatTextColorControl {signal?:AbortSignal;check?:()=>void}

function color(values:readonly number[]):LinearTextColor {
 const rgba=values.map(Math.fround);
 if(rgba.length!==4||rgba.some(value=>!Number.isFinite(value))||rgba[3]<0||rgba[3]>1)throw new Error('Native text color requires finite linear RGB and alpha in [0,1].');
 return Object.freeze(rgba) as unknown as LinearTextColor;
}

/** Authored hex values already have exact sRGB components. No CSS serialization
 * or Canvas pixel readback is needed for their working-linear interpretation. */
export function linearHexTextColor(input:string):LinearTextColor|null {
 if(!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(input))return null;
 let hex=input.slice(1);if(hex.length<=4)hex=[...hex].map(value=>value+value).join('');
 return color([...[0,2,4].map(at=>srgbToLinear(parseInt(hex.slice(at,at+2),16)/255)),hex.length===8?parseInt(hex.slice(6,8),16)/255:1]);
}

const number='([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?)';
type Space='srgb'|'srgb-linear';
const serialized={srgb:new RegExp(`^color\\(srgb\\s+${number}\\s+${number}\\s+${number}(?:\\s*\\/\\s*${number})?\\)$`,'i'),'srgb-linear':new RegExp(`^color\\(srgb-linear\\s+${number}\\s+${number}\\s+${number}(?:\\s*\\/\\s*${number})?\\)$`,'i')};
function components(css:string,space:Space):[number,number,number,number] {
 const match=serialized[space].exec(css);
 if(!match)throw new Error('The native CSS host did not resolve a linear text color.');
 const values=[Number(match[1]),Number(match[2]),Number(match[3]),match[4]===undefined?1:Number(match[4])] as [number,number,number,number];
 if(values.some(value=>!Number.isFinite(value)))throw new Error('The native CSS host returned nonfinite text color components.');
 return values;
}

/** Resolve authored CSS colors before painting. Only metadata is read from the
 * browser CSS engine; no document, glyph, display or proof pixels enter RGB.
 * Results and requests are snapshots. The DOM host lives only during this call.
 * This private dependency does not enable TextLayer in float documents. */
export async function captureLinearTextColors(input:readonly string[],control:FloatTextColorControl={}):Promise<readonly LinearTextColor[]> {
 control={...control};const snapshot=Array.from(input);
 if(snapshot.some(value=>typeof value!=='string'))throw new Error('Text colors must be CSS strings.');
 let host:HTMLDivElement|undefined,probe:HTMLSpanElement|undefined,validation:CanvasRenderingContext2D|null|undefined,canvas:HTMLCanvasElement|undefined;
 const current=()=>{control.signal?.throwIfAborted();control.check?.();control.signal?.throwIfAborted();if(host&&!host.isConnected)throw new Error('The native text color host was removed.');};
 const prepare=()=>{
  if(probe)return;
  if(typeof document==='undefined'||typeof CSS==='undefined'||!CSS.supports('color','color(from red srgb-linear r g b / alpha)'))throw new Error('Native text color resolution requires a browser with relative CSS colors.');
  host=document.createElement('div');host.setAttribute('data-canoli-float-text-color-probe','');host.setAttribute('aria-hidden','true');host.setAttribute('inert','');host.style.cssText='all:initial;position:fixed;left:-100000px;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;contain:strict;color:black;color-scheme:only light;forced-color-adjust:none';
  probe=document.createElement('span');probe.style.cssText='all:initial;color:black;color-scheme:only light;forced-color-adjust:none';host.attachShadow({mode:'closed'}).append(probe);document.body.append(host);canvas=document.createElement('canvas');canvas.width=canvas.height=1;validation=canvas.getContext('2d');if(!validation)throw new Error('Native text color validation requires a Canvas style host.');current();
 };
 const write=(value:string)=>{
  current();probe!.style.color='';probe!.style.color=value;if(!probe!.style.color)throw new Error('Cannot resolve an invalid text color.');
  const result=getComputedStyle(probe!).color;current();return result;
 };
 const read=(value:string,space:Space)=>components(write(value),space);
 const resolve=(value:string):LinearTextColor=>{
  const hex=linearHexTextColor(value);if(hex)return hex;
  prepare();current();
  validation!.fillStyle='#010203';validation!.fillStyle=value;
  if(validation!.fillStyle==='#010203'){validation!.fillStyle='#040506';validation!.fillStyle=value;if(validation!.fillStyle==='#040506')throw new Error('Cannot resolve an invalid text color.');}
  // CSS computed-style strings have fewer significant digits than Float32.
  // Read the residual separately, including alpha through an unclamped RGB
  // channel, so serialization does not become another color quantization step.
  // Keep declared sRGB in its own space until the shared transfer. Converting
  // even named red through the browser's XYZ matrices adds small cross-channel
  // residues and makes equivalent hex/named/rgb colors disagree.
  const space:Space=/^(?:rgba?\(|color\(srgb\s)/i.test(write(value))?'srgb':'srgb-linear';
  const high=read(`color(from ${value} ${space} calc(r + 0) calc(g + 0) calc(b + 0) / calc(alpha + 0))`,space);
  const low=read(`color(from ${value} ${space} calc(r - ${high[0]}) calc(g - ${high[1]}) calc(b - ${high[2]}) / 1)`,space);
  const alpha=read(`color(from ${value} ${space} calc(alpha - ${high[3]}) 0 0 / 1)`,space)[0];
  const rgb=[0,1,2].map(i=>{const v=Math.fround(high[i]+low[i]);if(space==='srgb'){const byte=Math.round(v*255),encoded=v>=0&&v<=1&&Math.fround(byte/255)===v?byte/255:v;return srgbToLinear(encoded);}return v;});
  return color([...rgb,high[3]+alpha]);
 };
 try{
  current();const cache=new Map<string,LinearTextColor>(),output:LinearTextColor[]=[];let deadline=performance.now()+2;
  for(const value of snapshot){current();let rgba=cache.get(value);if(!rgba){rgba=resolve(value);cache.set(value,rgba);}output.push(rgba);if(performance.now()>=deadline){await yieldTask();current();deadline=performance.now()+2;}}
  current();return Object.freeze(output);
 }finally{host?.remove();if(canvas)canvas.width=canvas.height=0;probe=undefined;validation=undefined;host=undefined;canvas=undefined;}
}
