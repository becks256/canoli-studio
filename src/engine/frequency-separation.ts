import {Document,RasterLayer,LayerGroup,AffineTransform,LayerStyle} from '../dom';
import {AssetStore} from '../core/assets';
import {referencedAssets,isLocked,allLayers,id} from '../core/model';
import {layerTransform,localBounds} from '../core/spatial';
import {cropDocument} from '../core/crop';
import {isActiveWetPaint} from '../core/wet-operation';
import {frequencySeparationOptionsSchema,type FrequencySeparationOptions} from '../core/frequency-separation';
import type {EditorCommand} from '../core/commands';
import type {EditorApplication} from '../editor';
import type {Rect} from '../core/drawing';
import {exportPng} from './png';
import type {DocumentRenderer} from './renderer';
import {createCanvas,release} from './canvas';

export interface FrequencyPreviewOptions {
  sigma:number;
  /** Center in original image pixels, including any expanded wet-ink coordinates. */
  center?:{x:number;y:number};
}
export interface FrequencyPreviewFrame {
  original:HTMLCanvasElement;
  low:HTMLCanvasElement;
  high:HTMLCanvasElement;
  region:Rect;
  dispose():void;
}

/** Trusted private preparation. The full native capture is reused by previews and final publication. */
export class PreparedFrequencySeparation {
  private phase:'ready'|'committing'|'committed'|'disposed'='ready';
  constructor(
    private editor:EditorApplication,
    private document:Document,
    private assets:AssetStore,
    private view:AssetStore,
    private draft:Document,
    private source:RasterLayer,
    private snapshot:RasterLayer,
    private capturedId:string,
    private commands:EditorCommand[],
    private checkSource:()=>void,
    readonly bounds:Readonly<Rect>,
  ){}
  private check(signal?:AbortSignal){
    signal?.throwIfAborted();
    if(this.phase==='disposed')throw new Error('Frequency preparation was disposed.');
    this.checkSource();
  }
  private ready(){if(this.phase!=='ready')throw new Error('Frequency preparation is no longer available.');}
  async preview(options:FrequencyPreviewOptions,control:{signal?:AbortSignal}={}):Promise<FrequencyPreviewFrame>{
    this.ready();this.check(control.signal);
    const {sigma}=frequencySeparationOptionsSchema.parse({sigma:options.sigma});
    const center=options.center??{x:this.bounds.x+this.bounds.width/2,y:this.bounds.y+this.bounds.height/2};
    if(!center||![center.x,center.y].every(Number.isFinite))throw new Error('The preview center must contain finite native coordinates.');
    const width=Math.min(256,this.bounds.width),height=Math.min(192,this.bounds.height);
    const x=Math.max(0,Math.min(this.bounds.width-width,Math.round(center.x-this.bounds.x-width/2)));
    const y=Math.max(0,Math.min(this.bounds.height-height,Math.round(center.y-this.bounds.y-height/2)));
    const halo=Math.ceil(3*sigma),paddedWidth=width+2*halo,paddedHeight=height+2*halo;
    if(paddedWidth*paddedHeight>4_000_000||Math.max(paddedWidth,paddedHeight)>8192)
      throw new Error('This radius exceeds the native preview working-tile budget. Reduce the radius; original image dimensions remain intact.');
    const scratch=createCanvas(paddedWidth,paddedHeight,true),outputs:HTMLCanvasElement[]=[];
    try{
      const context=scratch.getContext('2d')!;
      context.drawImage(this.view.get(this.capturedId).bitmap,halo-x,halo-y);
      const pixels=context.getImageData(0,0,paddedWidth,paddedHeight).data;
      const low=await this.editor.renderer.processor.spatialFilter(pixels,paddedWidth,paddedHeight,{kind:'frequency-band',band:'low',sigmaX:sigma});
      this.ready();this.check(control.signal);
      const high=await this.editor.renderer.processor.encodeFrequencyBand(pixels,low,'high');
      this.ready();this.check(control.signal);
      for(const source of [pixels,low,high]){
        const canvas=createCanvas(width,height,true);outputs.push(canvas);
        const c=canvas.getContext('2d')!,image=c.createImageData(width,height);
        for(let row=0;row<height;row++){
          const start=((row+halo)*paddedWidth+halo)*4;
          image.data.set(source.subarray(start,start+width*4),row*width*4);
          if(source!==pixels)for(let column=0;column<width;column++)image.data[(row*width+column)*4+3]=pixels[start+column*4+3];
        }
        c.putImageData(image,0,0);
      }
      this.ready();this.check(control.signal);
      let disposed=false;
      return{original:outputs[0],low:outputs[1],high:outputs[2],region:{x:x+this.bounds.x,y:y+this.bounds.y,width,height},dispose(){if(!disposed){disposed=true;outputs.forEach(release);}}};
    }catch(error){outputs.forEach(release);throw error;}
    finally{release(scratch);}
  }
  async commit(options:FrequencySeparationOptions={},control:{signal?:AbortSignal}={}):Promise<LayerGroup>{
    const settings=frequencySeparationOptionsSchema.parse(options);
    this.ready();this.check(control.signal);this.phase='committing';
    try{
      const draft=Document.fromJSON(this.draft.toJSON()),commands=[...this.commands];
      draft.onCommand(command=>commands.push(structuredClone(command)));
      const group=draft.createFrequencySeparation(draft.getLayer(this.source.id) as RasterLayer,draft.getLayer(this.snapshot.id) as RasterLayer,settings);
      const frame=layerTransform(draft.toJSON(),group.id)!.bounds(localBounds(group.toJSON())!);
      const probe=await this.editor.renderer.render(draft.getSnapshot().document,this.view,{
        region:{x:Math.floor(frame.x),y:Math.floor(frame.y),width:Math.max(1,Math.min(256,Math.ceil(frame.width))),height:Math.max(1,Math.min(256,Math.ceil(frame.height)))},
        cache:false,readback:true,isCancelled:()=>{this.check(control.signal);return false;},
      });
      release(probe);this.check(control.signal);
      const capturedId=this.capturedId,installed=this.view.shareTo(this.assets,capturedId,capturedId);
      try{
        this.check(control.signal);
        this.document._dispatch({type:'transaction',label:'Create frequency separation',commands});
      }catch(error){
        if(this.assets.has(capturedId)&&this.assets.get(capturedId)===installed&&!referencedAssets(this.document.getSnapshot().document).has(capturedId))this.assets.remove(capturedId);
        throw error;
      }
      this.phase='committed';
      const result=this.document.getLayer(group.id) as LayerGroup;
      this.document.selectedLayer=this.document.getLayer(allLayers([group.toJSON()]).find(layer=>layer.kind==='smart-object')!.id);
      return result;
    }catch(error){try{this.check();this.phase='ready';}catch{this.dispose();}throw error;}
  }
  dispose(){if(this.phase!=='disposed'){this.phase='disposed';this.view.dispose();}}
}

/** Capture privately once. No host layers, history or output assets are published here. */
export async function prepareFrequencySeparation(editor:EditorApplication,layerId:string,control:{signal?:AbortSignal}={},checkSession:()=>void=()=>{}):Promise<PreparedFrequencySeparation>{
  const document=editor.document,assets=editor.assetStore,state=document.getSnapshot(),selection=document.selectedLayer?.id,lifetime=assets.captureLifetime();
  const pinned=[...referencedAssets(state.document)].map(id=>{const asset=assets.get(id);return{id,asset,bitmap:asset.bitmap,blob:asset.blob,width:asset.width,height:asset.height};});
  const check=()=>{
    control.signal?.throwIfAborted();checkSession();lifetime();
    for(const item of pinned){const asset=assets.get(item.id);if(asset!==item.asset||asset.bitmap!==item.bitmap||asset.blob!==item.blob||asset.width!==item.width||asset.height!==item.height||asset.bitmap.width!==item.width||asset.bitmap.height!==item.height)throw new Error('A source asset changed during frequency separation.');}
    if(editor.document!==document||editor.assetStore!==assets||document.getSnapshot().revision!==state.revision||document.selectedLayer?.id!==selection)throw new Error('The frequency-separation target changed. Review the source and retry.');
  };
  check();const source=document.getLayer(layerId);
  if(!(source instanceof RasterLayer)||isLocked(state.document,layerId))throw new Error('Select an unlocked raster image for frequency separation.');
  const native=assets.get(source.assetId),view=new AssetStore(),commands:EditorCommand[]=[];
  try{
    for(const assetId of referencedAssets(state.document))assets.shareTo(view,assetId,assetId);
    const draft=Document.fromJSON(state.document);draft.onCommand(command=>commands.push(structuredClone(command)));
    const original=draft.getLayer(layerId) as RasterLayer,working=original.duplicate() as RasterLayer;
    working.moveTo(draft);working.transform=new AffineTransform();working.width=native.width;working.height=native.height;
    working.opacity=1;working.fillOpacity=1;working.blendMode='normal';working.mask=null;working.styles=new LayerStyle();working.visible=true;working.clipped=false;
    const data=original.toJSON();if(data.kind!=='raster')throw new Error('Missing raster source.');
    const entries=data.erasures??[],nativeWet=entries.some(entry=>isActiveWetPaint(entry.stroke));
    working.update({erasures:nativeWet?entries:[]});working.resetAdjustments();
    const bounds=localBounds(working.toJSON())!,left=Math.floor(bounds.x),top=Math.floor(bounds.y),width=Math.ceil(bounds.x+bounds.width)-left,height=Math.ceil(bounds.y+bounds.height)-top;
    const isolated={...draft.toJSON(),children:[working.toJSON()],selection:null};cropDocument(isolated,{x:left,y:top,width,height});
    const guarded:DocumentRenderer={async render(data,store,options){check();const canvas=await editor.renderer.render(data,store,{...options,isCancelled:()=>{check();return false;}});try{check();return canvas;}catch(error){release(canvas);throw error;}},clearCache(){},dispose(){}};
    const blob=await exportPng(isolated,view,guarded,{signal:control.signal,onProgress:()=>check()});check();
    const capturedId=id();await view.add(blob,`${source.name.slice(0,200)} frequency snapshot`,capturedId,false);check();working.remove();
    const snapshot=draft.layers.add(new RasterLayer({name:'Native frequency snapshot',assetId:capturedId,width,height}));
    snapshot.transform=AffineTransform.scale(source.width/native.width,source.height/native.height).multiply(AffineTransform.translation(left,top));
    return new PreparedFrequencySeparation(editor,document,assets,view,draft,original,snapshot,capturedId,commands,check,Object.freeze({x:left,y:top,width,height}));
  }catch(error){view.dispose();throw error;}
}

export async function separateFrequencies(editor:EditorApplication,layerId:string,options:FrequencySeparationOptions={},control:{signal?:AbortSignal}={},checkSession:()=>void=()=>{}):Promise<LayerGroup>{
  frequencySeparationOptionsSchema.parse(options);
  const prepared=await prepareFrequencySeparation(editor,layerId,control,checkSession);
  try{return await prepared.commit(options,control);}finally{prepared.dispose();}
}
