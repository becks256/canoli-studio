import type { AssetStore } from '../core/assets';
import { AffineTransform } from '../core/affine';
import { brushTextureSourceSchema, type BrushTextureSource } from '../core/brush-texture';
import { paintOperationSchema, type BrushStrokeData, type StrokePoint } from '../core/drawing';
import { freeze, isImmutable } from '../core/immutable';
import { paintStampAlpha, paintStampGeometry, paintStampSize, sameStrokePoint, strokeStamps } from '../core/paint-stamps';
import { BrushTextureSampler, type TexturePreparationControl } from './brush-texture';
import { createCanvas, release, renderTransform, type RenderSpace } from './canvas';
import type { PixelProcessor } from './processor';

/** Native raw-ink replay shared by authored strokes and trusted active previews. */
export class TexturedStrokeRaster {
  private readonly sampler:BrushTextureSampler;
  private readonly ownsSampler:boolean;
  private canvas:HTMLCanvasElement|null=null;
  private signature='';
  private points:readonly StrokePoint[]=[];
  private identities=new WeakMap<ImageBitmap,number>();
  private sequence=0;
  private generation=0;
  private disposed=false;
  private pending:Promise<void>=Promise.resolve();
  private replay:Readonly<{from:number;dabs:number;tiles:number;retained:boolean}>=Object.freeze({from:0,dabs:0,tiles:0,retained:false});

  constructor(processor:Pick<PixelProcessor,'brushTexture'>,cacheBudget=32*1024*1024,sampler?:BrushTextureSampler) {
    this.ownsSampler=!sampler;
    this.sampler=sampler??new BrushTextureSampler(processor,cacheBudget);
  }
  get lastReplay(){return this.replay;}
  get retainedBytes(){return this.canvas?this.canvas.width*this.canvas.height*4:0;}
  get textureCacheBytes(){return this.sampler.byteLength;}

  /** Raw ink only: the caller applies captured selection and whole-stroke opacity once. */
  async draw(
    stroke:BrushStrokeData,
    texture:BrushTextureSource,
    assets:AssetStore,
    target:HTMLCanvasElement,
    inputSpace:RenderSpace,
    world=new AffineTransform(),
    control:TexturePreparationControl={},
  ):Promise<void> {
    // Own mutable callers before queueing or yielding; model snapshots share their registry proof.
    const owned=freeze(isImmutable(stroke)?stroke:structuredClone(stroke));
    if(!isImmutable(stroke))paintOperationSchema.parse(owned);
    const source=brushTextureSourceSchema.parse(texture),space={...inputSpace};
    if(!Number.isSafeInteger(space.width)||!Number.isSafeInteger(space.height)||space.width<=0||space.height<=0||
        target.width!==space.width||target.height!==space.height||![space.x,space.y,space.sx,space.sy].every(Number.isFinite)||space.sx<=0||space.sy<=0)
      return Promise.reject(new Error('Textured stroke replay requires a matching finite working surface and positive sampling scale.'));
    const asset=assets.get(source.assetId),bitmap=asset.bitmap,generation=this.generation,lifetime=assets.captureLifetime();
    const check=()=>{
      control.signal?.throwIfAborted();
      if(control.isCancelled?.())throw new Error('Textured stroke replay was cancelled.');
      if(this.disposed||this.generation!==generation)throw new Error('Textured stroke replay was cleared or disposed.');
      lifetime();
      if(!assets.has(source.assetId)||assets.get(source.assetId)!==asset||asset.bitmap!==bitmap||
          bitmap.width!==asset.width||bitmap.height!==asset.height||!bitmap.width||!bitmap.height)
        throw new Error('The texture source changed during stroke replay.');
      if(target.width!==space.width||target.height!==space.height)throw new Error('The textured stroke target changed during replay.');
    };
    const run=this.pending.then(async()=>{
      check();
      let identity=this.identities.get(bitmap);
      if(identity===undefined)this.identities.set(bitmap,identity=++this.sequence);
      const {points,...settings}=owned;
      const signature=JSON.stringify([settings,source,identity,space,world]);
      const reusable=signature===this.signature&&points.length>=this.points.length&&this.points.every((p,i)=>sameStrokePoint(p,points[i]));
      const retain=space.width*space.height*4<=16*1024*1024;
      const from=reusable&&retain?this.points.length:0;
      // Build privately; cancellation cannot leave an advanced half-prefix or alter the caller target.
      const stage=createCanvas(space.width,space.height);
      let installed=false,dabs=0,tiles=0;
      try{
        if(reusable&&this.canvas)stage.getContext('2d')!.drawImage(this.canvas,0,0);
        const output=stage.getContext('2d')!,view=world.inverse().bounds({x:space.x,y:space.y,width:space.width/space.sx,height:space.height/space.sy});
        const projection=renderTransform(space,world);
        for(const point of strokeStamps(owned,view,from)){
          check();
          const alpha=paintStampAlpha(owned,point);
          if(paintStampSize(owned,point)<=0||alpha<=0)continue;
          const g=paintStampGeometry(owned,point,true);
          if(g.rx<=0||g.ry<=0)continue;
          const frame=projection.multiply(new AffineTransform(g.a*g.rx,g.b*g.rx,g.c*g.ry,g.d*g.ry,g.cx,g.cy));
          const bounds=frame.bounds({x:-1,y:-1,width:2,height:2});
          const left=Math.max(0,Math.floor(bounds.x-2)),top=Math.max(0,Math.floor(bounds.y-2));
          const right=Math.min(space.width,Math.ceil(bounds.x+bounds.width+2)),bottom=Math.min(space.height,Math.ceil(bounds.y+bounds.height+2));
          if(right<=left||bottom<=top)continue;
          const sourceToOutput=frame.multiply(AffineTransform.translation(-1,-1)).multiply(AffineTransform.scale(2/asset.width,2/asset.height));
          for(let y=top;y<bottom;y+=1024)for(let x=left;x<right;x+=1024){
            check();
            const width=Math.min(1024,right-x),height=Math.min(1024,bottom-y);
            const tile=await this.sampler.prepareAffine(assets,source,{
              width,height,smoothing:owned.kind!=='pencil',
              sourceToOutput:AffineTransform.translation(-x,-y).multiply(sourceToOutput).toJSON(),
            },{signal:control.signal,isCancelled:()=>{check();return false;}});
            let shape:HTMLCanvasElement|undefined;
            try{
              check();
              shape=createCanvas(width,height);
              const c=shape.getContext('2d')!;
              c.setTransform(frame.a,frame.b,frame.c,frame.d,frame.e-x,frame.f-y);
              c.fillStyle='#ffffff';
              if(owned.kind==='pencil')c.fillRect(-1,-1,2,2);
              else{
                if(owned.hardness<.999){const gradient=c.createRadialGradient(0,0,owned.hardness,0,0,1);gradient.addColorStop(0,'#ffffff');gradient.addColorStop(1,'#ffffff00');c.fillStyle=gradient;}
                c.beginPath();c.arc(0,0,1,0,Math.PI*2);c.fill();
              }
              const mask=tile.getContext('2d')!;
              mask.globalCompositeOperation='destination-in';mask.drawImage(shape,0,0);
              mask.globalCompositeOperation='source-in';mask.fillStyle=owned.kind==='clone'||owned.kind==='eraser'?'#000000':owned.color;mask.fillRect(0,0,width,height);
              output.globalAlpha=alpha;output.drawImage(tile,x,y);
              tiles++;
            }finally{if(shape)release(shape);release(tile);}
          }
          dabs++;
        }
        check();
        const context=target.getContext('2d')!;
        context.save();try{context.resetTransform();context.drawImage(stage,0,0);}finally{context.restore();}
        if(this.canvas)release(this.canvas);
        this.canvas=retain?stage:null;installed=retain;
        this.signature=retain?signature:'';this.points=retain?points:[];
        this.replay=Object.freeze({from,dabs,tiles,retained:retain});
      }finally{if(!installed)release(stage);}
    });
    this.pending=run.then(()=>undefined,()=>undefined);
    return run;
  }

  clear(){
    this.generation++;
    if(this.canvas)release(this.canvas);
    this.canvas=null;this.signature='';this.points=[];
    this.identities=new WeakMap();if(this.ownsSampler)this.sampler.clear();
  }
  dispose(){this.disposed=true;this.clear();if(this.ownsSampler)this.sampler.dispose();}
}
