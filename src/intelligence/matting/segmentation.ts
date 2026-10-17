/**
 * Local deterministic salient-object segmentation and trimap generator (T19 / A04).
 * Evaluates image contrast, color variance, edge gradients, and spatial priors to extract
 * foreground subjects as reusable soft masks without requiring remote inference.
 */

import type { SelectionData } from "../../core/drawing";
import { selectSubjectOptionsSchema } from "../../core/subject-selection";
import {
  TRIMAP_BACKGROUND,
  TRIMAP_FOREGROUND,
  TRIMAP_UNKNOWN,
  type SegmentationCandidate,
  type SelectSubjectOptions,
  type TrimapBuffer,
} from "./types";

/**
 * Detects the salient foreground subject in an RGBA image buffer.
 */
export function detectSalientSubject(
  input: Uint8Array | ImageData, widthOrOptions?: number | SelectSubjectOptions,
  heightParam?: number, optionsParam?: SelectSubjectOptions,
): SegmentationCandidate {
  const image = "data" in input;
  const rgba = image ? input.data : input;
  const width = image ? input.width : widthOrOptions as number;
  const height = image ? input.height : heightParam!;
  const options = selectSubjectOptionsSchema.parse(image ? widthOrOptions ?? {} : optionsParam ?? {});
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||!Number.isSafeInteger(width*height)||rgba.length!==width*height*4)
    throw new Error('Invalid image dimensions or buffer length for segmentation.');
  const border=Math.max(1,Math.min(16,Math.floor(Math.min(width,height)/20)));
  let red=0,green=0,blue=0,visible=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<border||x>=width-border||y<border||y>=height-border){
    const i=(y*width+x)*4;if(rgba[i+3]){red+=rgba[i];green+=rgba[i+1];blue+=rgba[i+2];visible++;}
  }
  if(visible){red/=visible;green/=visible;blue/=visible;}
  const perimeter=width*height-Math.max(0,width-2*border)*Math.max(0,height-2*border);
  if(visible*2<perimeter)visible=0;
  const lum=(i:number)=>rgba[i*4+3] ? .299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2] : 0;
  const score=(i:number)=>{
    if(!rgba[i*4+3])return 0;if(!visible)return 1;
    const x=i%width,y=Math.floor(i/width),p=i*4;
    const distance=Math.hypot(rgba[p]-red,rgba[p+1]-green,rgba[p+2]-blue)/Math.sqrt(3*255*255);
    let edge=0;
    if(x>0&&x<width-1&&y>0&&y<height-1){
      const gx=-lum(i-width-1)+lum(i-width+1)-2*lum(i-1)+2*lum(i+1)-lum(i+width-1)+lum(i+width+1);
      const gy=-lum(i-width-1)-2*lum(i-width)-lum(i-width+1)+lum(i+width-1)+2*lum(i+width)+lum(i+width+1);
      edge=Math.hypot(gx,gy)/1020;
    }
    const spatial=.3+.7*Math.exp(-((x-width/2)**2+(y-height/2)**2)/(2*(Math.max(width,height)*.45)**2));
    return(.7*distance+.3*edge)*spatial;
  };
  let maximum=0;for(let i=0;i<width*height;i++)maximum=Math.max(maximum,score(i));
  let mask=new Uint8Array(width*height);
  for(let i=0;i<mask.length;i++){const value=score(i);if(maximum>1e-12&&value>0&&value/maximum>=options.threshold)mask[i]=rgba[i*4+3];}
  if(options.expandRadius){
    const result=new Uint8Array(mask.length),r=options.expandRadius;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      let alpha=0;for(let dy=-r;dy<=r;dy++){const yy=y+dy;if(yy<0||yy>=height)continue;const half=Math.floor(Math.sqrt(r*r-dy*dy));
        for(let xx=Math.max(0,x-half);xx<=Math.min(width-1,x+half);xx++)alpha=Math.max(alpha,mask[yy*width+xx]);}
      result[y*width+x]=alpha;
    }mask=result;
  }
  let left=width,top=height,right=-1,bottom=-1;
  for(let i=0;i<mask.length;i++)if(mask[i]){const x=i%width,y=Math.floor(i/width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  const bounds=right<left?{x:0,y:0,width:0,height:0}:{x:left,y:top,width:right-left+1,height:bottom-top+1};
  return{mask,width,height,bounds,confidence:0,label:'Local border-contrast heuristic'};
}

/**
 * Generates a 3-state Trimap (0 = background, 128 = unknown, 255 = foreground)
 * from a subject mask by expanding and eroding the transition boundary by radius.
 */
export function generateTrimapFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius = 10,
): TrimapBuffer {
  const r = Math.max(1, Math.min(64, Math.round(radius)));
  const eroded = erodeMask(mask, width, height, r);
  const dilated = dilateMask(mask, width, height, r);

  const trimap = new Uint8Array(width * height);

  for (let i = 0; i < trimap.length; i++) {
    if (eroded[i] >= 128) {
      trimap[i] = TRIMAP_FOREGROUND;
    } else if (dilated[i] >= 128) {
      trimap[i] = TRIMAP_UNKNOWN;
    } else {
      trimap[i] = TRIMAP_BACKGROUND;
    }
  }

  return {
    width,
    height,
    data: trimap,
  };
}

/**
 * Converts a subject mask and bounding box into SelectionData.
 */
export function maskToSelectionData(
  mask: Uint8Array, width: number, height: number,
  bounds?: {x:number;y:number;width:number;height:number},
): SelectionData {
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||!Number.isSafeInteger(width*height)||mask.length!==width*height)
    throw new Error('Invalid subject mask geometry.');
  let left=width,top=height,right=-1,bottom=-1;
  for(let i=0;i<mask.length;i++)if(mask[i]){const x=i%width,y=Math.floor(i/width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<left)return{regions:[]};
  const w=right-left+1,h=bottom-top+1,runs:number[]=[];let offset=0;
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
    const value=mask[y*width+x];offset++;
    if(runs.length&&runs[runs.length-1]===value)runs[runs.length-2]=offset;else runs.push(offset,value);
  }
  return{regions:[{...(bounds??{x:left,y:top,width:w,height:h}),shape:'pixels',operation:'add',coverage:{width:w,height:h,runs}}]};
}

/**
 * Fast separable box dilation for masks.
 */
export function dilateMask(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return new Uint8Array(src);
  const temp = new Uint8Array(src.length);
  const dst = new Uint8Array(src.length);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let maxVal = 0;
      const startX = Math.max(0, x - radius);
      const endX = Math.min(width - 1, x + radius);
      for (let k = startX; k <= endX; k++) {
        const val = src[row + k];
        if (val > maxVal) {
          maxVal = val;
          if (maxVal === 255) break;
        }
      }
      temp[row + x] = maxVal;
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let maxVal = 0;
      const startY = Math.max(0, y - radius);
      const endY = Math.min(height - 1, y + radius);
      for (let k = startY; k <= endY; k++) {
        const val = temp[k * width + x];
        if (val > maxVal) {
          maxVal = val;
          if (maxVal === 255) break;
        }
      }
      dst[y * width + x] = maxVal;
    }
  }

  return dst;
}

/**
 * Fast separable box erosion for masks.
 */
export function erodeMask(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return new Uint8Array(src);
  const temp = new Uint8Array(src.length);
  const dst = new Uint8Array(src.length);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let minVal = 255;
      const startX = Math.max(0, x - radius);
      const endX = Math.min(width - 1, x + radius);
      for (let k = startX; k <= endX; k++) {
        const val = src[row + k];
        if (val < minVal) {
          minVal = val;
          if (minVal === 0) break;
        }
      }
      temp[row + x] = minVal;
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let minVal = 255;
      const startY = Math.max(0, y - radius);
      const endY = Math.min(height - 1, y + radius);
      for (let k = startY; k <= endY; k++) {
        const val = temp[k * width + x];
        if (val < minVal) {
          minVal = val;
          if (minVal === 0) break;
        }
      }
      dst[y * width + x] = minVal;
    }
  }

  return dst;
}
