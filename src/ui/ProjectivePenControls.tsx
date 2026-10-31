import {memo,useEffect,useMemo} from 'react';
import type {PathAnchor,Point,Rect} from '../core/drawing';
import type {ProjectiveTransform} from '../core/projective';
import {projectivePathOutline} from '../core/projective-bezier';

interface Props {points:readonly PathAnchor[];matrix:ProjectiveTransform;clip:Rect;zoom:number;active:number;contour:boolean;onError?(message:string):void}
const endpoint=(p:Point):PathAnchor=>({...p,in:p,out:p});

/** SVG has no projective path transform. Display rational curves as bounded
 * screen-accurate lines; authored mask cubics never change for presentation. */
export const ProjectivePenControls=memo(function ProjectivePenControls({points,matrix,clip,zoom,active,contour,onError}:Props){
  const prepared=useMemo(()=>{
    try{
      const budget={remaining:262144},outline=projectivePathOutline(points,true,matrix,clip,.2/zoom,budget);
      const handles=points.map(p=>projectivePathOutline([endpoint(p.in),endpoint(p),endpoint(p.out)],false,matrix,clip,.2/zoom,budget));
      return{outline,handles,error:null};
    }catch(error){return{outline:'',handles:[],error:error instanceof Error?error.message:String(error)};}
  },[points,matrix,clip,zoom]);
  useEffect(()=>{if(prepared.error)onError?.(prepared.error);},[prepared.error,onError]);
  const visible=(p:Point)=>p.x>=clip.x&&p.y>=clip.y&&p.x<=clip.x+clip.width&&p.y<=clip.y+clip.height;
  const project=(p:Point):Point|null=>{try{return matrix.point(p);}catch{return null;}};
  return <g data-testid="projective-mask-controls" data-error={prepared.error??undefined}>
    <path data-testid="projective-mask-outline" d={prepared.outline} fill="none" stroke="#d5e79b" strokeWidth={1/zoom} strokeDasharray={contour?`${4/zoom} ${3/zoom}`:undefined}/>
    {points.map((point,index)=>{
      const p=project(point),inside=project(point.in),outside=project(point.out);
      return <g key={index}>
        <path d={prepared.handles[index]??''} fill="none" stroke="#d5e79b" strokeWidth={1/zoom}/>
        {[inside,outside].map((handle,i)=><circle key={i} cx={handle&&visible(handle)?handle.x:0} cy={handle&&visible(handle)?handle.y:0} display={handle&&visible(handle)?undefined:'none'} r={3/zoom} fill="#202523" stroke="#d5e79b" strokeWidth={1/zoom}/>)}
        <rect x={p&&visible(p)?p.x-4/zoom:0} y={p&&visible(p)?p.y-4/zoom:0} display={p&&visible(p)?undefined:'none'} width={8/zoom} height={8/zoom} fill={index===active?'#d5e79b':'#202523'} stroke="#d5e79b" strokeWidth={1/zoom}/>
      </g>;
    })}
  </g>;
},(a,b)=>a.zoom===b.zoom&&a.active===b.active&&a.contour===b.contour&&a.onError===b.onError&&
  a.clip.x===b.clip.x&&a.clip.y===b.clip.y&&a.clip.width===b.clip.width&&a.clip.height===b.clip.height&&
  a.matrix.values.every((v,i)=>v===b.matrix.values[i])&&(a.points===b.points||a.points.length===b.points.length&&a.points.every((p,i)=>{const q=b.points[i];return p.x===q.x&&p.y===q.y&&p.in.x===q.in.x&&p.in.y===q.in.y&&p.out.x===q.out.x&&p.out.y===q.out.y;})));
