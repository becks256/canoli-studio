import {IccSession} from '../core/color/icc-client';
import {iccTarget} from '../core/color/profile-source';
import {colorProofKey,proofTransformSettings,type ColorProof} from '../core/color/color-settings';
import {checkRenderCurrent} from './render-control';

/** One viewport owner. Only a complete, current proof frame may be presented. */
export class IccProofProcessor {
 private session:IccSession|null=null;
 private key:string|null=null;
 private generation=0;
 private abort:AbortController|null=null;
 reset(){this.generation++;this.abort?.abort();this.abort=null;this.session?.dispose();this.session=null;this.key=null;}
 async apply(canvas:HTMLCanvasElement,proof:ColorProof,isCancelled?:()=>boolean):Promise<void>{
  checkRenderCurrent(isCancelled);
  const key=colorProofKey(proof);
  if(key!==this.key){
   this.reset();const generation=this.generation,abort=new AbortController();this.abort=abort;
   const {session}=await IccSession.prepare(iccTarget(proof.profile).source,proofTransformSettings(proof),{signal:abort.signal});
   if(generation!==this.generation||isCancelled?.()){session.dispose();throw new DOMException('Proof superseded.','AbortError');}
   this.session=session;this.key=key;
  }
  const session=this.session!,generation=this.generation;
  const current=()=>{checkRenderCurrent(isCancelled);if(this.generation!==generation)throw new DOMException('Proof superseded.','AbortError');};
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Proof canvas unavailable.');
  const rows=Math.max(1,Math.floor(4_000_000/Math.max(1,canvas.width*4)));
  try{for(let y=0;y<canvas.height;y+=rows){
   current();const height=Math.min(rows,canvas.height-y),pixels=ctx.getImageData(0,y,canvas.width,height);
   const converted=await session.apply(pixels.data);current();pixels.data.set(converted);ctx.putImageData(pixels,0,y);
  }current();}catch(error){this.reset();throw error;}
 }
}
