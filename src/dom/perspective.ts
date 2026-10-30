import {perspectiveSchema,IDENTITY_PERSPECTIVE,type PerspectiveData,perspectiveLocalQuad} from '../core/perspective';
import type {ProjectiveQuad} from '../core/projective';
/** Immutable normalized image-boundary corners, ordered TL, TR, BR, BL.
 * Affine placement, original pixels, masks and paint operations stay editable. */
export class PerspectiveTransform {
  private readonly data:PerspectiveData;
  constructor(options:PerspectiveData={corners:IDENTITY_PERSPECTIVE}){const data=perspectiveSchema.parse(options);this.data=Object.freeze({corners:Object.freeze(data.corners.map(p=>Object.freeze(p))) as unknown as ProjectiveQuad});Object.freeze(this);}
  static fromPixels(width:number,height:number,corners:ProjectiveQuad){
    if(![width,height].every(v=>Number.isFinite(v)&&v>0))throw new Error('Perspective requires positive finite layer dimensions.');
    return new PerspectiveTransform({corners:corners.map(p=>({x:p.x/width,y:p.y/height})) as unknown as ProjectiveQuad});
  }
  get corners():ProjectiveQuad{return this.data.corners.map(p=>({...p})) as unknown as ProjectiveQuad;}
  toPixels(width:number,height:number):ProjectiveQuad {if(![width,height].every(v=>Number.isFinite(v)&&v>0))throw new Error('Perspective requires positive finite layer dimensions.');return perspectiveLocalQuad(width,height,this.data);}
  withCorner(index:number,point:{x:number;y:number}){if(!Number.isInteger(index)||index<0||index>3)throw new Error('Choose corner 0 through 3.');const corners=this.corners.map((p,i)=>i===index?{...point}:p) as unknown as ProjectiveQuad;return new PerspectiveTransform({corners});}
  toJSON():PerspectiveData{return{corners:this.corners};}
}
