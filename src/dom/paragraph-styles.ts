import {z} from 'zod';
import type {Document,TextLayer} from './index';
import {TextLayer as TextLayerConstructor} from './index';
import {id} from '../core/model';
import {paragraphStyleSchema,paragraphFormatSchema,paragraphFormatPatchSchema,DEFAULT_PARAGRAPH_FORMAT,type ParagraphFormat,type ParagraphStyleData} from '../core/paragraph-styles';

export class ParagraphStyle {
  readonly id:string;
  private owner?:Document;
  private initial:ParagraphStyleData;
  constructor(options:{name?:string;format?:Partial<ParagraphFormat>}={}){
    const settings=z.object({name:z.string().optional(),format:paragraphFormatPatchSchema.optional()}).strict().parse(options);
    this.id=id();
    const format=Object.fromEntries(Object.entries(settings.format??{}).filter(([,value])=>value!==undefined));
    this.initial=paragraphStyleSchema.parse({id:this.id,name:settings.name??'Paragraph style',format:{...DEFAULT_PARAGRAPH_FORMAT,...format}});
  }
  private data(){
    if(!this.owner)return this.initial;
    const value=this.owner._read().paragraphStyles?.find(style=>style.id===this.id);
    if(!value)throw new Error('Paragraph style is no longer attached to this document.');return value;
  }
  get document():Document|undefined{return this.owner;}
  get name(){return this.data().name;}
  set name(value:string){this.replace({...this.toJSON(),name:value});}
  get format():ParagraphFormat{return structuredClone(this.data().format);}
  toJSON():ParagraphStyleData{return structuredClone(this.data());}
  update(patch:Partial<ParagraphFormat>){
    const parsed=paragraphFormatPatchSchema.parse(patch),values=Object.fromEntries(Object.entries(parsed).filter(([,value])=>value!==undefined));
    this.replace({...this.toJSON(),format:paragraphFormatSchema.parse({...this.data().format,...values})});
  }
  captureFrom(text:TextLayer){
    if(!(text instanceof TextLayerConstructor))throw new Error('Expected a TextLayer constructor instance.');
    if(this.owner&&text.document!==this.owner)throw new Error('Capture text from this style\'s document.');
    this.replace({...this.toJSON(),format:text.paragraphFormat});
  }
  private replace(value:ParagraphStyleData){
    const style=paragraphStyleSchema.parse(value);if(this.owner)this.owner._dispatch({type:'paragraphStyle.set',style});else this.initial=style;
  }
  remove(){if(!this.owner)throw new Error('Add the paragraph style to a document first.');this.data();this.owner._dispatch({type:'paragraphStyle.remove',id:this.id});}
  /** @internal */
  _add(document:Document){if(this.owner)throw new Error('Paragraph style is already attached.');document._dispatch({type:'paragraphStyle.set',style:this.toJSON()});this.owner=document;}
  /** @internal */
  static _attached(document:Document,data:ParagraphStyleData){const style=new ParagraphStyle({name:data.name,format:data.format});Object.defineProperty(style,'id',{value:data.id});style.owner=document;return style;}
}
export class ParagraphStyleCollection implements Iterable<ParagraphStyle>{
  constructor(private readonly document:Document){}
  get items(){return(this.document._read().paragraphStyles??[]).map(data=>ParagraphStyle._attached(this.document,data));}
  get length(){return(this.document._read().paragraphStyles??[]).length;}
  at(index:number){return this.items.at(index);}
  getById(id:string){const data=this.document._read().paragraphStyles?.find(style=>style.id===id);return data?ParagraphStyle._attached(this.document,data):undefined;}
  [Symbol.iterator](){return this.items[Symbol.iterator]();}
  add(style:ParagraphStyle){if(!(style instanceof ParagraphStyle))throw new Error('Expected a ParagraphStyle constructor instance.');style._add(this.document);return style;}
}
