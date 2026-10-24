import {FontSourceStore,type FontSourceLease} from '../../fonts/store';
import type {FontResourceInput} from '../../fonts/resources';
import type {FontFileData} from '../../core/font-files';
import type {AssetStore} from '../../core/assets';
import type {RawImportControl} from '../../core/interchange/raw/types';

/** Parse/load privately, then register only around synchronous native planning.
 * No native font registration spans an await or user progress callback. */
export async function withRecipeFonts<T>(inputs:readonly FontResourceInput[],assets:AssetStore|undefined,files:readonly FontFileData[],control:RawImportControl,check:()=>void,run:(fonts:FontSourceStore)=>T):Promise<T>{
  const fonts=new FontSourceStore(),pins:FontSourceLease[]=[];
  const current=()=>{control.signal?.throwIfAborted();check();for(const pin of pins)pin.check();};
  try{
    current();for(const file of files){if(!assets)throw new Error('Recipe font source store is missing.');pins.push(assets.fonts.retain(file.id));assets.fonts.shareTo(fonts,file.id);}
    for(let index=0;index<inputs.length;index++){
      control.onProgress?.({phase:'inspecting',fraction:index/inputs.length});current();
      await fonts.restore(inputs[index],{signal:control.signal});current();
    }
    for(const source of fonts.values())fonts.activate(source.id);
    current();const result=run(fonts);
    if(result&&typeof(result as {then?:unknown}).then==='function')throw new Error('Native font planning must finish synchronously.');
    current();return result;
  }finally{fonts.dispose();for(const pin of pins)pin.release();}
}
