import type { AssetStore } from '../core/assets';
import { AffineTransform } from '../core/affine';
import { brushTextureSourceSchema, type BrushTextureSource } from '../core/brush-texture';
import { paintOperationSchema, type BrushStrokeData, type StrokePoint } from '../core/drawing';
import { freeze, isImmutable } from '../core/immutable';
import { paintStampAlpha, paintStampGeometry, paintStampSize, sameStrokePoint, strokeStamps } from '../core/paint-stamps';
import { BrushTextureSampler, type TexturePreparationControl, type TextureReadbackRegion } from './brush-texture';
import { createCanvas, release, renderTransform,canonicalCellOffset, type RenderSpace } from './canvas';
import {RawStrokeCoverage} from './paint-coverage';
import type { PixelProcessor } from './processor';
import {yieldTask} from './task-yield';

/** Complete small footprints and document-anchored large sampling cells do not
 * depend on which viewport/export region asks for the texture. */
function* textureWorkTiles(bounds:{x:number;y:number;width:number;height:number},space:RenderSpace){
  const left=Math.floor(bounds.x-2),top=Math.floor(bounds.y-2),right=Math.ceil(bounds.x+bounds.width+2),bottom=Math.ceil(bounds.y+bounds.height+2);
  if(right<=0||bottom<=0||left>=space.width||top>=space.height)return;
  const width=right-left,height=bottom-top;
  if([left,top,right,bottom,width,height].every(Number.isSafeInteger)&&width>0&&height>0&&width<=4096&&height<=4096&&width*height<=260*260){
    yield{x:left,y:top,width,height,complete:true,sourceX:0,sourceY:0,outputX:left,outputY:top,outputWidth:width,outputHeight:height};return;
  }
  const cell=256,rows=128,halo=2;
  for(let y=canonicalCellOffset(space.y,space.sy,rows);y<space.height;y+=rows)for(let x=canonicalCellOffset(space.x,space.sx,cell);x<space.width;x+=cell){
    if(x+cell<=left||y+rows<=top||x>=right||y>=bottom)continue;
    const outputX=Math.max(0,x),outputY=Math.max(0,y),outputRight=Math.min(space.width,x+cell),outputBottom=Math.min(space.height,y+rows);
    yield{x:x-halo,y:y-halo,width:cell+2*halo,height:rows+2*halo,complete:false,sourceX:outputX-x+halo,sourceY:outputY-y+halo,outputX,outputY,outputWidth:outputRight-outputX,outputHeight:outputBottom-outputY};
  }
}

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
      const pigment=owned.kind==='clone'||owned.kind==='eraser'?'#000000':owned.color;
      // Binary premultiplied channels equal zero or alpha. Full-flow native
      // source-over is monotone; fractional global alpha has different byte
      // rounding and must not use this saturation certificate.
      const fullFlow=(owned.flow??1)===1&&(!owned.pressureOpacity||(owned.points.every(point=>point.pressure===1)&&paintStampAlpha(owned,owned.points[0])===1));
      const canSkipCoverage=fullFlow&&[1,3,5].every(start=>{const value=parseInt(pigment.slice(start,start+2),16);return value===0||value===255;});
      const stage=createCanvas(space.width,space.height,canSkipCoverage);
      const geometry=new RawStrokeCoverage();
      let installed=false,dabs=0,tiles=0;
      try{
        if(reusable&&this.canvas)stage.getContext('2d')!.drawImage(this.canvas,0,0);
        const output=stage.getContext('2d')!,view=world.inverse().bounds({x:space.x-2/space.sx,y:space.y-2/space.sy,width:(space.width+4)/space.sx,height:(space.height+4)/space.sy});
        const projection=renderTransform(space,world);
        function* plans(){
          for(const point of strokeStamps(owned,view,from)){
            check();
            const alpha=paintStampAlpha(owned,point);
            if(paintStampSize(owned,point)<=0||alpha<=0)continue;
            const g=paintStampGeometry(owned,point,true);
            if(g.rx<=0||g.ry<=0)continue;
            const frame=projection.multiply(new AffineTransform(g.a*g.rx,g.b*g.rx,g.c*g.ry,g.d*g.ry,g.cx,g.cy));
            const bounds=frame.bounds({x:-1,y:-1,width:2,height:2});
            const sourceToOutput=frame.multiply(AffineTransform.translation(-1,-1)).multiply(AffineTransform.scale(2/asset.width,2/asset.height));
            for(const work of textureWorkTiles(bounds,space))yield{point,alpha,frame,sourceToOutput,work,bounds};
          }
        }
        const opacity=new Map<string,{revision:number;minimum:number}>();let revision=0,deadline=performance.now()+2;
        const visible=(work:ReturnType<typeof textureWorkTiles> extends Generator<infer T>?T:never)=>{
          const x=Math.max(0,work.outputX),y=Math.max(0,work.outputY),right=Math.min(space.width,work.outputX+work.outputWidth),bottom=Math.min(space.height,work.outputY+work.outputHeight);
          return{x,y,width:right-x,height:bottom-y};
        };
        const minimum=(work:ReturnType<typeof textureWorkTiles> extends Generator<infer T>?T:never)=>{
          if(!canSkipCoverage)return 0;
          const r=visible(work),key=JSON.stringify(r),cached=opacity.get(key);
          if(cached&&(cached.minimum===255||cached.revision===revision))return cached.minimum;
          let value=0;
          if(from||cached){const pixels=output.getImageData(r.x,r.y,r.width,r.height).data;value=255;for(let i=3;i<pixels.length;i+=4){value=Math.min(value,pixels[i]);if(!value)break;}}
          if(opacity.size>=256)opacity.delete(opacity.keys().next().value!);
          opacity.set(key,{revision,minimum:value});return value;
        };
        const unknown=new Map<string,TextureReadbackRegion>();
        const readback=(work:ReturnType<typeof textureWorkTiles> extends Generator<infer T>?T:never,alpha:number,dab:{x:number;y:number;width:number;height:number})=>{
          const r=visible(work);
          if(!canSkipCoverage||alpha!==1)return{x:0,y:0,width:work.width,height:work.height};
          const key=JSON.stringify(r);let bounds=unknown.get(key);
          if(!bounds){
            bounds=r;
            if(from){
              const pixels=output.getImageData(r.x,r.y,r.width,r.height).data;
              let left=r.width,top=r.height,right=0,bottom=0;
              for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++)if(pixels[(y*r.width+x)*4+3]!==255){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
              if(right>left&&bottom>top)bounds={x:r.x+left,y:r.y+top,width:right-left,height:bottom-top};
            }
            if(unknown.size>=256)unknown.delete(unknown.keys().next().value!);unknown.set(key,bounds);
          }
          // Under the proven binary/full-flow certificate, alpha only grows.
          // A stale non-opaque bounding box remains a conservative superset.
          const x=Math.max(bounds.x,Math.floor(dab.x-2)),y=Math.max(bounds.y,Math.floor(dab.y-2)),right=Math.min(bounds.x+bounds.width,Math.ceil(dab.x+dab.width+2)),bottom=Math.min(bounds.y+bounds.height,Math.ceil(dab.y+dab.height+2));
          return right>x&&bottom>y?{x:x-work.x,y:y-work.y,width:right-x,height:bottom-y}:{x:0,y:0,width:work.width,height:work.height};
        };
        const unchanged=(value:number,alpha:number,maximum=255)=>{
          return canSkipCoverage&&alpha===1&&2*(255-value)*maximum<255;
        };
        const checkpoint=async()=>{if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}};
        const iterator=plans();let next=iterator.next(),lastPoint:object|undefined;
        while(!next.done){
          const batch:typeof next.value[]= [];let pixels=0;
          while(!next.done&&batch.length<64){
            const job=next.value,area=job.work.width*job.work.height;
            if(unchanged(minimum(job.work),job.alpha)){next=iterator.next();await checkpoint();continue;}
            if(batch.length&&pixels+area>1_000_000)break;
            batch.push(job);pixels+=area;next=iterator.next();
          }
          if(!batch.length)continue;
          check();
          const regions=batch.map(({work,alpha,bounds})=>readback(work,alpha,bounds));
          const prepared=await this.sampler.prepareAffineBatch(assets,source,batch.map(({work,sourceToOutput})=>({
            width:work.width,height:work.height,smoothing:owned.kind!=='pencil',
            sourceToOutput:AffineTransform.translation(-work.x,-work.y).multiply(sourceToOutput).toJSON(),
          })),{signal:control.signal,isCancelled:()=>{check();return false;}},regions);
          try{
            for(const [index,{point,alpha,frame,work}]of batch.entries()){
              check();const {x,y,width,height}=work,tile=prepared[index],region=regions[index];
              tiles++;if(lastPoint!==point){lastPoint=point;dabs++;}
              if(canSkipCoverage){
                const maximum=this.sampler.preparedMaximum(tile)??255;
                if(unchanged(minimum(work),alpha,maximum)){await checkpoint();continue;}
              }
              let shape:HTMLCanvasElement|undefined;
              try{
                const integerPencil=owned.kind==='pencil'&&frame.b===0&&frame.c===0&&[frame.e-Math.abs(frame.a),frame.e+Math.abs(frame.a),frame.f-Math.abs(frame.d),frame.f+Math.abs(frame.d)].every(Number.isSafeInteger);
                shape=createCanvas(integerPencil?region.width:work.complete?width:work.outputWidth,integerPencil?region.height:work.complete?height:work.outputHeight,integerPencil||!work.complete);
                const c=shape.getContext('2d')!;
                const ox=integerPencil?x+region.x:work.complete?x:work.outputX,oy=integerPencil?y+region.y:work.complete?y:work.outputY;
                const left=Math.max(0,frame.e-ox-Math.abs(frame.a)),top=Math.max(0,frame.f-oy-Math.abs(frame.d)),right=Math.min(shape.width,frame.e-ox+Math.abs(frame.a)),bottom=Math.min(shape.height,frame.f-oy+Math.abs(frame.d));
                if(owned.kind==='pencil'&&frame.b===0&&frame.c===0&&[left,top,right,bottom].every(Number.isSafeInteger)){
                  c.fillStyle='#ffffff';if(right>left&&bottom>top)c.fillRect(left,top,right-left,bottom-top);
                }else if(work.complete){
                  c.setTransform(frame.a,frame.b,frame.c,frame.d,frame.e-x,frame.f-y);
                  c.fillStyle='#ffffff';
                  if(owned.kind==='pencil')c.fillRect(-1,-1,2,2);
                  else{
                    if(owned.hardness<.999){const gradient=c.createRadialGradient(0,0,owned.hardness,0,0,1);gradient.addColorStop(0,'#ffffff');gradient.addColorStop(1,'#ffffff00');c.fillStyle=gradient;}
                    c.beginPath();c.arc(0,0,1,0,Math.PI*2);c.fill();
                  }
                }else{
                  const size=owned.kind==='pencil'?Math.max(1,Math.round(paintStampSize(owned,point))):paintStampSize(owned,point),radius=size/2;
                  const shapeStroke:BrushStrokeData={...owned,kind:owned.kind==='pencil'?'pencil':'brush',points:[{x:radius,y:radius,pressure:1}],size,color:'#ffffff',flow:1,opacity:1,pressureSize:false,pressureOpacity:false,pressureCurve:undefined,tip:undefined,symmetry:undefined,texture:undefined,clip:null,tiles:[]};
                  const shapeWorld=AffineTransform.translation(-x,-y).multiply(frame).multiply(AffineTransform.scale(1/radius)).multiply(AffineTransform.translation(-radius,-radius));
                  await geometry.draw(shapeStroke,shape,{x:work.sourceX,y:work.sourceY,width:work.outputWidth,height:work.outputHeight,sx:1,sy:1},shapeWorld,0,true,()=>{check();return false;});
                }
                const mask=tile.getContext('2d')!;
                mask.globalCompositeOperation='destination-in';mask.drawImage(shape,integerPencil?0:(work.complete?0:work.sourceX)-region.x,integerPencil?0:(work.complete?0:work.sourceY)-region.y);
                mask.globalCompositeOperation='source-in';mask.fillStyle=pigment;mask.fillRect(0,0,width,height);
                // Keep the native whole-image source-over path. Cropped
                // drawImage rounds repeated low-flow blends differently.
                output.save();try{
                  output.beginPath();output.rect(work.outputX,work.outputY,work.outputWidth,work.outputHeight);output.clip();
                  output.globalAlpha=alpha;output.drawImage(tile,work.x+region.x,work.y+region.y);
                }finally{output.restore();}
              }finally{if(shape)release(shape);}
              await checkpoint();
            }
          }finally{prepared.forEach(release);}
          revision++;
        }
        check();
        const context=target.getContext('2d')!;
        context.save();try{context.resetTransform();context.drawImage(stage,0,0);}finally{context.restore();}
        if(this.canvas)release(this.canvas);
        this.canvas=retain?stage:null;installed=retain;
        this.signature=retain?signature:'';this.points=retain?points:[];
        this.replay=Object.freeze({from,dabs,tiles,retained:retain});
      }finally{geometry.dispose();if(!installed)release(stage);}
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
