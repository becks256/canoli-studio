import type { BlendMode } from '../../model';
type RGB = [number, number, number];
const lum = (c: RGB) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
const sat = (c: RGB) => Math.max(...c) - Math.min(...c);
function setLum(c: RGB, value: number): RGB {
  const delta = value - lum(c);
  let v = c.map(x => x + delta) as RGB;
  const l = lum(v), low = Math.min(...v), high = Math.max(...v);
  if (low < 0) v = v.map(x => l + (x-l)*l/(l-low)) as RGB;
  if (high > 1) v = v.map(x => l + (x-l)*(1-l)/(high-l)) as RGB;
  return v;
}
function setSat(c: RGB, value: number): RGB {
  const low = Math.min(...c), range = sat(c);
  return c.map(x => range ? (x-low)*value/range : 0) as RGB;
}
function component(b: number, s: number, mode: BlendMode): number {
  switch (mode) {
    case 'multiply': return b*s;
    case 'screen': return b+s-b*s;
    case 'overlay': return b<=0.5 ? 2*b*s : 1-2*(1-b)*(1-s);
    case 'darken': return Math.min(b,s);
    case 'lighten': return Math.max(b,s);
    case 'color-dodge': return b===0 ? 0 : s===1 ? 1 : Math.min(1,b/(1-s));
    case 'color-burn': return b===1 ? 1 : s===0 ? 0 : 1-Math.min(1,(1-b)/s);
    case 'hard-light': return s<=0.5 ? 2*b*s : 1-2*(1-b)*(1-s);
    case 'soft-light': return s<=0.5 ? b-(1-2*s)*b*(1-b) : b+(2*s-1)*((b<=0.25?((16*b-12)*b+4)*b:Math.sqrt(b))-b);
    case 'difference': return Math.abs(b-s);
    case 'exclusion': return b+s-2*b*s;
    default: return s;
  }
}
/** Straight encoded-sRGB blend colors, matching the viewport's blend convention. */
export function blendColors(b: RGB, s: RGB, mode: BlendMode): RGB {
  switch (mode) {
    case 'hue': return setLum(setSat(s,sat(b)),lum(b));
    case 'saturation': return setLum(setSat(b,sat(s)),lum(b));
    case 'color': return setLum(s,lum(b));
    case 'luminosity': return setLum(b,lum(s));
    default: return b.map((v,i)=>component(v,s[i],mode)) as RGB;
  }
}
