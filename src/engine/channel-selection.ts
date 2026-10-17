import { channelCoverageSchema, type ChannelCoverageRequest, type ChannelLoadControl } from '../core/alpha-channels';
import { selectionRegionTransform, type SelectionData } from '../core/drawing';
import { SelectionRows } from '../core/selection-rows';
import { renderSelection, type PixelKernel } from './wasm';

/** Omit provably disjoint operations; a disjoint intersection resets coverage. */
function renderChannelTile(kernel:PixelKernel,selection:SelectionData,tile:{x:number;y:number;width:number;height:number;stepX:number;stepY:number}):Uint8ClampedArray{
  let regions:SelectionData['regions']=[];
  for(const region of selection.regions){
    const bounds=selectionRegionTransform(region).bounds(region);
    const slack=1e-10*(1+Math.abs(bounds.x)+Math.abs(bounds.y)+Math.abs(bounds.width)+Math.abs(bounds.height)+Math.abs(tile.x)+Math.abs(tile.y)+tile.width+tile.height);
    const disjoint=Number.isFinite(slack)&&(bounds.x+bounds.width<tile.x-slack||bounds.y+bounds.height<tile.y-slack||bounds.x>tile.x+tile.width+slack||bounds.y>tile.y+tile.height+slack);
    if(disjoint){if(region.operation==='intersect')regions=[];}
    else regions.push(region);
  }
  return regions.length?renderSelection(kernel,{...tile,selection:{regions}}):new Uint8ClampedArray(tile.width*tile.height*4);
}

/** Native byte coverage, including entire Boolean channel expressions and inverse. */
export async function composeChannelSelection(kernel:PixelKernel,input:ChannelCoverageRequest,progress:NonNullable<ChannelLoadControl['onProgress']>=()=>{}):Promise<SelectionData>{
  const request=channelCoverageSchema.parse(input),{width,height,selection,base,operation,invert}=request;
  if(!Number.isSafeInteger(width*height))throw new Error('Channel coverage exceeds safe integer indexing.');
  const rows=new SelectionRows({x:0,y:0,width,height});
  const bandHeight=Math.max(1,Math.min(512,Math.floor(4_000_000/width)));
  const total=Math.ceil(width/512)*Math.ceil(height/bandHeight);let completed=0;progress({completed,total});
  for(let y=0;y<height;y+=bandHeight){
    const h=Math.min(bandHeight,height-y),band=new Uint8Array(width*h);
    for(let x=0;x<width;x+=512){
      const w=Math.min(512,width-x),tile={width:w,height:h,x,y,stepX:1,stepY:1};
      const source=renderChannelTile(kernel,selection,tile);
      const previous=operation==='replace'?null:renderChannelTile(kernel,base??{regions:[]},tile);
      for(let row=0;row<h;row++)for(let col=0;col<w;col++){
        const i=(row*w+col)*4+3,b=invert?255-source[i]:source[i],a=previous?.[i]??0;
        band[row*width+x+col]=Math.round(operation==='replace'?b:operation==='add'?Math.max(a,b):operation==='subtract'?a*(1-b/255):Math.min(a,b));
      }
      progress({completed:++completed,total});
    }
    await rows.append(band);
  }
  return rows.finish();
}
