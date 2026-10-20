import type { AssetStore, ImageAsset } from '../core/assets';
import { brushTextureSourceSchema, textureSample, textureAffineSample, type BrushTextureSource, type TextureSample, type TextureAffineSample } from '../core/brush-texture';
import { CanvasCache } from './cache';
import { createCanvas, release } from './canvas';
import type { PixelProcessor } from './processor';

export interface TexturePreparationControl {
  signal?: AbortSignal;
  isCancelled?(): boolean;
}

/** Bounded, private mask tiles. Original bitmaps and source Blobs remain asset-owned. */
export class BrushTextureSampler {
  private readonly cache: CanvasCache;
  private identities = new WeakMap<ImageBitmap, number>();
  private sequence = 0;
  private generation = 0;
  private disposed = false;
  private opaque:HTMLCanvasElement|null=null;

  constructor(private readonly processor: Pick<PixelProcessor, 'brushTexture'>, budget = 32 * 1024 * 1024) {
    if (!Number.isSafeInteger(budget) || budget < 0)
      throw new Error('Texture cache budget must be a nonnegative safe integer.');
    this.cache = new CanvasCache(budget);
  }

  get byteLength() { return this.cache.byteLength; }

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
    const settings=brushTextureSourceSchema.parse(source),asset=assets.get(settings.assetId);
    const sample=textureAffineSample(asset,input),m=sample.sourceToOutput;
    const signature=JSON.stringify(['affine',settings.channel,settings.invert,sample.width,sample.height,
      m.a,m.b,m.c,m.d,m.e,m.f,sample.smoothing]);
    return this.prepareTile(assets,asset,settings,sample,signature,context=>{
      context.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);
      context.drawImage(asset.bitmap,0,0);
      context.resetTransform();
    },control,settings.channel==='alpha'&&settings.invert?()=>{
      const support=createCanvas(sample.width,sample.height,true);
      try{
        if(!this.opaque){this.opaque=createCanvas(1,1);this.opaque.getContext('2d')!.fillRect(0,0,1,1);}
        const c=support.getContext('2d')!;c.imageSmoothingEnabled=sample.smoothing;c.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);
        c.drawImage(this.opaque,0,0,asset.width,asset.height);
        return c.getImageData(0,0,sample.width,sample.height).data;
      }finally{release(support);}
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
  ):Promise<HTMLCanvasElement> {
    const bitmap=asset.bitmap;
    const lifetime = assets.captureLifetime(), generation = this.generation;
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
        return output;
      }
      const context = output.getContext('2d')!;
      context.imageSmoothingEnabled = sample.smoothing;
      draw(context);
      const captured = context.getImageData(0, 0, sample.width, sample.height);
      const pixels = await this.processor.brushTexture(captured.data, { channel: settings.channel, invert: settings.invert },support?.());
      check();
      if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== captured.data.length)
        throw new Error('The texture worker returned invalid coverage pixels.');
      captured.data.set(pixels);
      context.putImageData(captured, 0, 0);
      // A cache allocation failure must not discard an already prepared tile.
      try { this.cache.write(key, signature, output, 64); }
      catch { this.cache.clear(); }
      check();
      return output;
    } catch (error) {
      release(output);
      throw error;
    }
  }

  clear() {
    this.generation++;
    this.cache.clear();
    this.identities = new WeakMap();
    if(this.opaque)release(this.opaque);this.opaque=null;
  }

  dispose() {
    this.disposed = true;
    this.clear();
  }
}
