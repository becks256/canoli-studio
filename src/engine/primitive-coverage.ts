import type { AffineData } from '../core/affine';

// Gauss-Legendre nodes are generated from the defining polynomial, avoiding a
// rounded coefficient table. Splitting at pixel/ellipse crossings keeps each
// integration interval smooth, including very thin projected footprints.
function gauss(order:number):readonly (readonly [number,number])[]{
  const result:[number,number][]=[];
  for(let i=0;i<order;i++){
    let root=Math.cos(Math.PI*(i+.75)/(order+.5)),derivative=0;
    for(let iteration=0;iteration<24;iteration++){
      let previous=1,current=root;
      for(let n=2;n<=order;n++){const next=((2*n-1)*root*current-(n-1)*previous)/n;previous=current;current=next;}
      derivative=order*(root*current-previous)/(root*root-1);
      const delta=current/derivative;root-=delta;
      if(Math.abs(delta)<2e-16)break;
    }
    result.push([root,2/((1-root*root)*derivative*derivative)]);
  }
  return result;
}
const ROW_NODES=gauss(16),COLUMN_NODES=gauss(8);
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
type Point={x:number;y:number};
export interface PrimitiveCoverageSampler {
  (x:number,y:number):number;
  interval(x:number,y:number):readonly [number,number]|null;
  solidSpan(y:number,left:number,right:number):readonly [number,number]|null;
}

/** Output-pixel area of a transformed unit square/soft unit disk. The caller
 * rebases the frame before entry. Geometry is independent of working tiles. */
export function primitiveCoverage(frame:AffineData,pencil:boolean,hardness:number):PrimitiveCoverageSampler {
  const scale=Math.max(Math.abs(frame.a),Math.abs(frame.b),Math.abs(frame.c),Math.abs(frame.d));
  const a=frame.a/scale,b=frame.b/scale,c=frame.c/scale,d=frame.d/scale,det=a*d-b*c;
  if(!Number.isFinite(scale)||scale===0||det===0)throw new Error('Primitive coverage transform is singular at working precision.');
  const ia=d/det/scale,ib=-b/det/scale,ic=-c/det/scale,id=a/det/scale;
  if(![ia,ib,ic,id].every(Number.isFinite))throw new Error('Primitive coverage exceeds transform precision.');
  const halfX=(Math.abs(ia)+Math.abs(ic))*.5,halfY=(Math.abs(ib)+Math.abs(id))*.5;
  const radiusX=Math.hypot(a,c)*scale,radiusY=Math.hypot(b,d)*scale;
  const horizontal= Math.abs(det)/Math.hypot(b,d)*scale;
  const vertical= Math.abs(det)/Math.hypot(a,c)*scale;
  const xNorm=Math.hypot(a,c),yNorm=Math.hypot(b,d);
  const horizontalSlope=(a*(b/yNorm)+c*(d/yNorm))/yNorm,verticalSlope=(b*(a/xNorm)+d*(c/xNorm))/xNorm;
  const hard=hardness>=.999;

  const sample=(x:number,y:number)=>{
    const originX=frame.e-x,originY=frame.f-y;
    const centerX=ia*(.5-originX)+ic*(.5-originY),centerY=ib*(.5-originX)+id*(.5-originY);
    const farX=Math.abs(centerX)+halfX,farY=Math.abs(centerY)+halfY;
    if(pencil?farX<=1&&farY<=1:farX*farX+farY*farY<=(hard?1:hardness*hardness))return 1;
    const nearX=Math.max(0,Math.abs(centerX)-halfX),nearY=Math.max(0,Math.abs(centerY)-halfY);
    if(pencil?nearX>=1||nearY>=1:nearX*nearX+nearY*nearY>=1)return 0;
    if(pencil){
      let polygon:Point[]=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
      for(const [vx,vy,offset] of [[ia,ic,centerX-(ia+ic)*.5],[ib,id,centerY-(ib+id)*.5]])for(const sign of [1,-1]){
        const next:Point[]=[];
        for(let i=0;i<polygon.length;i++){
          const from=polygon[i],to=polygon[(i+1)%polygon.length];
          const f=sign*(vx*from.x+vy*from.y+offset)-1,t=sign*(vx*to.x+vy*to.y+offset)-1;
          if(f<=0)next.push(from);
          if((f<=0)!==(t<=0)){const fraction=f/(f-t);next.push({x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction});}
        }
        polygon=next;if(polygon.length<3)return 0;
      }
      let twice=0;for(let i=0;i<polygon.length;i++){const p=polygon[i],q=polygon[(i+1)%polygon.length];twice+=p.x*q.y-p.y*q.x;}
      return clamp(Math.abs(twice)*.5);
    }
    const lo=Math.max(0,originY-radiusY),hi=Math.min(1,originY+radiusY);
    if(hi<=lo)return 0;
    const cuts=[lo,hi];
    const add=(v:number)=>{if(v>lo&&v<hi)cuts.push(v);};
    add(originY);
    for(const radius of hard?[1]:[1,hardness]){
      if(radius===0)continue;
      add(originY-radiusY*radius);add(originY+radiusY*radius);
      for(const edge of [0,1]){
        const t=(edge-originX)/(radiusX*radius);
        if(Math.abs(t)>=1)continue;
        const mid=originY+verticalSlope*(edge-originX),span=vertical*radius*Math.sqrt(Math.max(0,(1-t)*(1+t)));
        add(mid-span);add(mid+span);
      }
    }
    cuts.sort((a,b)=>a-b);
    let area=0;
    for(let index=1;index<cuts.length;index++){
      const half=(cuts[index]-cuts[index-1])*.5,mid=cuts[index-1]+half;
      if(half<=0)continue;
      for(const [node,weight] of ROW_NODES){
        const v=mid+half*node,t=(v-originY)/radiusY;
        const mx=originX+horizontalSlope*(v-originY),span=horizontal*Math.sqrt(Math.max(0,(1-t)*(1+t)));
        const left=Math.max(0,mx-span),right=Math.min(1,mx+span);
        if(right<=left)continue;
        let line=right-left;
        if(!hard){
          line=0;const xs=[left,right];
          if(mx>left&&mx<right)xs.push(mx);
          if(Math.abs(t)<hardness){const inner=horizontal*Math.sqrt(Math.max(0,(hardness-t)*(hardness+t)));for(const u of [mx-inner,mx+inner])if(u>left&&u<right)xs.push(u);}
          xs.sort((a,b)=>a-b);
          for(let j=1;j<xs.length;j++){
            const hx=(xs[j]-xs[j-1])*.5,cx=xs[j-1]+hx;
            for(const [nx,wx] of COLUMN_NODES){const u=cx+hx*nx,dx=u-originX,dy=v-originY,r=Math.hypot(ia*dx+ic*dy,ib*dx+id*dy);line+=hx*wx*clamp((1-r)/(1-hardness));}
          }
        }
        area+=half*weight*line;
      }
    }
    return clamp(area);
  };
  const variance=(ia*ia+ib*ib+ic*ic+id*id)/12;
  sample.interval=(x:number,y:number):readonly [number,number]|null=>{
    if(pencil||hard||!Number.isFinite(variance))return null;
    const dx=.5-(frame.e-x),dy=.5-(frame.f-y),cx=ia*dx+ic*dy,cy=ib*dx+id*dy;
    const uncertainty=32*Number.EPSILON*(Math.abs(ia*dx)+Math.abs(ic*dy)+Math.abs(ib*dx)+Math.abs(id*dy)+halfX+halfY+1);
    if(!Number.isFinite(cx)||!Number.isFinite(cy)||!Number.isFinite(uncertainty))return null;
    const far=Math.hypot(Math.abs(cx)+halfX,Math.abs(cy)+halfY)+uncertainty;
    if(far>1)return null;
    if(far<=hardness)return[1,1];
    const near=Math.hypot(Math.max(0,Math.abs(cx)-halfX),Math.max(0,Math.abs(cy)-halfY))-uncertainty;
    if(near<hardness)return null;
    // Jensen and Cauchy bound the mean norm of a uniformly sampled pixel.
    // E(delta)=0 and E(|delta|^2)=variance. No input samples are dropped.
    const center=Math.hypot(cx,cy),upperNorm=Math.sqrt((center+uncertainty)**2+variance*(1+32*Number.EPSILON));
    return[clamp((1-upperNorm)/(1-hardness)-2e-12),clamp((1-Math.max(0,center-uncertainty))/(1-hardness)+2e-12)];
  };
  const solidRadius=pencil||hard?1:hardness;
  const solidPixel=(x:number,y:number)=>{
    for(const u of [0,1])for(const v of [0,1]){
      const dx=u-(frame.e-x),dy=v-(frame.f-y),cx=ia*dx+ic*dy,cy=ib*dx+id*dy;
      const uncertainty=32*Number.EPSILON*(Math.abs(ia*dx)+Math.abs(ic*dy)+Math.abs(ib*dx)+Math.abs(id*dy)+1);
      const distance=pencil?Math.max(Math.abs(cx),Math.abs(cy)):Math.hypot(cx,cy);
      if(!Number.isFinite(distance)||distance+uncertainty>solidRadius)return false;
    }
    return true;
  };
  sample.solidSpan=(y:number,left:number,right:number):readonly [number,number]|null=>{
    if(solidRadius<=0)return null;
    let low=left,high=right;
    for(const edgeY of [y,y+1]){
      const dy=edgeY-frame.f;
      if(pencil){
        for(const [vx,vy]of [[ia,ic],[ib,id]]){
          if(vx===0){if(Math.abs(vy*dy)>1)return null;continue;}
          const first=frame.e+(-1-vy*dy)/vx,last=frame.e+(1-vy*dy)/vx;
          low=Math.max(low,Math.min(first,last));high=Math.min(high,Math.max(first,last));
        }
      }else{
        const t=dy/radiusY;if(Math.abs(t)>=solidRadius)return null;
        const center=frame.e+horizontalSlope*dy,span=horizontal*Math.sqrt(Math.max(0,(solidRadius-t)*(solidRadius+t)));
        low=Math.max(low,center-span);high=Math.min(high,center+span);
      }
    }
    let start=Math.ceil(low),end=Math.floor(high);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)return null;
    // Certify all corners at both ends. Convexity contains every intervening
    // pixel; uncertain boundaries retain the full integration path.
    if(!solidPixel(start,y))start++;
    if(!solidPixel(end-1,y))end--;
    return start<end&&solidPixel(start,y)&&solidPixel(end-1,y)?[start,end]:null;
  };
  return sample;
}
