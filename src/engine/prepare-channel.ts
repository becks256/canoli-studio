import type { ChannelCoverageRequest, ChannelLoadControl } from '../core/alpha-channels';
import { selectionSchema, type SelectionData } from '../core/drawing';
import { PixelProcessor } from './processor';

/** Private worker ownership makes cancellation terminate active native work. */
export async function prepareChannelSelection(request:ChannelCoverageRequest,control:ChannelLoadControl={},check:()=>void=()=>{}):Promise<SelectionData>{
  check();control.signal?.throwIfAborted();const processor=new PixelProcessor();
  const cancel=()=>processor.dispose();control.signal?.addEventListener('abort',cancel,{once:true});
  try{
    const result=await processor.channelSelection(request,progress=>{
      try{check();control.signal?.throwIfAborted();control.onProgress?.(progress);}catch{processor.dispose();}
    });
    check();control.signal?.throwIfAborted();return selectionSchema.parse(result);
  }catch(error){check();control.signal?.throwIfAborted();throw error;}
  finally{control.signal?.removeEventListener('abort',cancel);processor.dispose();}
}
