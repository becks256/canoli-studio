import {AffineTransform,type AffinePoint} from '../core/affine';
import {PerspectiveTransform} from '../dom/perspective';

/** Captured source placement. Pointer offsets use only the inverse linear
 * basis, so grabbing inside a handle never jumps to its center and large
 * translations do not enter the displacement calculation. */
export class PerspectiveCornerDrag {
  readonly value:PerspectiveTransform;
  private readonly inverse:AffineTransform;
  private readonly origin:AffinePoint;
  constructor(
    value:PerspectiveTransform|null,
    readonly width:number,readonly height:number,
    world:AffineTransform,readonly index:number,origin:AffinePoint,
  ){
    if(![width,height].every(v=>Number.isFinite(v)&&v>0))throw new Error('Perspective requires positive finite image dimensions.');
    if(!Number.isInteger(index)||index<0||index>3)throw new Error('Choose corner 0 through 3.');
    this.value=value??new PerspectiveTransform();this.inverse=world.inverse();this.origin={...origin};
  }
  at(point:AffinePoint):PerspectiveTransform {
    const dx=point.x-this.origin.x,dy=point.y-this.origin.y,corner=this.value.corners[this.index];
    return this.value.withCorner(this.index,{
      x:corner.x+(this.inverse.a*dx+this.inverse.c*dy)/this.width,
      y:corner.y+(this.inverse.b*dx+this.inverse.d*dy)/this.height,
    });
  }
}
