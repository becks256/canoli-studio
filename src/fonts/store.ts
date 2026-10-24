import {fontPrepareOptionsSchema,type FontPrepareOptions,type FontPreparedBytes,type FontSourceControl} from './types';
import {describePreparedFont,ownFontResource,sameFontResource,type FontResource,type FontResourceInput} from './resources';
import {nativeFontsChanged} from './native-events';

/** Trusted parser adapter. A browser adapter returns privately owned loaded
 * faces; headless adapters return bytes only and never fabricate native faces. */
export type FontResourcePreparer=(source:Blob,options:FontPrepareOptions,control:FontSourceControl)=>Promise<FontPreparedBytes&{readonly fontFaces?:readonly FontFace[]}>;
interface NativeSet {add(face:FontFace):void;delete(face:FontFace):boolean;has(face:FontFace):boolean}
interface Entry {resource:Readonly<FontResource>;faces:readonly FontFace[];state:readonly string[];active:boolean}
interface Registration {descriptor:FontResource['descriptor'];faces:readonly FontFace[];state:readonly string[];owners:number}
const registrations=new WeakMap<object,Map<string,Registration>>();
const nativeState=(face:FontFace)=>JSON.stringify(['family','style','weight','stretch','unicodeRange','status','featureSettings','variationSettings','ascentOverride','descentOverride','lineGapOverride','display','sizeAdjust'].map(key=>(face as unknown as Record<string,unknown>)[key]));
const checkRegistration=(set:NativeSet,value:Registration)=>{if(value.faces.some((face,index)=>face.status!=='loaded'||!set.has(face)||nativeState(face)!==value.state[index]))throw new Error('An owned native font registration changed.');};
const defaultSet=():NativeSet|null=>globalThis.document?.fonts??(globalThis as typeof globalThis&{fonts?:FontFaceSet}).fonts??null;
const browserPrepare:FontResourcePreparer=async(source,options,control)=>{
  if(typeof Worker==='undefined'||typeof FontFace==='undefined')throw new Error('Font resources require a configured parser host.');
  return(await import('./client')).prepareFontFile(source,options,control);
};

/** Owns font bytes independently of image assets. Installed records remain
 * inert until activate(); one global native registration is leased by each
 * active store, so closing one document cannot remove another owner's font. */
export class FontSourceStore {
  private entries=new Map<string,Entry>();
  private jobs=new Set<AbortController>();
  private originals=new Map<string,{blob:Blob;owners:number}>();
  private disposed=false;
  private generation=0;
  private readonly nativeSet:NativeSet|null;
  private readonly prepareSource:FontResourcePreparer;
  constructor(options:{nativeSet?:NativeSet|null;prepare?:FontResourcePreparer}={}){
    this.nativeSet=options.nativeSet===undefined?defaultSet():options.nativeSet;this.prepareSource=options.prepare??browserPrepare;
  }
  captureLifetime(){if(this.disposed)throw new Error('The font source store is disposed.');const generation=this.generation;return()=>{if(this.disposed||this.generation!==generation)throw new Error('The font source store was disposed during the operation.');};}
  get(id:string):Readonly<FontResource>{this.captureLifetime();const entry=this.entries.get(id);if(!entry)throw new Error(`Missing font source: ${id}`);return entry.resource;}
  has(id:string){return!this.disposed&&this.entries.has(id);}
  get size(){return this.entries.size;}
  values(){this.captureLifetime();return[...this.entries.values()].map(entry=>entry.resource);}
  get nativeAvailable(){return this.nativeSet!==null;}
  isActive(id:string){return this.entries.get(id)?.active??false;}
  capture(id:string){const alive=this.captureLifetime(),resource=this.get(id);return()=>{alive();if(this.entries.get(id)?.resource!==resource)throw new Error('An owned font source changed.');const entry=this.entries.get(id)!;if(entry.active&&this.nativeSet){const registration=registrations.get(this.nativeSet)?.get(id);if(!registration)throw new Error('An owned font registration is missing.');checkRegistration(this.nativeSet,registration);}};}

  prepare(source:Blob,options:FontPrepareOptions={},control:FontSourceControl={}):Promise<Readonly<FontResource>>{
    return this.operation(control,checked=>this.prepareOwned(source,options,checked));
  }
  private async prepareOwned(source:Blob,options:FontPrepareOptions,control:FontSourceControl):Promise<Readonly<FontResource>>{
    const settings=fontPrepareOptionsSchema.parse(options),alive=this.captureLifetime(),check=()=>{alive();control.signal?.throwIfAborted();};check();
    const prepared=await this.prepareSource(source,settings,control);check();
    const resource=await ownFontResource({descriptor:describePreparedFont(prepared),original:source,renderBlob:prepared.renderBlob},check);check();
    return this.install(resource,prepared.fontFaces??[],check);
  }
  restore(input:FontResourceInput,control:FontSourceControl={}):Promise<Readonly<FontResource>>{
    return this.operation(control,checked=>this.restoreOwned(input,checked));
  }
  private async restoreOwned(input:FontResourceInput,control:FontSourceControl):Promise<Readonly<FontResource>>{
    const alive=this.captureLifetime(),check=()=>{alive();control.signal?.throwIfAborted();};check();
    const source=await ownFontResource(input,check);check();
    const prepared=await this.prepareSource(source.original,{faceIndex:source.descriptor.report.faces[0].index},control);check();
    if(!sameFontResource(describePreparedFont(prepared),source.descriptor))throw new Error('Stored font declarations or native bytes differ from their original selected face.');
    return this.install(source,prepared.fontFaces??[],check);
  }
  private install(resource:Readonly<FontResource>,faces:readonly FontFace[],check:()=>void){
    check();const existing=this.entries.get(resource.id);
    if(existing){if(!sameFontResource(existing.resource.descriptor,resource.descriptor))throw new Error('Font resource identity collision.');this.capture(resource.id)();return existing.resource;}
    if(this.nativeSet&&(faces.length!==resource.descriptor.report.faces[0].descriptors.length||faces.some(face=>face.status!=='loaded'||face.family!==resource.cssFamily)))throw new Error('Font resources require loaded native faces on this host.');
    if(!this.nativeSet&&faces.length)throw new Error('Headless font resources cannot adopt browser faces.');
    const hash=resource.descriptor.report.sha256,original=this.originals.get(hash);
    if(original&&original.blob.size!==resource.original.size)throw new Error('Original font identity collision.');
    const owned=original?Object.freeze({...resource,original:original.blob}):resource;
    if(original)original.owners++;else this.originals.set(hash,{blob:resource.original,owners:1});
    this.entries.set(resource.id,{resource:owned,faces:Object.freeze([...faces]),state:faces.map(nativeState),active:false});return owned;
  }
  activate(id:string):void{
    this.captureLifetime();const entry=this.entries.get(id);if(!entry)throw new Error(`Missing font source: ${id}`);if(entry.active){this.capture(id)();return;}
    if(this.nativeSet){
      let registry=registrations.get(this.nativeSet);if(!registry){registry=new Map();registrations.set(this.nativeSet,registry);}
      const current=registry.get(id);
      if(current){if(!sameFontResource(current.descriptor,entry.resource.descriptor))throw new Error('Native font identity collision.');checkRegistration(this.nativeSet,current);current.owners++;entry.faces=current.faces;}
      else{
        const added:FontFace[]=[];
        try{for(const [index,face]of entry.faces.entries()){if(face.status!=='loaded'||nativeState(face)!==entry.state[index])throw new Error('The native font is no longer ready or changed after preparation.');this.nativeSet.add(face);added.push(face);}}
        catch(error){for(const face of added)this.nativeSet.delete(face);throw error;}
        registry.set(id,{descriptor:entry.resource.descriptor,faces:entry.faces,state:entry.faces.map(nativeState),owners:1});
        nativeFontsChanged(this.nativeSet);
      }
    }
    entry.active=true;
  }
  deactivate(id:string):void{
    const entry=this.entries.get(id);if(!entry?.active)return;entry.active=false;
    if(this.nativeSet){const registry=registrations.get(this.nativeSet),value=registry?.get(id);if(value&&--value.owners===0){registry!.delete(id);for(const face of value.faces)this.nativeSet.delete(face);nativeFontsChanged(this.nativeSet);}}
  }
  shareTo(destination:FontSourceStore,id:string):Readonly<FontResource>{
    const check=this.capture(id),alive=destination.captureLifetime();check();alive();
    if(destination===this)return this.get(id);
    if(this.nativeSet!==destination.nativeSet)throw new Error('Font sources require reparsing when transferred to a different native host.');
    const entry=this.entries.get(id)!,resource=destination.install(entry.resource,entry.faces,()=>{check();alive();});return resource;
  }
  remove(id:string):void{
    const entry=this.entries.get(id);if(!entry)return;this.deactivate(id);this.entries.delete(id);
    const hash=entry.resource.descriptor.report.sha256,original=this.originals.get(hash);if(original&&--original.owners===0)this.originals.delete(hash);
  }
  private async operation<T>(control:FontSourceControl,run:(control:FontSourceControl)=>Promise<T>):Promise<T>{
    this.captureLifetime();control.signal?.throwIfAborted();const abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);this.jobs.add(abort);control.signal?.addEventListener('abort',cancel,{once:true});
    let onAbort:()=>void=()=>{};
    try{
      const cancelled=new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(abort.signal.reason);abort.signal.addEventListener('abort',onAbort,{once:true});});
      return await Promise.race([run({...control,signal:abort.signal}),cancelled]);
    }finally{abort.signal.removeEventListener('abort',onAbort);control.signal?.removeEventListener('abort',cancel);this.jobs.delete(abort);}
  }
  dispose():void{if(this.disposed)return;this.disposed=true;this.generation++;for(const job of this.jobs)job.abort(new Error('The font source store was disposed during preparation.'));this.jobs.clear();for(const id of this.entries.keys())this.remove(id);this.originals.clear();}
}
