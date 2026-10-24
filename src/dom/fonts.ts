import type {Document} from './index';
import {documentFontUsage,fontFamilyRequestSchema} from '../core/font-management';
import {FontFile,FontFileCollection} from './font-file';
import {fontFileSchema} from '../core/font-files';
import {fontPrepareOptionsSchema,type FontSourceControl} from '../fonts/types';
import {z} from 'zod';

export const embedOptionsSchema=fontPrepareOptionsSchema.extend({name:fontFileSchema.shape.name.optional(),replace:fontFamilyRequestSchema.optional()}).strict();
export const relinkOptionsSchema=fontPrepareOptionsSchema.extend({name:fontFileSchema.shape.name.optional()}).strict();
export type FontEmbedOptions=z.input<typeof embedOptionsSchema>;
export type FontRelinkOptions=z.input<typeof relinkOptionsSchema>;
export interface FontEmbedControl extends FontSourceControl {beforeCommit?():void}

/** Font requests used by this document and all of its stored embedded scopes. */
export class DocumentFonts {
  readonly files:FontFileCollection;
  constructor(private readonly document:Document){this.files=new FontFileCollection(document);}
  get items(){return documentFontUsage(this.document._read());}
  replace(from:string,to:string):void{
    this.document._dispatch({type:'document.font.replace',from:fontFamilyRequestSchema.parse(from),to:fontFamilyRequestSchema.parse(to)});
  }
  /** Trusted host operation: parse privately, then bind in one ordinary edit. */
  async embed(source:Blob,options:FontEmbedOptions={},control:FontEmbedControl={}):Promise<FontFile>{
    return this.importSource(source,embedOptionsSchema.parse(options),control);
  }
  /** Replace every reference to an owned face and its declaration atomically. */
  async relink(file:FontFile,source:Blob,options:FontRelinkOptions={},control:FontEmbedControl={}):Promise<FontFile>{
    if(!(file instanceof FontFile)||file.document!==this.document)throw new Error('Relinking requires an attached font file from this document.');
    return this.importSource(source,relinkOptionsSchema.parse(options),control,file);
  }
  private async importSource(source:Blob,settings:FontEmbedOptions,control:FontEmbedControl,replacing?:FontFile):Promise<FontFile>{
    this.document._assertFontImportReady();
    const assets=this.document.assetStore,previous=replacing?.toJSON();
    if(!assets)throw new Error('Embedding a font requires an attached source store.');
    const revision=this.document.getSnapshot().revision,alive=assets.fonts.captureLifetime();
    control.signal?.throwIfAborted();
    const lease=await assets.fonts.stage(source,{faceIndex:settings.faceIndex},control),resource=lease.resource;
    try{
      control.beforeCommit?.();
      alive();control.signal?.throwIfAborted();
      lease.check();
      this.document._assertFontImportReady();
      if(this.document.assetStore!==assets)throw new Error('The document source store changed during font preparation.');
      if(this.document.getSnapshot().revision!==revision)throw new Error('The document changed during font preparation. Try again.');
      const face=resource.descriptor.report.faces[0],existing=this.files.getById(resource.id),name=settings.name??existing?.name??previous?.name??([face.fullName,face.family].find(value=>value?.trim())?.trim()||'Embedded font').slice(0,240);
      this.document.transaction(previous?'Relink font file':'Embed font file',()=>{
        const file=this.files.add(new FontFile({id:resource.id,name,resource:resource.descriptor}));
        if(previous&&settings.name!==undefined&&file.name!==settings.name)file.name=settings.name;
        if(previous&&previous.id!==resource.id)this.files.getById(previous.id)!.remove({replaceWith:file.family});
        else if(settings.replace!==undefined)this.replace(settings.replace,file.family);
      });
      return this.files.getById(resource.id)!;
    }finally{lease.release();}
  }
}
