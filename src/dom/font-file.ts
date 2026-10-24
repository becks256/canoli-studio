import type {Document} from './index';
import {fontFileSchema,documentFontFiles,type FontFileData} from '../core/font-files';
import {fontFamilyRequestSchema} from '../core/font-management';
import {z} from 'zod';

export const fontFileRemoveOptionsSchema=z.object({replaceWith:fontFamilyRequestSchema.optional()}).strict();
export type FontFileRemoveOptions=z.input<typeof fontFileRemoveOptionsSchema>;

/** A document declaration backed by a separately owned font source. */
export class FontFile {
  private owner:Document|null=null;
  private data:FontFileData;
  constructor(options:FontFileData){this.data=fontFileSchema.parse(options);}
  get id(){return this.data.id;}
  get isAttached(){return this.owner?.fonts.files._data(this.id)!==undefined&&this.owner!==null;}
  get document(){return this.isAttached?this.owner:null;}
  private read(){if(!this.owner)return this.data;const value=this.owner.fonts.files._data(this.id);if(!value)throw new Error('The font file is no longer attached to this document.');return value;}
  get name(){return this.read().name;}
  set name(value:string){const name=fontFileSchema.shape.name.parse(value);if(this.owner){this.read();this.owner._dispatch({type:'font.file.rename',id:this.id,name});}else this.data={...this.data,name};}
  /** Stable native family alias; declared names remain source metadata. */
  get family(){return this.read().resource.report.faces[0].cssFamily;}
  get resource(){return structuredClone(this.read().resource);}
  toJSON():FontFileData{return structuredClone(this.read());}
  remove(options:FontFileRemoveOptions={}):void{if(!this.owner||!this.isAttached)throw new Error('Removing a font requires an attached font file.');this.owner.fonts.files.remove(this,options);}
  /** @internal */ _attach(document:Document){this.owner=document;}
}

export class FontFileCollection {
  private handles=new Map<string,FontFile>();
  constructor(private readonly document:Document){}
  /** @internal */ _data(id:string){return documentFontFiles(this.document._read()).find(value=>value.id===id);}
  get items(){return documentFontFiles(this.document._read()).map(value=>this.getById(value.id)!);}
  get length(){return documentFontFiles(this.document._read()).length;}
  getById(id:string):FontFile|null{const value=this._data(id);if(!value)return null;let handle=this.handles.get(id);if(!handle){handle=new FontFile(value);handle._attach(this.document);this.handles.set(id,handle);}return handle;}
  add(file:FontFile):FontFile{
    if(!(file instanceof FontFile))throw new Error('Use a FontFile constructor.');
    if(file.document&&file.document!==this.document)throw new Error('Copy this font source into the destination document before attaching it.');
    this.document._dispatch({type:'font.file.add',file:file.toJSON()});return this.getById(file.id)!;
  }
  remove(file:FontFile,options:FontFileRemoveOptions={}):void{
    if(!(file instanceof FontFile)||file.document!==this.document)throw new Error('Font file belongs to another document or is detached.');
    this.document._dispatch({type:'font.file.remove',id:file.id,...fontFileRemoveOptionsSchema.parse(options)});
  }
  [Symbol.iterator](){return this.items[Symbol.iterator]();}
}
