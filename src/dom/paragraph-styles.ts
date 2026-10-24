import {z} from 'zod';
import type {Document,TextLayer} from './index';
import {TextLayer as TextLayerConstructor} from './index';
import {id} from '../core/model';
import {paragraphStyleSchema,paragraphFormatSchema,paragraphFormatPatchSchema,paragraphOverrideKeysSchema,PARAGRAPH_FORMAT_KEYS,DEFAULT_PARAGRAPH_FORMAT,type ParagraphFormat,type ParagraphStyleData} from '../core/paragraph-styles';

export class ParagraphStyle {
  readonly id:string;
  private owner?:Document;
  private initial:ParagraphStyleData;
  private initialBase?:ParagraphStyle;
  constructor(options:{name?:string;format?:Partial<ParagraphFormat>;basedOn?:ParagraphStyle|null}={}){
    const settings=z.object({name:z.string().optional(),format:paragraphFormatPatchSchema.optional(),basedOn:z.instanceof(ParagraphStyle).nullable().optional()}).strict().parse(options);
    this.id=id();
    const format=Object.fromEntries(Object.entries(settings.format??{}).filter(([,value])=>value!==undefined));
    const base=settings.basedOn??undefined;if(base&&!base.document)throw new Error('Use a base paragraph style attached to a document.');
    this.initialBase=base;
    this.initial=paragraphStyleSchema.parse({id:this.id,name:settings.name??'Paragraph style',format:{...(base?.format??DEFAULT_PARAGRAPH_FORMAT),...format},
      ...(base?{basedOn:{id:base.id,overrides:format}}:{})});
  }
  private data(){
    if(!this.owner)return this.initial;
    const value=this.owner._read().paragraphStyles?.find(style=>style.id===this.id);
    if(!value)throw new Error('Paragraph style is no longer attached to this document.');return value;
  }
  get document():Document|undefined{return this.owner;}
  get name(){return this.data().name;}
  set name(value:string){this.replace({...this.toJSON(),name:value});}
  get format():ParagraphFormat{return {...DEFAULT_PARAGRAPH_FORMAT,...paragraphFormatSchema.parse(structuredClone(this.data().format))};}
  get basedOn():ParagraphStyle|null{
    const binding=this.data().basedOn;if(!binding)return null;
    const base=this.owner?this.owner.paragraphStyles.getById(binding.id):this.initialBase;
    if(!base)throw new Error('Paragraph style base is missing.');return base;
  }
  set basedOn(base:ParagraphStyle|null){this.setBase(base);}
  get overrides():Partial<ParagraphFormat>{return structuredClone(this.data().basedOn?.overrides??{});}
  setBase(base:ParagraphStyle|null,options:{keepOverrides?:boolean}={}){
    const settings=z.object({keepOverrides:z.boolean().optional()}).strict().parse(options),value=this.toJSON();
    if(base===null){delete value.basedOn;this.replace(value);this.initialBase=undefined;return;}
    if(!(base instanceof ParagraphStyle)||!base.document||this.owner&&base.document!==this.owner)throw new Error('Use a base paragraph style attached to this document.');
    const overrides=settings.keepOverrides?(value.basedOn?.overrides??this.format):{};
    value.basedOn={id:base.id,overrides};value.format=paragraphFormatSchema.parse({...base.format,...overrides});
    this.replace(value);this.initialBase=base;
  }
  resetOverrides(keys?:(keyof ParagraphFormat)[]){
    const value=this.toJSON(),base=this.basedOn;if(!value.basedOn||!base)throw new Error('Choose a base paragraph style before resetting style overrides.');
    for(const key of keys===undefined?PARAGRAPH_FORMAT_KEYS:paragraphOverrideKeysSchema.parse(keys))delete value.basedOn.overrides[key];
    value.format=paragraphFormatSchema.parse({...base.format,...value.basedOn.overrides});this.replace(value);
  }
  toJSON():ParagraphStyleData{return structuredClone(this.data());}
  update(patch:Partial<ParagraphFormat>){
    const parsed=paragraphFormatPatchSchema.parse(patch),values=Object.fromEntries(Object.entries(parsed).filter(([,value])=>value!==undefined));
    const value=this.toJSON();
    if(value.basedOn){value.basedOn.overrides={...value.basedOn.overrides,...values};value.format=paragraphFormatSchema.parse({...this.basedOn!.format,...value.basedOn.overrides});}
    else value.format=paragraphFormatSchema.parse({...value.format,...values});this.replace(value);
  }
  captureFrom(text:TextLayer){
    if(!(text instanceof TextLayerConstructor))throw new Error('Expected a TextLayer constructor instance.');
    if(this.owner&&text.document!==this.owner)throw new Error('Capture text from this style\'s document.');
    const value=this.toJSON();value.format=text.paragraphFormat;if(value.basedOn)value.basedOn.overrides=structuredClone(value.format);this.replace(value);
  }
  private replace(value:ParagraphStyleData){
    const style=paragraphStyleSchema.parse(value);if(this.owner)this.owner._dispatch({type:'paragraphStyle.set',style});else this.initial=style;
  }
  remove(){if(!this.owner)throw new Error('Add the paragraph style to a document first.');this.data();this.owner._dispatch({type:'paragraphStyle.remove',id:this.id});}
  /** @internal */
  _add(document:Document){
    if(this.owner)throw new Error('Paragraph style is already attached.');const value=this.toJSON();
    if(value.basedOn){
      if(this.initialBase?.document!==document)throw new Error('Use a base paragraph style attached to this document.');
      value.format=paragraphFormatSchema.parse({...this.initialBase.format,...value.basedOn.overrides});
    }
    document._dispatch({type:'paragraphStyle.set',style:value});this.owner=document;
  }
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
