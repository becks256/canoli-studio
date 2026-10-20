import {useEffect,useState} from 'react';
import {AssetStore} from '../../core/assets';
import {BrushTextureSampler} from '../../engine/brush-texture';
import type {PixelProcessor} from '../../engine/processor';
import type {BrushTextureSourceOwner,BrushTexturePreference} from '../../brushes/texture-source';

/** A bounded coverage proxy only. Original pixels remain with the source owner. */
export function useBrushTexturePreview(owner:BrushTextureSourceOwner,preference:BrushTexturePreference,processor:PixelProcessor){
  const source=owner.source,channel=preference?.channel,invert=preference?.invert;
  const [result,setResult]=useState<{source:typeof source;channel:typeof channel;invert:typeof invert;url:string|null;error:string|null}|null>(null);
  useEffect(()=>{
    if(!source||channel===undefined||invert===undefined||owner.source!==source)return;
    const assets=new AssetStore(),sampler=new BrushTextureSampler(processor,0),abort=new AbortController();
    try{
      const asset=owner.ensureIn(assets);
      void sampler.prepare(assets,{assetId:asset.id,channel,invert},{width:128,height:128},{signal:abort.signal}).then(canvas=>{
        try{if(!abort.signal.aborted)setResult({source,channel,invert,url:canvas.toDataURL('image/png'),error:null});}
        catch(cause){if(!abort.signal.aborted)setResult({source,channel,invert,url:null,error:String(cause instanceof Error?cause.message:cause)});}
        finally{canvas.width=canvas.height=0;}
      },cause=>{if(!abort.signal.aborted)setResult({source,channel,invert,url:null,error:String(cause instanceof Error?cause.message:cause)});});
    }catch(cause){setResult({source,channel,invert,url:null,error:String(cause instanceof Error?cause.message:cause)});}
    return()=>{abort.abort();sampler.dispose();assets.dispose();};
  },[owner,source,channel,invert,processor]);
  return result?.source===source&&result.channel===channel&&result.invert===invert&&preference?result:{url:null,error:null};
}
