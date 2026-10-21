import type { AssetStore, ImageAsset } from '../core/assets';
import { brushTextureSourceSchema, textureSample, textureAffineSample, type BrushTextureSource, type TextureSample, type TextureAffineSample } from '../core/brush-texture';
import { CanvasCache } from './cache';
import { createCanvas, release } from './canvas';
import type { PixelProcessor } from './processor';

export interface TexturePreparationControl {
  signal?: AbortSignal;
  isCancelled?(): boolean;
}
export interface TextureReadbackRegion { x:number; y:number; width:number; height:number; }
type TextureConverter=PixelProcessor['brushTexture'];

/** Bounded, private mask tiles. Original bitmaps and source Blobs remain asset-owned. */
export class BrushTextureSampler {
  private readonly cache: CanvasCache;
  private identities = new WeakMap<ImageBitmap, number>();
  private sequence = 0;
  private generation = 0;
  private cacheGeneration = 0;
  private disposed = false;
  private opaque:HTMLCanvasElement|null=null;
  private readonly maximums=new WeakMap<HTMLCanvasElement,number>();

  constructor(private readonly processor: Pick<PixelProcessor, 'brushTexture'>, budget = 32 * 1024 * 1024) {
    if (!Number.isSafeInteger(budget) || budget < 0)
      throw new Error('Texture cache budget must be a nonnegative safe integer.');
    this.cache = new CanvasCache(budget, true);
  }

  get byteLength() { return this.cache.byteLength; }
  /** Alpha ceiling of the prepared snapshot, before caller compositing. */
  preparedMaximum(canvas:HTMLCanvasElement){return this.maximums.get(canvas);}
  private rememberMaximum(canvas:HTMLCanvasElement,pixels:Uint8ClampedArray){
    let maximum=0;for(let i=3;i<pixels.length;i+=4){maximum=Math.max(maximum,pixels[i]);if(maximum===255)break;}
    this.maximums.set(canvas,maximum);
  }

  /** Returns a caller-owned surface. Release it after drawing, including error paths. */
  async prepare(
    assets: AssetStore,
    source: BrushTextureSource,
    input: TextureSample,
    control: TexturePreparationControl = {},
  ): Promise<HTMLCanvasElement> {
    const settings = brushTextureSourceSchema.parse(source);
    const asset = assets.get(settings.assetId), bitmap = asset.bitmap;
    const sample = textureSample(asset, input), { sourceRect: rect } = sample;
    const signature = JSON.stringify([settings.channel, settings.invert, sample.width, sample.height,
      rect.x, rect.y, rect.width, rect.height, sample.smoothing]);
    return this.prepareTile(assets, asset, settings, sample, signature, context => {
      context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, sample.width, sample.height);
    }, control);
  }

  /** No source-sized intermediate: project the original bitmap directly onto a bounded tile. */
  async prepareAffine(
    assets:AssetStore,
    source:BrushTextureSource,
    input:TextureAffineSample,
    control:TexturePreparationControl={},
  ):Promise<HTMLCanvasElement> {
    return this.prepareAffineUsing(assets,source,input,control,this.processor.brushTexture.bind(this.processor));
  }

  /** Pack independent samples into one bounded pixel conversion, preserving
   * their original native projection and byte conversion order. */
  async prepareAffineBatch(
    assets:AssetStore,
    source:BrushTextureSource,
    inputs:readonly TextureAffineSample[],
    control:TexturePreparationControl={},
    readbackRegions?:readonly TextureReadbackRegion[],
  ):Promise<HTMLCanvasElement[]> {
    if(inputs.length>64)throw new Error('Split texture conversion batches into at most 64 samples.');
    const settings=brushTextureSourceSchema.parse(source),asset=assets.get(settings.assetId),bitmap=asset.bitmap,lifetime=assets.captureLifetime();
    const samples=Array.from(inputs,input=>textureAffineSample(asset,input));
    if(readbackRegions&&readbackRegions.length!==samples.length)throw new Error('Each texture sample requires one readback region.');
    const regions=readbackRegions?Array.from(readbackRegions,(region,index)=>{
      if(!region)throw new Error('Texture readback regions must be integer rectangles inside their projection.');
      const {x,y,width,height}=region,sample=samples[index];
      if(![x,y,width,height].every(Number.isSafeInteger)||x<0||y<0||width<=0||height<=0||x+width>sample.width||y+height>sample.height)
        throw new Error('Texture readback regions must be integer rectangles inside their projection.');
      return{x,y,width,height};
    }):undefined;
    lifetime();
    if(!assets.has(settings.assetId)||assets.get(settings.assetId)!==asset||asset.bitmap!==bitmap||bitmap.width!==asset.width||bitmap.height!==asset.height)
      throw new Error('The texture source changed during batch preparation.');
    if(samples.reduce((sum,input)=>sum+input.width*input.height,0)>1_000_000)
      throw new Error('Split texture conversion batches into at most 1,000,000 working pixels.');
    const conversions:{args:Parameters<TextureConverter>;resolve:(pixels:Uint8ClampedArray)=>void;reject:(error:unknown)=>void}[]=[];
    const convert:TextureConverter=(...args)=>new Promise((resolve,reject)=>conversions.push({args,resolve,reject}));
    // Every preparation reaches its first conversion synchronously, before
    // this method yields. Attach rejection handlers before flushing the batch.
    // Projection dimensions and transforms stay unchanged: native affine edge
    // coverage can depend on the canvas bounds. Read only the needed bytes after
    // rasterization. Each capture owns its ImageData before the next sample
    // reuses this bounded pool, synchronously before conversion first yields.
    const projections=new Map<string,HTMLCanvasElement>();
    const projection=(width:number,height:number)=>{
      const key=`${width}:${height}`;let canvas=projections.get(key);
      if(!canvas){canvas=createCanvas(width,height,true);projections.set(key,canvas);}
      const context=canvas.getContext('2d')!;context.resetTransform();context.globalCompositeOperation='source-over';context.globalAlpha=1;context.clearRect(0,0,width,height);
      return context;
    };
    let pending:Promise<PromiseSettledResult<HTMLCanvasElement>[]>;
    try{pending=Promise.allSettled(samples.map((input,index)=>this.prepareAffineUsing(assets,settings,input,control,convert,regions?.[index],projection)));}
    finally{for(const canvas of projections.values())release(canvas);}
    if(conversions.length){
      try{
        control.signal?.throwIfAborted();
        if(control.isCancelled?.())throw new Error('Texture preparation was cancelled.');
        const length=conversions.reduce((sum,value)=>sum+value.args[0].length,0),pixels=new Uint8ClampedArray(length);
        const support=conversions.some(value=>value.args[2])?new Uint8ClampedArray(length):undefined;
        let offset=0;
        for(const value of conversions){pixels.set(value.args[0],offset);if(support&&value.args[2])support.set(value.args[2],offset);offset+=value.args[0].length;}
        const result=await this.processor.brushTexture(pixels,conversions[0].args[1],support);
        if(!(result instanceof Uint8ClampedArray)||result.length!==length)throw new Error('The texture worker returned invalid batched coverage pixels.');
        offset=0;for(const value of conversions){const end=offset+value.args[0].length;value.resolve(result.slice(offset,end));offset=end;}
      }catch(error){for(const value of conversions)value.reject(error);}
    }
    const results=await pending,failed=results.find(value=>value.status==='rejected');
    if(failed){for(const value of results)if(value.status==='fulfilled')release(value.value);throw failed.reason;}
    return results.map(value=>(value as PromiseFulfilledResult<HTMLCanvasElement>).value);
  }

  private async prepareAffineUsing(
    assets:AssetStore,
    source:BrushTextureSource,
    input:TextureAffineSample,
    control:TexturePreparationControl,
    convert:TextureConverter,
    region?:TextureReadbackRegion,
    projection?:(width:number,height:number)=>CanvasRenderingContext2D,
  ):Promise<HTMLCanvasElement> {
    const settings=brushTextureSourceSchema.parse(source),asset=assets.get(settings.assetId);
    const sample=textureAffineSample(asset,input),m=sample.sourceToOutput;
    const signature=JSON.stringify(['affine',settings.channel,settings.invert,sample.width,sample.height,
      m.a,m.b,m.c,m.d,m.e,m.f,sample.smoothing,region]);
    const draw=(context:CanvasRenderingContext2D)=>{
      context.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);
      context.drawImage(asset.bitmap,0,0);
      context.resetTransform();
    };
    return this.prepareTile(assets,asset,settings,region?{...sample,width:region.width,height:region.height}:sample,signature,draw,control,settings.channel==='alpha'&&settings.invert?()=>{
      const support=region?undefined:createCanvas(sample.width,sample.height,true);
      try{
        if(!this.opaque){this.opaque=createCanvas(1,1);this.opaque.getContext('2d')!.fillRect(0,0,1,1);}
        const c=region?projection!(sample.width,sample.height):support!.getContext('2d')!;c.imageSmoothingEnabled=sample.smoothing;c.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);
        c.drawImage(this.opaque,0,0,asset.width,asset.height);
        return c.getImageData(region?.x??0,region?.y??0,region?.width??sample.width,region?.height??sample.height).data;
      }finally{if(support)release(support);}
    }:undefined,convert,region?()=>{
      const context=projection!(sample.width,sample.height);context.imageSmoothingEnabled=sample.smoothing;draw(context);
      return context.getImageData(region.x,region.y,region.width,region.height);
    }:undefined);
  }

  private async prepareTile(
    assets:AssetStore,
    asset:ImageAsset,
    settings:ReturnType<typeof brushTextureSourceSchema.parse>,
    sample:{width:number;height:number;smoothing:boolean},
    signature:string,
    draw:(context:CanvasRenderingContext2D)=>void,
    control:TexturePreparationControl,
    support?:()=>Uint8ClampedArray,
    convert:TextureConverter=this.processor.brushTexture.bind(this.processor),
    capture?:()=>ImageData,
  ):Promise<HTMLCanvasElement> {
    const bitmap=asset.bitmap;
    const lifetime = assets.captureLifetime(), generation = this.generation, cacheGeneration = this.cacheGeneration;
    const check = () => {
      control.signal?.throwIfAborted();
      if (control.isCancelled?.()) throw new Error('Texture preparation was cancelled.');
      if (this.disposed || this.generation !== generation)
        throw new Error('Texture preparation was cleared or disposed.');
      lifetime();
      if (!assets.has(settings.assetId) || assets.get(settings.assetId) !== asset || asset.bitmap !== bitmap ||
          bitmap.width !== asset.width || bitmap.height !== asset.height || !bitmap.width || !bitmap.height)
        throw new Error('The texture source changed during preparation.');
    };
    check();
    let identity = this.identities.get(bitmap);
    if (identity === undefined) this.identities.set(bitmap, identity = ++this.sequence);
    const key = `brush-texture:${identity}`;
    const output = createCanvas(sample.width, sample.height, true);
    try {
      if (this.cache.read(key, signature, output)) {
        check();
        this.rememberMaximum(output,output.getContext('2d')!.getImageData(0,0,sample.width,sample.height).data);
        check();
        return output;
      }
      const context = output.getContext('2d')!;
      context.imageSmoothingEnabled = sample.smoothing;
      if(!capture)draw(context);
      const captured = capture?capture():context.getImageData(0, 0, sample.width, sample.height);
      const pixels = await convert(captured.data, { channel: settings.channel, invert: settings.invert },support?.());
      check();
      if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== captured.data.length)
        throw new Error('The texture worker returned invalid coverage pixels.');
      captured.data.set(pixels);
      this.rememberMaximum(output,captured.data);
      context.putImageData(captured, 0, 0);
      // A cache allocation failure must not discard an already prepared tile.
      if (cacheGeneration === this.cacheGeneration) {
        try { this.cache.write(key, signature, output, 64); }
        catch { this.cache.clear(); }
      }
      check();
      return output;
    } catch (error) {
      release(output);
      throw error;
    }
  }

  /** Retire cached pixels without cancelling independently owned reads. */
  retireCache() {
    this.cacheGeneration++;
    this.cache.clear();
    this.identities = new WeakMap();
    if(this.opaque)release(this.opaque);this.opaque=null;
  }

  clear() {
    this.generation++;
    this.retireCache();
  }

  dispose() {
    this.disposed = true;
    this.clear();
  }
}
