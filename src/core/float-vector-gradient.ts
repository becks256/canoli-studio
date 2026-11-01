import {AffineTransform} from './affine';
import {srgbToLinear} from './color/spaces';
import {vectorGradientSchema,type VectorGradientData} from './vector-gradient';

export type LinearRgba=readonly [number,number,number,number];
export function linearVectorColor(color:string):LinearRgba {
 return [srgbToLinear(parseInt(color.slice(1,3),16)/255),srgbToLinear(parseInt(color.slice(3,5),16)/255),srgbToLinear(parseInt(color.slice(5,7),16)/255),1];
}

/** Two-circle cone parameter, with the last nonnegative-radius intersection
 * winning. An uncovered cone sector is transparent, not an endpoint color. */
function radialParameter(value:Extract<VectorGradientData,{kind:'radial'}>,x:number,y:number):number|null {
 const px=x-value.start.x,py=y-value.start.y,dx=value.end.x-value.start.x,dy=value.end.y-value.start.y,r=value.start.radius,dr=value.end.radius-r;
 if(dx===0&&dy===0)return (Math.hypot(px,py)-r)/dr;
 const geometry=Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dr)),scale=Math.max(Math.abs(px),Math.abs(py),r,geometry);
 if(!Number.isFinite(scale))throw new Error('Float radial gradient coordinates exceed working precision.');
 const u=px/scale,v=py/scale,a=dx/geometry,b=dy/geometry,c=r/scale,d=dr/geometry;
 const parameter=(t:number)=>t===0?0:t*(scale/geometry);
 const A=a*a+b*b-d*d,B=-2*(u*a+v*b+c*d),C=u*u+v*v-c*c;
 if(A===0){if(B===0)return C===0?(d>0?Infinity:parameter(-c/d)):null;const t=-C/B;return c+t*d>=0?parameter(t):null;}
 const discriminant=B*B-4*A*C;if(discriminant<0)return null;
 const root=Math.sqrt(discriminant),q=-.5*(B+(B<0?-root:root));
 const t0=q===0?-B/(2*A):q/A,t1=q===0?t0:C/q;
 let result:number|null=null;
 for(const t of [t0,t1])if(Number.isFinite(t)&&c+t*d>=0&&(result===null||t>result))result=t;
 return result===null?null:parameter(result);
}

/** Geometry and unassociated stop interpolation follow the existing gradient
 * contract, in linear RGB with continuous alpha, never Canvas color bytes. */
export function compileFloatVectorGradient(input:VectorGradientData,world:AffineTransform):(x:number,y:number,originX?:number,originY?:number)=>LinearRgba {
 const value=vectorGradientSchema.parse(input),placement=world.multiply(value.transform?AffineTransform.fromJSON(value.transform):new AffineTransform()),inverse=new AffineTransform(placement.a,placement.b,placement.c,placement.d).inverse();
 const stops=value.stops.map(stop=>({position:stop.position,color:linearVectorColor(stop.color),alpha:stop.opacity??1}));
 const colorAt=(t:number):LinearRgba=>{
  if(Number.isNaN(t))throw new Error('Float gradient parameter is not finite.');
  if(t<stops[0].position){const first=stops[0];return [first.color[0],first.color[1],first.color[2],first.alpha];}
  let index=0;while(index+1<stops.length&&t>=stops[index+1].position)index++;
  const lo=stops[index];if(index===stops.length-1)return [lo.color[0],lo.color[1],lo.color[2],lo.alpha];
  const hi=stops[index+1],mix=(t-lo.position)/(hi.position-lo.position),alpha=lo.alpha+(hi.alpha-lo.alpha)*mix;
  return [lo.color[0]+(hi.color[0]-lo.color[0])*mix,lo.color[1]+(hi.color[1]-lo.color[1])*mix,lo.color[2]+(hi.color[2]-lo.color[2])*mix,alpha];
 };
 return (x,y,originX=0,originY=0)=>{
  // Remove large translation before adding subpixel offsets or multiplying
  // coefficients. The caller uses fixed native origins for crop identity.
  const p=inverse.point({x:originX-placement.e+x,y:originY-placement.f+y});
  if(value.kind==='radial'){const t=radialParameter(value,p.x,p.y);return t===null?[0,0,0,0]:colorAt(t);}
  const dx=value.end.x-value.start.x,dy=value.end.y-value.start.y,scale=Math.max(Math.abs(dx),Math.abs(dy)),a=dx/scale,b=dy/scale;
  const px=p.x-value.start.x,py=p.y-value.start.y,extent=Math.max(Math.abs(px),Math.abs(py),scale),projection=(px/extent*a+py/extent*b)/(a*a+b*b);
  return colorAt(projection===0?0:projection*(extent/scale));
 };
}
