import type { FeatherTile } from './wasm';

/** Crop private, validated coverage with the full support of three box passes. */
export function featherRegion(pixels: Uint8ClampedArray, tile: FeatherTile) {
  const {width,height,radiusX,radiusY}=tile;
  let left=width,top=height,right=-1,bottom=-1;
  for(let p=0;p<width*height;p++) {
    if(!pixels[p*4+3])continue;
    const x=p%width,y=Math.floor(p/width);
    left=Math.min(left,x);right=Math.max(right,x);
    top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(right<left)return null;
  const haloX=3*Math.ceil(radiusX),haloY=3*Math.ceil(radiusY);
  left=Math.max(0,left-haloX);top=Math.max(0,top-haloY);
  right=Math.min(width,right+1+haloX);bottom=Math.min(height,bottom+1+haloY);
  const w=right-left,h=bottom-top;
  if(w===width&&h===height)return {x:0,y:0,width,height,pixels};
  const cropped=new Uint8ClampedArray(w*h*4);
  for(let row=0;row<h;row++){
    const start=((top+row)*width+left)*4;
    cropped.set(pixels.subarray(start,start+w*4),row*w*4);
  }
  return {x:left,y:top,width:w,height:h,pixels:cropped};
}
