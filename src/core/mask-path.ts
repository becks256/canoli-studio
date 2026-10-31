import {AffineTransform} from './affine';
import {maskTransform,type LayerMaskData} from './masks';
import {findLayer,type DocumentData} from './model';
import {layerTransform} from './spatial';
import {activePerspective,perspectiveMatrix} from './perspective';
import {ProjectiveTransform} from './projective';
import type {Point} from './drawing';

export interface PointMapping {point(value:Point):Point}

/** Keep world translation outside homogeneous arithmetic. Mask path values
 * remain native cubics; this adapter is only for direct editing/presentation. */
export class MaskPathMapping implements PointMapping {
  constructor(readonly world:AffineTransform,readonly projection:ProjectiveTransform|null=null){}
  point(value:Point){return this.world.point(this.projection?this.projection.point(value):value);}
  inverse():PointMapping {
    if(!this.projection)return this.world.inverse();
    const inverse=this.projection.inverse(),world=this.world;
    const linear=new AffineTransform(world.a,world.b,world.c,world.d).inverse();
    return{point(value){return inverse.point(linear.point({x:value.x-world.e,y:value.y-world.f}));}};
  }
  relativeTo(origin:Point){
    const w=this.world;
    return ProjectiveTransform.fromAffine(new AffineTransform(w.a,w.b,w.c,w.d,w.e-origin.x,w.f-origin.y))
      .multiply(this.projection??new ProjectiveTransform());
  }
}

export function maskPathMapping(document:DocumentData,id:string,mask:LayerMaskData){
  const world=layerTransform(document,id)!,layer=findLayer(document,id)!;
  if(mask.linked!==false&&(layer.kind==='raster'||layer.kind==='smart-object')&&activePerspective(layer.perspective))
    return new MaskPathMapping(world.multiply(AffineTransform.translation(mask.placedX??0,mask.placedY??0)),perspectiveMatrix(layer.width,layer.height,layer.perspective)
      .multiply(ProjectiveTransform.fromAffine(maskTransform(mask,new AffineTransform(),false))));
  return new MaskPathMapping(maskTransform(mask,world));
}
