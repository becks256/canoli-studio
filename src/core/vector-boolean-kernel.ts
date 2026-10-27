import paper from 'paper/dist/paper-core.js';
import { vectorBooleanRequestSchema, vectorBooleanResultSchema, type VectorBooleanRequest, type VectorBooleanResult, type VectorBooleanProgress } from './vector-boolean';
import type { Point, PathAnchor } from './drawing';

/** Inert worker/Node cubic geometry. No DOM, rasterization, source assets or host state. */
export function calculateVectorBoolean(value: VectorBooleanRequest, progress?: (value: VectorBooleanProgress) => void): VectorBooleanResult {
  // Paper's types omit its supported headless constructor and scope cleanup.
  const request = vectorBooleanRequestSchema.parse(value), scope = new paper.PaperScope() as paper.PaperScope & { Project: new () => paper.Project; remove(): void };
  new scope.Project();
  try {
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for (const path of request.paths) for (const contour of path.contours) for (const anchor of contour) for (const p of [anchor,anchor.in,anchor.out]) {
      left=Math.min(left,p.x);right=Math.max(right,p.x);top=Math.min(top,p.y);bottom=Math.max(bottom,p.y);
    }
    const extent=Math.max(right-left,bottom-top);
    if (!extent) return {contours:[],fillRule:'nonzero'};
    const center={x:left+(right-left)/2,y:top+(bottom-top)/2};
    const normalize=(p:Point)=>new scope.Point((p.x-center.x)/extent*1024,(p.y-center.y)/extent*1024);
    const restore=(p:paper.Point):Point=>({x:center.x+p.x/1024*extent,y:center.y+p.y/1024*extent});
    const convert=(data:VectorBooleanRequest['paths'][number]):paper.PathItem=>{
      const children=data.contours.map(points=>new scope.Path({insert:false,closed:true,segments:points.map(p=>{
        const a=normalize(p);return new scope.Segment(a,normalize(p.in).subtract(a),normalize(p.out).subtract(a));
      })}));
      const path:paper.PathItem=children.length===1?children[0]:new scope.CompoundPath({insert:false,children});
      path.fillRule=data.fillRule;path.fillColor=new scope.Color(1,1,1);return path;
    };
    const extract=(item:paper.PathItem):paper.Path[]=>item instanceof scope.CompoundPath?item.children as paper.Path[]:[item as paper.Path];
    let result=convert(request.paths[0]);
    const total=request.paths.length-1;
    progress?.({completed:0,total});
    for(let i=1;i<request.paths.length;i++){
      const other=convert(request.paths[i]),previous=result,options={insert:false,trace:true};
      result=request.operation==='union'?result.unite(other,options):request.operation==='subtract'?result.subtract(other,options):request.operation==='intersect'?result.intersect(other,options):result.exclude(other,options);
      previous.remove();other.remove();result.reorient(true,true);result.fillRule='nonzero';
      const parts=extract(result);
      if(parts.length>128||parts.reduce((sum,p)=>sum+p.segments.length,0)>20000)throw new Error('Boolean result exceeds 128 contours or 20000 anchors.');
      progress?.({completed:i,total});
    }
    const contours=extract(result).filter(p=>p.segments.length&&Math.abs(p.area)>0).map(p=>p.segments.map((s):PathAnchor=>({
      ...restore(s.point),in:restore(s.point.add(s.handleIn)),out:restore(s.point.add(s.handleOut)),
    })));
    return vectorBooleanResultSchema.parse({contours,fillRule:'nonzero'});
  } finally { scope.remove(); }
}
