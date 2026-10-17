import {openPngRows} from './png-rows';
import {AffineTransform} from '../src/core/affine';
import {maskTransform} from '../src/core/masks';
import {findLayer,isLocked,type DocumentData} from '../src/core/model';
import {layerTransform} from '../src/core/spatial';
import {transformSelection,type SelectionData} from '../src/core/drawing';
import {refineEdgeOptionsSchema,type MattingRequest} from '../src/core/matting';
import {selectNativeSubject} from '../src/engine/subject-selection';
import {prepareMattingTile,refineMattingTile,type MattingTileRequest} from '../src/engine/matting-tile';
import {runMattingJob} from '../src/engine/matting-workflow';
import type {MattingRegion} from '../src/engine/matting-output';
import {wasmMattingIterations} from '../src/engine/matting-iterations';
import {ClosedFormMatting} from '../src/intelligence/matting/closed-form';
import {renderSelection,featherAlpha,type PixelKernel} from '../src/engine/wasm';
// Keep kernel creation and its clone cache in the same tsx module namespace.
export {instantiateKernel} from '../src/engine/wasm';

export interface MattingPngInput {id:string;png:ArrayBuffer;width:number;height:number}
export async function runServerMatting(kernel:PixelKernel,document:DocumentData,request:MattingRequest,inputs:MattingPngInput[]){
  const options=refineEdgeOptionsSchema.parse(request.options),layer=findLayer(document,request.layerId);
  if(layer?.kind!=='raster'||isLocked(document,layer.id))throw new Error('Refine Edge requires an attached unlocked raster layer.');
  const decoded=new Map<string,{width:number;height:number;pixels:Uint8ClampedArray}>();
  const decode=async(id:string)=>{
    const cached=decoded.get(id);if(cached)return cached;
    const input=inputs.find(value=>value.id===id);if(!input)throw new Error('Missing matting PNG source.');
    const image=openPngRows(new Uint8Array(input.png));if(image.width!==input.width||image.height!==input.height)throw new Error('PNG dimensions do not match source metadata.');
    const count=image.width*image.height;if(!Number.isSafeInteger(count)||count*4>0x7fffffff)throw new Error('Matting source exceeds the working-buffer address range.');
    const pixels=new Uint8ClampedArray(count*4);for await(const strip of image.strips)pixels.set(strip.pixels,strip.y*image.width*4);
    const result={width:image.width,height:image.height,pixels};decoded.set(id,result);return result;
  };
  const source=await decode(layer.assetId),world=layerTransform(document,layer.id)!,placement=world.multiply(AffineTransform.scale(layer.width/source.width,layer.height/source.height));
  const activeMask=layer.mask?.enabled&&layer.mask.density>0?layer.mask:undefined;
  if(activeMask&&(activeMask.strokes?.length||!['selection','bitmap'].includes(activeMask.kind)))throw new Error('Headless matting supports selection/bitmap input masks; supply a native PNG trimap for painted/vector input.');
  const maskBitmap=activeMask?.kind==='bitmap'?await decode(activeMask.assetId):undefined;
  const explicit=options.trimapAssetId?await decode(options.trimapAssetId):undefined;
  if(explicit&&(explicit.width!==source.width||explicit.height!==source.height))throw new Error('Trimap asset must match native source dimensions.');
  if(options.trimap&&options.trimap.length!==source.width*source.height)throw new Error('Trimap buffer must match native source dimensions.');
  let selection:SelectionData|null=null,normalizeSourceAlpha=false;
  if(!activeMask){
    if(document.selection)selection=transformSelection(document.selection,placement.inverse());
    else if(!explicit&&!options.trimap){selection=await selectNativeSubject(kernel,source.pixels,{width:source.width,height:source.height,threshold:.35,expandRadius:0});normalizeSourceAlpha=true;if(!selection.regions.length&&!options.trimapStrokes.length)throw new Error('No foreground found. Start with a selection or trimap marks.');}
  }
  const maskTiles=new Map<string,Uint8Array>();
  const maskTile=(x:number,y:number)=>{
    const key=`${x},${y}`,cached=maskTiles.get(key);if(cached)return cached;
    const mask=activeMask!,radius=(mask.feather??0)/3,padding=3*Math.ceil(radius),width=512+2*padding,height=width;
    if(width*height>4_000_000)throw new Error('Mask feather exceeds the native working-buffer budget.');
    let pixels:Uint8ClampedArray;
    const matrix=maskTransform(mask,world);
    if(mask.kind==='selection')pixels=renderSelection(kernel,{selection:transformSelection(mask.selection,matrix)!,width,height,x:x-padding,y:y-padding,stepX:1,stepY:1});
    else{
      pixels=new Uint8ClampedArray(width*height*4);const inverse=matrix.inverse(),bitmap=maskBitmap!;
      const at=(xx:number,yy:number)=>bitmap.pixels[(Math.max(0,Math.min(bitmap.height-1,yy))*bitmap.width+Math.max(0,Math.min(bitmap.width-1,xx)))*4+3];
      for(let row=0;row<height;row++)for(let col=0;col<width;col++){
        const p=inverse.point({x:x-padding+col+.5,y:y-padding+row+.5});if(p.x<0||p.y<0||p.x>=bitmap.width||p.y>=bitmap.height)continue;
        const xx=p.x-.5,yy=p.y-.5,left=Math.floor(xx),top=Math.floor(yy),dx=xx-left,dy=yy-top;
        pixels[(row*width+col)*4+3]=Math.round((at(left,top)*(1-dx)+at(left+1,top)*dx)*(1-dy)+(at(left,top+1)*(1-dx)+at(left+1,top+1)*dx)*dy);
      }
    }
    if(radius)pixels=featherAlpha(kernel,pixels,{width,height,radiusX:radius,radiusY:radius});
    const output=new Uint8Array(512*512);for(let row=0;row<512;row++)for(let col=0;col<512;col++){const value=pixels[((row+padding)*width+col+padding)*4+3];output[row*512+col]=Math.round(255*(1-mask.density)+(mask.inverted?255-value:value)*mask.density);}
    maskTiles.set(key,output);while(maskTiles.size>32)maskTiles.delete(maskTiles.keys().next().value!);return output;
  };
  let matting:ClosedFormMatting|undefined;
  const capture=async(region:MattingRegion)=>{
    const {x,y,width,height}=region,pixels=new Uint8ClampedArray(width*height*4),initial=activeMask||selection?new Uint8Array(width*height):undefined,labels=explicit||options.trimap?new Uint8Array(width*height):undefined;
    let coverage:Uint8ClampedArray|undefined;if(selection&&!activeMask)coverage=renderSelection(kernel,{selection,width,height,x,y,stepX:1,stepY:1});
    for(let row=0;row<height;row++)for(let col=0;col<width;col++){
      const xx=x+col,yy=y+row,to=row*width+col;if(xx>=0&&yy>=0&&xx<source.width&&yy<source.height){const from=yy*source.width+xx;for(let c=0;c<4;c++)pixels[to*4+c]=source.pixels[from*4+c];if(labels)labels[to]=options.trimap?options.trimap[from]:explicit!.pixels[from*4+3];}
      if(initial){if(coverage)initial[to]=coverage[to*4+3];else{const p=placement.point({x:xx+.5,y:yy+.5}),px=Math.floor(p.x),py=Math.floor(p.y),tx=Math.floor(px/512)*512,ty=Math.floor(py/512)*512;initial[to]=maskTile(tx,ty)[(py-ty)*512+px-tx];}}
    }
    return{pixels,request:{...region,sourceWidth:source.width,sourceHeight:source.height,initial,labels,normalizeSourceAlpha,options:{...options,trimap:undefined,trimapAssetId:undefined}}};
  };
  try{return{...(await runMattingJob(source.width,source.height,options,capture,{
    async begin(width,height){matting=new ClosedFormMatting(width,height);},
    async accumulate(pixels,request:MattingTileRequest){matting!.add({...request,...prepareMattingTile(pixels,request)});},
    async solve(progress){return matting!.solve(progress,2000,'ic0',true,wasmMattingIterations(kernel));},
    async tile(pixels,request){return refineMattingTile(kernel,pixels,request,matting);},
  })),width:source.width,height:source.height};}finally{matting?.dispose();}
}
