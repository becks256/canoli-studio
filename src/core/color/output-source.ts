import build from './codec/build.json' with {type:'json'};
import {IccProfile,iccTarget} from './profile-source';
import {IccSession,type IccControl} from './icc-client';
import {normalizeColorOutput,type ColorOutput} from './color-settings';
import {colorOutputSourceSchema,type ColorOutputSource,type ColorOutputReceipt} from './output-record';

export async function captureColorOutput(value:ColorOutput,control:IccControl={}):Promise<ColorOutputSource>{
 const settings=normalizeColorOutput(value),target=iccTarget(settings.profile);
 const profile=await IccProfile.inspect(target.source,target.name,control);
 const record:ColorOutputSource={version:1,profile:{name:profile.name,sha256:profile.sha256,source:profile.source},intent:settings.intent,blackPointCompensation:settings.blackPointCompensation};
 await prepareOwnedProfile(profile,record,control);
 return Object.freeze({...record,profile:Object.freeze(record.profile)});
}
/** Verify all bytes and compile the real transform before a batch can publish/run. */
export async function prepareColorOutputSource(input:ColorOutputSource,control:IccControl={}){
 const record=colorOutputSourceSchema.parse(input),profile=await IccProfile.inspect(record.profile.source,record.profile.name,control);
 if(profile.sha256!==record.profile.sha256)throw new Error('Delivery ICC source does not match its fingerprint. Restore the original profile.');
 return prepareOwnedProfile(profile,record,control);
}
const wasmSha256=build.artifacts['canoli_icc.wasm'].sha256;
async function prepareOwnedProfile(profile:IccProfile,record:ColorOutputSource,control:IccControl){
 const output=normalizeColorOutput({profile,intent:record.intent,blackPointCompensation:record.blackPointCompensation});
 const {session,prepared}=await IccSession.prepare(profile.source,{mode:'convert',intent:output.intent,blackPointCompensation:output.blackPointCompensation},control);
 try{
  control.signal?.throwIfAborted();
  const receipt:ColorOutputReceipt={version:1,engine:prepared.profile.engine,wasmSha256,sourceSpace:'srgb8',profileName:profile.name,profileSha256:profile.sha256,profileByteLength:profile.source.size,intent:output.intent,blackPointCompensation:output.blackPointCompensation,usesIntentFallback:prepared.usesIntentFallback,warnings:[...prepared.warnings]};
  return{output,receipt};
 }finally{session.dispose();}
}
