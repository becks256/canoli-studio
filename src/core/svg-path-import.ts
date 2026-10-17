import {AffineTransform} from './affine';
import type {PathAnchor,Point} from './drawing';

export interface SvgContour {points:PathAnchor[];closed:boolean}
export interface SvgPathGeometry {contours:SvgContour[];approximatedArcs:number}
const numeric=/[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/y;

/** Strict SVG path grammar. No token skipping, missing-number substitution or
 * merging disjoint contours. Arc endpoint conversion follows SVG 2 appendix B;
 * arc primitives become explicitly reported cubic approximations.
 */
export function parseSvgContours(source:string,maxPoints=20000):SvgPathGeometry{
 let at=0,command='',previous='',firstArgument=true,total=0,approximatedArcs=0;
 let current:Point={x:0,y:0},start:Point={x:0,y:0},cubic:Point={x:0,y:0},quadratic:Point={x:0,y:0};
 const contours:SvgContour[]=[];let contour:SvgContour|undefined;
 const space=()=>{while(/[\t\n\r ]/.test(source[at]??'')&&at<source.length)at++;};
 const fail=():never=>{throw new Error(`Invalid SVG path data at offset ${at}.`);};
 function argument(flag=false):number{
  space();if(source[at]===','){if(firstArgument)fail();at++;space();}firstArgument=false;
  if(flag){const value=source[at++];if(value!=='0'&&value!=='1')fail();return Number(value);}
  numeric.lastIndex=at;const match=numeric.exec(source);if(!match)fail();at=numeric.lastIndex;const value=Number(match![0]);if(!Number.isFinite(value))fail();return value;
 }
 const valid=(point:Point)=>{if(![point.x,point.y].every(value=>Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER))throw new Error('SVG geometry exceeds native coordinate precision.');return point;};
 function append(point:Point,incoming=point,outgoing=point){
  if(++total>maxPoints)throw new Error(`SVG path exceeds the native ${maxPoints}-anchor editing budget.`);
  contour!.points.push({...valid(point),in:{...valid(incoming)},out:{...valid(outgoing)}});current={...point};
 }
 function line(point:Point){append(point);}
 function curve(a:Point,b:Point,end:Point){contour!.points.at(-1)!.out={...valid(a)};append(end,b);cubic={...b};}
 function arc(rx:number,ry:number,rotation:number,large:number,sweep:number,end:Point){
  rx=Math.abs(rx);ry=Math.abs(ry);if(current.x===end.x&&current.y===end.y)return;if(rx===0||ry===0){line(end);return;}
  const phi=(rotation%360)*Math.PI/180,c=Math.cos(phi),s=Math.sin(phi),dx=(current.x-end.x)/2,dy=(current.y-end.y)/2,x=c*dx+s*dy,y=-s*dx+c*dy;
  const scale=Math.hypot(x/rx,y/ry);if(scale>1){rx*=scale;ry*=scale;}
  const u=x/rx,v=y/ry,norm=u*u+v*v;
  if(!Number.isFinite(norm)||norm===0)throw new Error('SVG arc exceeds numeric conversion precision.');
  const factor=(large===sweep?-1:1)*Math.sqrt(Math.max(0,(1-norm)/norm)),cxp=factor*rx*v,cyp=-factor*ry*u,cx=c*cxp-s*cyp+(current.x+end.x)/2,cy=s*cxp+c*cyp+(current.y+end.y)/2;
  let angle=Math.atan2((y-cyp)/ry,(x-cxp)/rx),delta=Math.atan2((-y-cyp)/ry,(-x-cxp)/rx)-angle;
  if(sweep&&delta<0)delta+=2*Math.PI;if(!sweep&&delta>0)delta-=2*Math.PI;
  // Subdivide further for large radii; this is an approximation strategy, not
  // a promise of exact SVG arc identity or an image-resolution restriction.
  const step=Math.min(Math.PI/4,Math.pow(Math.max(Number.MIN_VALUE,0.01*4320/Math.max(rx,ry)),1/6)),count=Math.max(1,Math.ceil(Math.abs(delta)/step));
  if(!Number.isSafeInteger(count)||total+count>maxPoints)throw new Error(`SVG arc exceeds the native ${maxPoints}-anchor editing budget.`);
  const point=(t:number)=>({x:cx+rx*Math.cos(t)*c-ry*Math.sin(t)*s,y:cy+rx*Math.cos(t)*s+ry*Math.sin(t)*c});
  const tangent=(t:number)=>({x:-rx*Math.sin(t)*c-ry*Math.cos(t)*s,y:-rx*Math.sin(t)*s+ry*Math.cos(t)*c});
  for(let i=0;i<count;i++){const next=angle+delta/count,k=4/3*Math.tan((next-angle)/4),a=point(angle),b=i===count-1?end:point(next),ta=tangent(angle),tb=tangent(next);curve({x:a.x+k*ta.x,y:a.y+k*ta.y},{x:b.x-k*tb.x,y:b.y-k*tb.y},b);angle=next;}
  approximatedArcs++;
 }
 while(true){
  space();if(at===source.length)break;
  if(/[a-z]/i.test(source[at])){command=source[at++];if(!/[mlhvcsqtaz]/i.test(command))fail();firstArgument=true;}
  else if(!command)fail();
  const kind=command.toUpperCase(),relative=command!==kind,origin={...current};
  const pair=()=>({x:argument()+(relative?origin.x:0),y:argument()+(relative?origin.y:0)});
  if(kind==='M'){const point=valid(pair());contour={points:[],closed:false};contours.push(contour);append(point);start={...point};command=relative?'l':'L';}
  else{
   if(!contour)throw new Error('SVG paths must begin with moveto.');
   if(contour!.closed){if(kind==='Z'){command='';previous='Z';continue;}contour={points:[],closed:false};contours.push(contour);append(current);start={...current};}
   if(kind==='L')line(pair());
   else if(kind==='H')line({x:argument()+(relative?origin.x:0),y:origin.y});
   else if(kind==='V')line({x:origin.x,y:argument()+(relative?origin.y:0)});
   else if(kind==='C'){const a=pair(),b=pair(),end=pair();curve(a,b,end);}
   else if(kind==='S'){const a=previous==='C'||previous==='S'?{x:2*origin.x-cubic.x,y:2*origin.y-cubic.y}:origin,b=pair(),end=pair();curve(a,b,end);}
   else if(kind==='Q'||kind==='T'){
    const q=kind==='Q'?pair():previous==='Q'||previous==='T'?{x:2*origin.x-quadratic.x,y:2*origin.y-quadratic.y}:origin,end=pair();
    curve({x:origin.x+2/3*(q.x-origin.x),y:origin.y+2/3*(q.y-origin.y)},{x:end.x+2/3*(q.x-end.x),y:end.y+2/3*(q.y-end.y)},end);quadratic=q;
   }else if(kind==='A'){const rx=argument(),ry=argument(),rotation=argument(),large=argument(true),sweep=argument(true),end=pair();arc(rx,ry,rotation,large,sweep,end);}
   else if(kind==='Z'){
    const last=contour.points.at(-1)!;if(contour.points.length>1&&last.x===start.x&&last.y===start.y){contour.points[0].in={...last.in};contour.points.pop();total--;}
    contour.closed=true;current={...start};command='';
   }else fail();
  }
  previous=kind;
 }
 return{contours,approximatedArcs};
}

/** SVG transform-list multiplication preserves the authored order and pivots. */
export function svgNumbers(value:string):number[]{
 let at=0;const values:number[]=[];while(at<value.length){while(/\s/.test(value[at]??'')&&at<value.length)at++;if(at===value.length)break;if(value[at]===','){if(!values.length)throw new Error('Invalid SVG numeric list.');at++;while(/\s/.test(value[at]??'')&&at<value.length)at++;}numeric.lastIndex=at;const found=numeric.exec(value);if(!found)throw new Error('Invalid SVG numeric list.');const n=Number(found[0]);if(!Number.isFinite(n))throw new Error('SVG numbers must be finite.');values.push(n);at=numeric.lastIndex;}return values;
}

export function svgTransform(value:string):AffineTransform{
 let at=0,matrix=new AffineTransform();const expression=/([a-zA-Z]+)\s*\(([^)]*)\)/gy;
 while(at<value.length){while(/\s/.test(value[at]??'')&&at<value.length)at++;if(at===value.length)break;if(value[at]===','){if(!at||!value.slice(0,at).trim())throw new Error('Invalid SVG transform separator.');at++;while(/\s/.test(value[at]??'')&&at<value.length)at++;if(at===value.length||value[at]===',')throw new Error('Invalid SVG transform separator.');}expression.lastIndex=at;const match=expression.exec(value);if(!match)throw new Error('Invalid SVG transform list.');at=expression.lastIndex;const values=svgNumbers(match[2]),kind=match[1];let next:AffineTransform;
  if(kind==='matrix'&&values.length===6)next=new AffineTransform(...values as [number,number,number,number,number,number]);
  else if(kind==='translate'&&(values.length===1||values.length===2))next=AffineTransform.translation(values[0],values[1]??0);
  else if(kind==='scale'&&(values.length===1||values.length===2))next=AffineTransform.scale(values[0],values[1]??values[0]);
  else if(kind==='rotate'&&(values.length===1||values.length===3)){next=AffineTransform.rotation((values[0]%360)*Math.PI/180);if(values.length===3)next=next.around({x:values[1],y:values[2]});}
  else if((kind==='skewX'||kind==='skewY')&&values.length===1){const tangent=Math.tan((values[0]%360)*Math.PI/180);next=kind==='skewX'?new AffineTransform(1,0,tangent,1):new AffineTransform(1,tangent,0,1);}
  else throw new Error('Unsupported SVG transform parameters.');matrix=matrix.multiply(next);
 }
 matrix.inverse();return matrix;
}
/** Matrix mapping intrinsic/viewBox bounds into a viewport. */
export function svgViewBox(width:number,height:number,box:readonly number[],aspect='xMidYMid meet'):AffineTransform{
 if(box.length!==4||box[2]<=0||box[3]<=0)throw new Error('SVG viewBox needs four finite numbers and positive dimensions.');
 const parts=aspect.trim().replace(/^defer\s+/,'').split(/\s+/);if(parts[0]==='none'&&parts.length===1)return AffineTransform.scale(width/box[2],height/box[3]).multiply(AffineTransform.translation(-box[0],-box[1]));
 const match=/^x(Min|Mid|Max)Y(Min|Mid|Max)$/.exec(parts[0]);if(!match||parts.length>2||(parts[1]&&!['meet','slice'].includes(parts[1])))throw new Error('Unsupported preserveAspectRatio value.');
 const factor=parts[1]==='slice'?Math.max(width/box[2],height/box[3]):Math.min(width/box[2],height/box[3]),align={Min:0,Mid:0.5,Max:1};
 return AffineTransform.translation((width-box[2]*factor)*align[match[1] as keyof typeof align],(height-box[3]*factor)*align[match[2] as keyof typeof align]).multiply(AffineTransform.scale(factor)).multiply(AffineTransform.translation(-box[0],-box[1]));
}
