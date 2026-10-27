import {STANDARD_PROFILES}from './icc';
import type {StandardRgbSpaceId}from './types';
import {IccSession,type IccControl}from './icc-client';
import type {NativeIccReport}from './icc-types';

export const rgbProfileIds=Object.freeze(['srgb','display-p3','adobe-rgb','linear-srgb']as const);
const builtin=new Map(rgbProfileIds.map(id=>[id,Object.freeze({key:id,name:STANDARD_PROFILES[id].name,source:new Blob([new Uint8Array(STANDARD_PROFILES[id].iccBytes!)],{type:'application/vnd.iccprofile'})})]));
interface OwnedProfile{key:string;name:string;source:Blob;report:NativeIccReport}
const sources=new WeakMap<IccProfile,OwnedProfile>(),token=Symbol('owned ICC source');
/** Immutable trusted-host resource, outside the isolated document constructor API. */
export class IccProfile{
 private constructor(secret:symbol,value:OwnedProfile){if(secret!==token)throw new Error('Inspect an ICC file before using its profile.');sources.set(this,Object.freeze(value));Object.freeze(this);}
 static async inspect(source:Blob,name='ICC profile',control:IccControl={}):Promise<IccProfile>{
  control.signal?.throwIfAborted();if(!(source instanceof Blob))throw new Error('Choose an ICC profile file.');
  const owned=new Blob([source],{type:'application/vnd.iccprofile'}),report=await IccSession.inspect(owned,control);control.signal?.throwIfAborted();
  const bytes=await owned.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);control.signal?.throwIfAborted();
  const hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  return new IccProfile(token,{key:hash,name:(name.trim()||report.description||'ICC profile').slice(0,240),source:owned,report});
 }
 get name(){return ownedIccProfile(this).name;}
 get sha256(){return ownedIccProfile(this).key;}
 get source(){return ownedIccProfile(this).source;}
 get report(){return structuredClone(ownedIccProfile(this).report);}
}
export type IccTarget=StandardRgbSpaceId|IccProfile;
export function isIccProfile(value:unknown):value is IccProfile{return typeof value==='object'&&value!==null&&sources.has(value as IccProfile);}
function ownedIccProfile(profile:IccProfile):Readonly<OwnedProfile>{const value=sources.get(profile);if(!value)throw new Error('ICC profile is not an owned inspected resource.');return value;}
export function iccTarget(target:IccTarget):Readonly<{key:string;name:string;source:Blob;report?:NativeIccReport}>{
 if(typeof target==='string'){const value=builtin.get(target);if(!value)throw new Error('Unknown built-in ICC profile.');return value;}
 const value=ownedIccProfile(target);return Object.freeze({...value,report:structuredClone(value.report)});
}
