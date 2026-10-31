import type {PathAnchor,Point,Rect} from './drawing';
import type {CurveHit,CurveHitBudget} from './bezier';
import type {ProjectiveTransform} from './projective';

type Homogeneous={x:number;y:number;w:number};
type Cubic=[Homogeneous,Homogeneous,Homogeneous,Homogeneous];
const mix=(a:Homogeneous,b:Homogeneous,t:number):Homogeneous=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,w:a.w+(b.w-a.w)*t});
function divide(c:Cubic,t=.5):[Cubic,Cubic]{
  const a=mix(c[0],c[1],t),b=mix(c[1],c[2],t),d=mix(c[2],c[3],t),e=mix(a,b,t),f=mix(b,d,t),p=mix(e,f,t);
  return[[c[0],a,e,p],[p,f,d,c[3]]];
}
function project(p:Homogeneous):Point|null {
  const x=p.x/p.w,y=p.y/p.w;
  return p.w!==0&&Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;
}
function control(p:Point,m:ProjectiveTransform):Homogeneous {
  const a=m.values,result={x:a[0]*p.x+a[1]*p.y+a[2],y:a[3]*p.x+a[4]*p.y+a[5],w:a[6]*p.x+a[7]*p.y+a[8]};
  if(!Object.values(result).every(Number.isFinite))throw new Error('Perspective path exceeds working precision.');
  return result;
}
function controls(a:PathAnchor,b:PathAnchor,m:ProjectiveTransform):Cubic{return[a,a.out,b.in,b].map(p=>control(p,m))as Cubic;}
function finiteHull(c:Cubic):Point[]|null {
  if(c.some(p=>p.w===0||Math.sign(p.w)!==Math.sign(c[0].w)))return null;
  const points=c.map(project);return points.every(p=>p!==null)?points as Point[]:null;
}
/** Homogeneous half-space hull test also works on branches crossing infinity.
 * It discards only branches which cannot reach the finite view on either side. */
function possible(c:Cubic,r:Rect){
  const tests=[(p:Homogeneous)=>p.w,(p:Homogeneous)=>p.x-r.x*p.w,(p:Homogeneous)=>(r.x+r.width)*p.w-p.x,
    (p:Homogeneous)=>p.y-r.y*p.w,(p:Homogeneous)=>(r.y+r.height)*p.w-p.y];
  return[1,-1].some(sign=>tests.every(test=>c.some(p=>sign*test(p)>=0)));
}
function segmentDistance(p:Point,a:Point,b:Point){
  const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function clippedLine(a:Point,b:Point,r:Rect):[Point,Point]|null {
  let from=0,to=1;const dx=b.x-a.x,dy=b.y-a.y;
  for(const[p,q]of[[-dx,a.x-r.x],[dx,r.x+r.width-a.x],[-dy,a.y-r.y],[dy,r.y+r.height-a.y]]){
    if(p===0){if(q<0)return null;continue;}const t=q/p;if(p<0)from=Math.max(from,t);else to=Math.min(to,t);if(from>to)return null;
  }
  return[{x:a.x+from*dx,y:a.y+from*dy},{x:a.x+to*dx,y:a.y+to*dy}];
}

/** Rational De Casteljau subdivision; never transform polynomial control points
 * and pretend the result is another polynomial cubic. Display error is bounded
 * by the projected positive-weight control hull, in document units. */
export function projectivePathOutline(points:readonly PathAnchor[],closed:boolean,matrix:ProjectiveTransform,clip:Rect,tolerance:number,budget:CurveHitBudget={remaining:262144}):string {
  if(![clip.x,clip.y,clip.width,clip.height,tolerance].every(Number.isFinite)||clip.width<=0||clip.height<=0||tolerance<=0)throw new Error('Invalid perspective path view.');
  const output:string[]=[];
  for(let index=0,count=closed?points.length:Math.max(0,points.length-1);index<count;index++){
    const stack:{c:Cubic;depth:number}[]=[{c:controls(points[index],points[(index+1)%points.length],matrix),depth:0}];
    while(stack.length){
      if(--budget.remaining<0)throw new Error('Perspective path display exceeded its work budget. Zoom into the contour.');
      const{c,depth}=stack.pop()!;if(!possible(c,clip))continue;
      const hull=finiteHull(c);
      if(hull&&hull.every(p=>segmentDistance(p,hull[0],hull[3])<=tolerance)){
        const line=clippedLine(hull[0],hull[3],clip);if(line)output.push(`M ${line[0].x} ${line[0].y} L ${line[1].x} ${line[1].y}`);continue;
      }
      if(depth>=60)throw new Error('Perspective path cannot be resolved at working precision.');
      const[left,right]=divide(c);stack.push({c:right,depth:depth+1},{c:left,depth:depth+1});
    }
  }
  return output.join(' ');
}

/** Exact rational-curve distance candidates with conservative hull pruning.
 * matrix is relative to the query point and scaled into CSS pixels. */
export function hitTestProjectivePath(points:readonly PathAnchor[],closed:boolean,matrix:ProjectiveTransform,tolerance=7,budget:CurveHitBudget={remaining:65536}):CurveHit|null {
  if(!Number.isFinite(tolerance)||tolerance<0)return null;
  const view={x:-tolerance,y:-tolerance,width:2*tolerance,height:2*tolerance};const nearest:{hit:CurveHit|null}={hit:null};
  const consider=(p:Homogeneous,index:number,t:number)=>{const q=project(p);if(!q)return;const distance=Math.hypot(q.x,q.y);if(distance<=tolerance&&(!nearest.hit||distance<nearest.hit.distance))nearest.hit={index,t,distance};};
  const lower=(c:Cubic)=>{if(!possible(c,view))return Infinity;const h=finiteHull(c);return h?Math.hypot(Math.max(0,Math.min(...h.map(p=>p.x)),-Math.max(...h.map(p=>p.x))),Math.max(0,Math.min(...h.map(p=>p.y)),-Math.max(...h.map(p=>p.y)))):0;};
  for(let index=0,count=closed?points.length:Math.max(0,points.length-1);index<count;index++){
    const stack:{c:Cubic;from:number;to:number;depth:number}[]=[{c:controls(points[index],points[(index+1)%points.length],matrix),from:0,to:1,depth:0}];
    while(stack.length){
      if(--budget.remaining<0)throw new Error('Curve hit testing exceeded its work budget. Zoom in or use Insert midpoint.');
      const{c,from,to,depth}=stack.pop()!,distance=lower(c);if(distance>tolerance||(nearest.hit&&distance>=nearest.hit.distance-.01))continue;
      consider(c[0],index,from);consider(c[3],index,to);
      const a=project(c[0]),b=project(c[3]);if(a&&b){const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,ratio=length?Math.max(0,Math.min(1,-(a.x*dx+a.y*dy)/length)):.5;consider(divide(c,ratio)[0][3],index,from+ratio*(to-from));}
      const[left,right]=divide(c),middle=(from+to)/2;consider(left[3],index,middle);if(depth>=60||middle===from||middle===to)continue;
      const first={c:left,from,to:middle,depth:depth+1},second={c:right,from:middle,to,depth:depth+1};
      if(lower(left)<lower(right))stack.push(second,first);else stack.push(first,second);
    }
  }
  const result=nearest.hit;return result&&result.t>0&&result.t<1?result:null;
}
