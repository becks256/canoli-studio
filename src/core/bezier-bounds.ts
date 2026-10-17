import type {PathAnchor,Point,Rect} from './drawing';

/** Exact cubic extrema (within floating-point precision), excluding stroke. */
export function bezierGeometryBounds(contours:readonly {points:readonly PathAnchor[];closed:boolean}[]):Rect{
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 const add=(p:Point)=>{left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);};
 for(const {points,closed} of contours){
  for(const p of points)add(p);
  for(let i=0;i<(closed?points.length:points.length-1);i++){
   const p=points[i],q=points[(i+1)%points.length];
   for(const axis of ['x','y'] as const){
    const v=[p[axis],p.out[axis],q.in[axis],q[axis]],a=-v[0]+3*v[1]-3*v[2]+v[3],b=2*(v[0]-2*v[1]+v[2]),c=v[1]-v[0],scale=Math.max(Math.abs(a),Math.abs(b),Math.abs(c));
    if(!scale)continue;
    const aa=a/scale,bb=b/scale,cc=c/scale,disc=bb*bb-4*aa*cc;
    const roots:number[]=[];
    if(aa===0){if(bb!==0)roots.push(-cc/bb);}
    else if(disc>=0){const r=-.5*(bb+(bb<0?-1:1)*Math.sqrt(disc));if(r===0)roots.push(-bb/(2*aa));else roots.push(r/aa,cc/r);}
    for(const t of roots)if(t>0&&t<1){
     const lerp=(a:Point,b:Point)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
     add(lerp(lerp(lerp(p,p.out),lerp(p.out,q.in)),lerp(lerp(p.out,q.in),lerp(q.in,q))));
    }
   }
  }
 }
 return Number.isFinite(left)?{x:left,y:top,width:right-left,height:bottom-top}:{x:0,y:0,width:0,height:0};
}
