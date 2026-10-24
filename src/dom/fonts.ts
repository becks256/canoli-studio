import type {Document} from './index';
import {documentFontUsage,fontFamilyRequestSchema} from '../core/font-management';
import {FontFile,FontFileCollection} from './font-file';
import {fontFileSchema} from '../core/font-files';
import {captureRetainedHistory,retainedDocuments} from '../core/history';
import {referencedFontFiles} from '../core/font-files';
import {fontPrepareOptionsSchema,type FontSourceControl} from '../fonts/types';
import {z} from 'zod';

export const embedOptionsSchema=fontPrepareOptionsSchema.extend({name:fontFileSchema.shape.name.optional(),replace:fontFamilyRequestSchema.optional()}).strict();
export type FontEmbedOptions=z.input<typeof embedOptionsSchema>;
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
    this.document._assertFontImportReady();
    const settings=embedOptionsSchema.parse(options),assets=this.document.assetStore;
    if(!assets)throw new Error('Embedding a font requires an attached source store.');
    const revision=this.document.getSnapshot().revision,alive=assets.fonts.captureLifetime();
    control.signal?.throwIfAborted();
    const resource=await assets.fonts.prepare(source,{faceIndex:settings.faceIndex},control);
    try{
      control.beforeCommit?.();
      alive();control.signal?.throwIfAborted();
      this.document._assertFontImportReady();
      if(this.document.assetStore!==assets)throw new Error('The document source store changed during font preparation.');
      if(this.document.getSnapshot().revision!==revision)throw new Error('The document changed during font preparation. Try again.');
      const face=resource.descriptor.report.faces[0],name=settings.name??(face.fullName||face.family||'Embedded font').slice(0,240);
      this.document.transaction('Embed font file',()=>{
        const file=this.files.add(new FontFile({id:resource.id,name,resource:resource.descriptor}));
        if(settings.replace!==undefined)this.replace(settings.replace,file.family);
      });
      return this.files.getById(resource.id)!;
    }catch(error){
      // Accepted observer failures retain the source for current and historical
      // states. Unaccepted imports remain inert in the store until disposal,
      // avoiding invalidation of another concurrent importer of the same face.
      const state=this.document.getSnapshot(),required=retainedDocuments(state.document,captureRetainedHistory(state)).some(value=>referencedFontFiles(value).has(resource.id));
      if(!required)assets.fonts.deactivate(resource.id);
      throw error;
    }
  }
}
