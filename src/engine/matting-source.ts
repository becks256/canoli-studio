import {AffineTransform} from '../core/affine';
import {maskTransform} from '../core/masks';
import {findLayer,isLocked,type DocumentData,type RasterLayerData} from '../core/model';
import {layerTransform} from '../core/spatial';
import {transformSelection,type SelectionData} from '../core/drawing';
import type {AssetStore} from '../core/assets';
import type {MattingRequest} from '../core/matting';
import {CanvasRenderer} from './renderer';
import {PixelProcessor} from './processor';
import {createCanvas,release} from './canvas';
import {prepareSubject} from './prepare-subject';
import type {MattingRegion} from './matting-output';

/** Source-owned native capture and effective input coverage; the document is immutable. */
export class MattingSource {
  readonly layer:RasterLayerData;
  readonly asset;
  readonly placement:AffineTransform;
  readonly world:AffineTransform;
  private renderer:CanvasRenderer;
  readonly processor:PixelProcessor;
  private maskTiles=new Map<string,Uint8Array>();
  private selection:SelectionData|null=null;
  private maskStep:number;
  normalizeSourceAlpha=false;
  constructor(readonly document:DocumentData,readonly assets:AssetStore,readonly request:MattingRequest,readonly check:()=>void,preview=false){
    const layer=findLayer(document,request.layerId);if(layer?.kind!=='raster'||isLocked(document,layer.id))throw new Error('Refine Edge requires an attached unlocked raster layer.');
    this.layer=layer;this.asset=assets.get(layer.assetId);this.world=layerTransform(document,layer.id)!;
    this.placement=this.world.multiply(AffineTransform.scale(layer.width/this.asset.width,layer.height/this.asset.height));
    this.maskStep=preview?Math.max(1,Math.hypot(this.placement.a,this.placement.b),Math.hypot(this.placement.c,this.placement.d)):1;
    if(request.options.trimap&&request.options.trimap.length!==this.asset.width*this.asset.height)throw new Error('Trimap buffer must match native source dimensions.');
    if(request.options.trimapAssetId){const labels=assets.get(request.options.trimapAssetId);if(labels.width!==this.asset.width||labels.height!==this.asset.height)throw new Error('Trimap asset must match native source dimensions.');}
    this.renderer=new CanvasRenderer();this.processor=new PixelProcessor();
  }
  async initialize(signal?:AbortSignal,allowEmptyPreview=false){
    this.check();
    const options=this.request.options;
    if(this.layer.mask?.enabled&&this.layer.mask.density>0)return;
    if(this.document.selection){this.selection=transformSelection(this.document.selection,this.placement.inverse());return;}
    if(options.trimap||options.trimapAssetId)return;
    const selection=await prepareSubject(this.document,this.assets,{targetLayerId:this.layer.id},{signal},this.check);
    if(!selection.regions.length&&!options.trimapStrokes.length&&!allowEmptyPreview)throw new Error('No foreground found. Start with a selection or trimap marks.');
    this.selection=transformSelection(selection,this.placement.inverse());this.normalizeSourceAlpha=true;
  }
  private capture(bitmap:ImageBitmap,region:MattingRegion){
    const canvas=createCanvas(region.width,region.height,true);
    try{const context=canvas.getContext('2d')!;context.drawImage(bitmap,-region.x,-region.y);return context.getImageData(0,0,region.width,region.height).data;}
    finally{release(canvas);}
  }
  async captureTile(region:MattingRegion){
    this.check();const pixels=this.capture(this.asset.bitmap,region),{width,height,x,y}=region,options=this.request.options;
    let initial:Uint8Array|undefined;
    const mask=this.layer.mask;
    if(mask?.enabled&&mask.density>0){
      initial=new Uint8Array(width*height);
      // Sample the existing world-space mask at source centers, including its real feather.
      const groups=new Map<string,{tx:number;ty:number;points:number[]}>();
      for(let row=0;row<height;row++)for(let col=0;col<width;col++){
        const point=this.placement.point({x:Math.max(.5,Math.min(this.asset.width-.5,x+col+.5)),y:Math.max(.5,Math.min(this.asset.height-.5,y+row+.5))}),px=Math.floor(point.x/this.maskStep),py=Math.floor(point.y/this.maskStep),tx=Math.floor(px/512)*512,ty=Math.floor(py/512)*512,key=`${tx},${ty}`;
        let group=groups.get(key);if(!group){group={tx,ty,points:[]};groups.set(key,group);}group.points.push(row*width+col,(py-ty)*512+px-tx);
      }
      for(const [key,group] of groups){
        this.check();let alpha=this.maskTiles.get(key);
        if(!alpha){
          const basis=maskTransform(mask,this.world),canvas=await this.renderer.renderMaskCoverage(mask,{x:group.tx*this.maskStep,y:group.ty*this.maskStep,width:512,height:512,sx:1/this.maskStep,sy:1/this.maskStep},0,0,'matting-input',false,basis,this.assets);
          try{const rgba=canvas.getContext('2d')!.getImageData(0,0,512,512).data;alpha=new Uint8Array(512*512);for(let i=0;i<alpha.length;i++)alpha[i]=Math.round(255*(1-mask.density)+(mask.inverted?255-rgba[i*4+3]:rgba[i*4+3])*mask.density);}
          finally{release(canvas);}
          this.maskTiles.set(key,alpha);while(this.maskTiles.size>32)this.maskTiles.delete(this.maskTiles.keys().next().value!);
        }
        for(let i=0;i<group.points.length;i+=2)initial[group.points[i]]=alpha[group.points[i+1]];
      }
    }else if(this.selection){
      const rgba=await this.processor.selection({selection:this.selection,width,height,x,y,stepX:1,stepY:1});initial=new Uint8Array(width*height);for(let i=0;i<initial.length;i++)initial[i]=rgba[i*4+3];
    }
    let labels:Uint8Array|undefined;
    if(options.trimap){labels=new Uint8Array(width*height);for(let row=0;row<height;row++)for(let col=0;col<width;col++){const xx=x+col,yy=y+row;if(xx>=0&&yy>=0&&xx<this.asset.width&&yy<this.asset.height)labels[row*width+col]=options.trimap[yy*this.asset.width+xx];}}
    else if(options.trimapAssetId){const rgba=this.capture(this.assets.get(options.trimapAssetId).bitmap,region);labels=new Uint8Array(width*height);for(let i=0;i<labels.length;i++)labels[i]=rgba[i*4+3];}
    this.check();return{pixels,request:{...region,sourceWidth:this.asset.width,sourceHeight:this.asset.height,initial,labels,normalizeSourceAlpha:this.normalizeSourceAlpha,options:{...options,trimap:undefined,trimapAssetId:undefined}}};
  }
  dispose(){this.processor.dispose();this.renderer.dispose();this.maskTiles.clear();}
}
