import {AffineTransform} from '../core/affine';
import {freeze} from '../core/immutable';
import {maskPlaneSchema,type MaskPlaneData,type MaskPlanePoseData} from '../core/mask-plane';
import {PerspectiveTransform} from './perspective';

export interface MaskPlanePose {width:number;height:number;perspective:PerspectiveTransform;transform:AffineTransform}
export interface MaskPlaneOptions {
 reference:{assetId:string}|{width:number;height:number};
 basis?:AffineTransform;
 pose:MaskPlanePose;
 phase?:'document'|'native';
 steps?:readonly {pose:MaskPlanePose;inverse?:boolean}[];
}
function poseData(pose:MaskPlanePose):MaskPlanePoseData {
 allowed(pose,['width','height','perspective','transform'],'mask pose');
 if(!pose||!(pose.perspective instanceof PerspectiveTransform)||!(pose.transform instanceof AffineTransform))throw new Error('Mask planes require PerspectiveTransform and AffineTransform pose values.');
 return{width:pose.width,height:pose.height,perspective:pose.perspective.toJSON(),transform:pose.transform.toJSON()};
}
function allowed(value:unknown,keys:readonly string[],label:string){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw new Error('Invalid '+label+' options.');}
function poseValue(pose:MaskPlanePoseData):MaskPlanePose{return{width:pose.width,height:pose.height,perspective:new PerspectiveTransform(pose.perspective),transform:AffineTransform.fromJSON(pose.transform)};}
/** Immutable native-grid provenance and placement; assigning a LayerMask value
 * remains the sole document mutation boundary. */
export class MaskPlane {
 private readonly data:MaskPlaneData;
 constructor(options:MaskPlaneOptions){
  allowed(options,['reference','basis','pose','phase','steps'],'mask plane');
  if(!options||!options.reference||options.basis!==undefined&&!(options.basis instanceof AffineTransform))throw new Error('Use a native mask reference and AffineTransform basis.');
  const ref=options.reference;
  allowed(ref,'assetId'in ref?['assetId']:['width','height'],'mask reference');
  if(options.steps!==undefined&&!Array.isArray(options.steps))throw new Error('Use a mask-plane step array.');
  this.data=freeze(maskPlaneSchema.parse({reference:'assetId'in ref?{kind:'asset',assetId:ref.assetId}:{kind:'pixels',width:ref.width,height:ref.height},basis:(options.basis??new AffineTransform()).toJSON(),pose:poseData(options.pose),phase:options.phase===undefined?'document':options.phase,steps:(options.steps??[]).map(step=>{allowed(step,['pose','inverse'],'mask-plane step');return{pose:poseData(step.pose),inverse:step.inverse===undefined?false:step.inverse};})}));
  Object.freeze(this);
 }
 get reference(){const ref=this.data.reference;return ref.kind==='asset'?{assetId:ref.assetId}:{width:ref.width,height:ref.height};}
 get basis(){return AffineTransform.fromJSON(this.data.basis);}
 get pose(){return poseValue(this.data.pose);}
 get phase(){return this.data.phase;}
 get steps(){return this.data.steps.map(step=>({pose:poseValue(step.pose),inverse:step.inverse}));}
 toJSON():MaskPlaneData{return structuredClone(this.data);}
 /** @internal */
 static _fromJSON(input:MaskPlaneData){const value=maskPlaneSchema.parse(input);return new MaskPlane({reference:value.reference.kind==='asset'?{assetId:value.reference.assetId}:{width:value.reference.width,height:value.reference.height},basis:AffineTransform.fromJSON(value.basis),pose:poseValue(value.pose),phase:value.phase,steps:value.steps.map(step=>({pose:poseValue(step.pose),inverse:step.inverse}))});}
}
