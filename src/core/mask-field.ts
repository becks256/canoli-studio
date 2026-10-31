import {AffineTransform,type AffineBounds} from './affine';
import {strokeBounds,selectionRegionTransform} from './drawing';
import type {LayerMaskData} from './masks';
import {captureFieldBounds} from './projective-field';

/** Conservative finite support of raw deviations, before feather/settings.
 * Background is the authored paint base; the byte rasterizer captures its
 * actual alpha word. Bounds are an address space, never an allocation limit. */
export function maskFieldGeometry(mask:LayerMaskData,transform:AffineTransform,bitmap?:{width:number;height:number}) {
  // Prepared wet coverage reconstructs the whole mask on its own pixel grid
  // before affine sampling. Its interpolation support grows with that mapping.
  const nativeWet=!!mask.strokes?.some(entry=>entry.mode==='wet'&&entry.stroke.opacity>0);
  const basis=nativeWet?new AffineTransform():transform;
  const rects:AffineBounds[]=[];
  const add=(bounds:AffineBounds,matrix=basis)=>rects.push(matrix.bounds(bounds));
  if(mask.kind==='bitmap'){
    if(!bitmap||![bitmap.width,bitmap.height].every(v=>Number.isSafeInteger(v)&&v>0))throw new Error('Mask bitmap requires its complete native geometry.');
    add({x:0,y:0,width:bitmap.width,height:bitmap.height});
  }else if(mask.kind==='selection'){
    for(const region of mask.selection.regions)add(region,basis.multiply(selectionRegionTransform(region)));
  }else if(mask.kind==='vector'){
    for(const path of mask.paths){
      if(!path.points.length)continue;
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
      for(const point of path.points)for(const p of [point,point.in,point.out]){left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
      add({x:left,y:top,width:right-left,height:bottom-top});
    }
  }else if(mask.kind==='raster-erasures'){
    for(const entry of mask.erasures){
      let bounds=strokeBounds(entry.stroke);
      if(entry.placement){
        // Captured coverage is bilinearly sampled from a fixed ceil-sized
        // lattice. Include its border neighbors BEFORE later mask resizing;
        // two output pixels cannot cover a magnified interpolation tail.
        const source=entry.placement.bounds,sx=Math.ceil(entry.width)/entry.width,sy=Math.ceil(entry.height)/entry.height;
        const x=(Math.floor(source.x*sx)-1)/sx,y=(Math.floor(source.y*sy)-1)/sy;
        bounds={x,y,width:(Math.ceil((source.x+source.width)*sx)+1)/sx-x,height:(Math.ceil((source.y+source.height)*sy)+1)/sy-y};
      }
      add(bounds,basis.multiply(AffineTransform.scale(mask.width/entry.width,mask.height/entry.height)));
    }
  }
  for(const entry of mask.strokes??[])add(strokeBounds(entry.stroke));
  let bounds={x:0,y:0,width:1,height:1};
  if(rects.length){
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(const rect of rects){left=Math.min(left,rect.x);top=Math.min(top,rect.y);right=Math.max(right,rect.x+rect.width);bottom=Math.max(bottom,rect.y+rect.height);}
    // Cover rasterization/antialias support beyond the geometric hull. This is
    // source-grid padding; document-space feather halos are supplied later.
    const x=Math.floor(left)-2,y=Math.floor(top)-2;
    bounds={x,y,width:Math.ceil(right)+2-x,height:Math.ceil(bottom)+2-y};
    if(nativeWet){
      const mapped=transform.bounds(bounds),x=Math.floor(mapped.x)-2,y=Math.floor(mapped.y)-2;
      bounds={x,y,width:Math.ceil(mapped.x+mapped.width)+2-x,height:Math.ceil(mapped.y+mapped.height)+2-y};
    }
  }
  return {bounds:captureFieldBounds(bounds),background:mask.kind==='paint'?mask.base:mask.kind==='raster-erasures'?1:0};
}
