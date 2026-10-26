import {writingModeSchema,textOrientationSchema,assertTextWritingVersion} from './text-writing';
import {fontVariantCapsSchema,fontStretchSchema,fontVariationSettingsSchema,assertFontFeaturesVersion} from './font-features';
import {z} from 'zod';
import type {DocumentData,LayerData,TextLayerData} from './model';

/** Geometry/text/width belong to each frame; this format is reusable across frames. */
const paragraphFormatInputSchema=z.object({
  writingMode:writingModeSchema.optional(),textOrientation:textOrientationSchema.optional(),
  fontSize:z.number().finite().min(1).max(Number.MAX_SAFE_INTEGER),
  fontFamily:z.string().min(1).max(240),color:z.string().min(1).max(240),
  align:z.enum(['left','center','right']),lineHeight:z.number().finite().min(.5).max(10),
  letterSpacing:z.number().finite().min(-50).max(500),wordSpacing:z.number().finite().min(-50).max(500),
  fontVariantCaps:fontVariantCapsSchema.optional(),fontStretch:fontStretchSchema.optional(),fontVariationSettings:fontVariationSettingsSchema.optional(),
  fontKerning:z.enum(['auto','normal','none']),fontWeight:z.string().min(1).max(240),fontStyle:z.enum(['normal','italic']),
  direction:z.enum(['ltr','rtl']),paragraphJustify:z.enum(['none','inter-word']),
  paragraphSpacing:z.number().finite().min(0).max(10000),firstLineIndent:z.number().finite().min(-10000).max(10000),
}).strict();
export const paragraphFormatSchema=paragraphFormatInputSchema;
export type ParagraphFormat=z.infer<typeof paragraphFormatSchema>;
export const paragraphFormatPatchSchema=paragraphFormatInputSchema.partial().strict();
export const paragraphOverrideKeysSchema=z.array(paragraphFormatInputSchema.keyof()).max(Object.keys(paragraphFormatInputSchema.shape).length).refine(keys=>new Set(keys).size===keys.length,'Override keys must be unique.');
export const PARAGRAPH_FORMAT_KEYS=Object.keys(paragraphFormatInputSchema.shape) as (keyof ParagraphFormat)[];
export const DEFAULT_PARAGRAPH_FORMAT:Readonly<ParagraphFormat>=Object.freeze({
  writingMode:'horizontal-tb',textOrientation:'mixed',
  fontSize:32,fontFamily:'sans-serif',color:'#ffffff',align:'left',lineHeight:1.2,letterSpacing:0,wordSpacing:0,
  fontVariantCaps:'normal',fontStretch:'normal',fontVariationSettings:'normal',fontKerning:'auto',fontWeight:'normal',fontStyle:'normal',direction:'ltr',paragraphJustify:'none',paragraphSpacing:0,firstLineIndent:0,
});
export const paragraphStyleBindingSchema=z.object({id:z.string().min(1).max(240),overrides:paragraphFormatPatchSchema}).strict();
export const paragraphStyleSchema=z.object({id:z.string().min(1).max(240),name:z.string().trim().min(1).max(80),format:paragraphFormatSchema,basedOn:paragraphStyleBindingSchema.nullable().optional()}).strict();
export const paragraphStyleLibrarySchema=z.array(paragraphStyleSchema).max(128).superRefine((items,context)=>{
  const ids=new Set<string>(),names=new Set<string>();
  for(const item of items){const name=item.name.toLocaleLowerCase('en');if(ids.has(item.id)||names.has(name))context.addIssue({code:'custom',message:'Paragraph styles need unique IDs and names.'});ids.add(item.id);names.add(name);}
});
export type ParagraphStyleData=z.infer<typeof paragraphStyleSchema>;
export type ParagraphStyleBinding=z.infer<typeof paragraphStyleBindingSchema>;
export function paragraphFormat(layer:TextLayerData):ParagraphFormat {
  const value={...DEFAULT_PARAGRAPH_FORMAT};
  for(const key of PARAGRAPH_FORMAT_KEYS)if(layer[key]!==undefined)(value as Record<string,unknown>)[key]=layer[key];
  return paragraphFormatSchema.parse(value);
}
export function sameParagraphFormat(a:ParagraphFormat,b:ParagraphFormat){return PARAGRAPH_FORMAT_KEYS.every(key=>(key==='fontVariantCaps'||key==='fontStretch'||key==='fontVariationSettings')?(a[key]??'normal')===(b[key]??'normal'):(key==='writingMode'||key==='textOrientation')?(a[key]??DEFAULT_PARAGRAPH_FORMAT[key])===(b[key]??DEFAULT_PARAGRAPH_FORMAT[key]):a[key]===b[key]);}
export function sameParagraphBase(a:ParagraphStyleData['basedOn'],b:ParagraphStyleData['basedOn']){
  return !a&&!b||!!a&&!!b&&a.id===b.id&&PARAGRAPH_FORMAT_KEYS.every(key=>Object.hasOwn(a.overrides,key)===Object.hasOwn(b.overrides,key)&&a.overrides[key]===b.overrides[key]);
}
/** Resolve a bounded DAG without changing inputs. Serialized admission separately checks cached formats. */
export function resolveParagraphStyleLibrary(input:readonly ParagraphStyleData[]):ParagraphStyleData[]{
  const entries=paragraphStyleLibrarySchema.parse(input),byId=new Map(entries.map(style=>[style.id,style]));
  // Admission trims names for uniqueness checks; resolving formats must not rename other records.
  entries.forEach((style,index)=>{style.name=input[index].name;});
  const active=new Set<string>(),complete=new Set<string>();
  const visit=(style:ParagraphStyleData):void=>{
    if(complete.has(style.id))return;
    if(active.has(style.id))throw new Error('Paragraph style inheritance cannot contain a cycle.');
    active.add(style.id);
    if(style.basedOn){
      const base=byId.get(style.basedOn.id);if(!base)throw new Error('Paragraph style refers to a missing base in its document.');
      visit(base);style.format=paragraphFormatSchema.parse({...base.format,...style.basedOn.overrides});
    }
    active.delete(style.id);complete.add(style.id);
  };
  entries.forEach(visit);return entries;
}
export function paragraphTextLayers(nodes:readonly LayerData[]):TextLayerData[]{
  return nodes.flatMap(node=>node.kind==='text'?[node]:node.kind==='group'?paragraphTextLayers(node.children):[]);
}
/** Derived concrete fields are retained for existing render/export/font-measurement paths. */
export function resolveParagraphBinding(layer:TextLayerData,style:ParagraphStyleData){
  if(!layer.paragraphStyle||layer.paragraphStyle.id!==style.id)throw new Error('Paragraph style binding does not match its definition.');
  Object.assign(layer,DEFAULT_PARAGRAPH_FORMAT,style.format,layer.paragraphStyle.overrides);
}
export function validateParagraphStyles(document:DocumentData){
  const text=paragraphTextLayers(document.children);
  if(document.paragraphStyles===undefined&&!text.some(layer=>layer.paragraphStyle!=null))return;
  for(const style of document.paragraphStyles??[]){
    assertFontFeaturesVersion(style.format,Number(document.schemaVersion));
    if(style.basedOn)assertFontFeaturesVersion(style.basedOn.overrides,Number(document.schemaVersion));
    assertTextWritingVersion(style.format,Number(document.schemaVersion));
    if(style.basedOn)assertTextWritingVersion(style.basedOn.overrides,Number(document.schemaVersion));
  }
  for(const layer of text)if(layer.paragraphStyle){assertTextWritingVersion(layer.paragraphStyle.overrides,Number(document.schemaVersion));assertFontFeaturesVersion(layer.paragraphStyle.overrides,Number(document.schemaVersion));}
  const original=paragraphStyleLibrarySchema.parse(document.paragraphStyles??[]),styles=resolveParagraphStyleLibrary(original),byId=new Map(styles.map(style=>[style.id,style]));
  if(document.paragraphStyles!==undefined&&Number(document.schemaVersion)<40)throw new Error('Paragraph styles require schema version 40.');
  for(const [index,style]of original.entries()){
    if(style.basedOn&&Number(document.schemaVersion)<41)throw new Error('Paragraph style inheritance requires schema version 41.');
    if(!sameParagraphFormat(style.format,styles[index].format))throw new Error('Paragraph style formatting disagrees with its base and overrides.');
  }
  for(const layer of text){
    if(layer.paragraphStyle==null)continue;
    if(Number(document.schemaVersion)<40)throw new Error('Paragraph styles require schema version 40.');
    const binding=paragraphStyleBindingSchema.parse(layer.paragraphStyle),style=byId.get(binding.id);
    if(!style)throw new Error('Text refers to a missing paragraph style in its document.');
    const expected=paragraphFormatSchema.parse({...style.format,...binding.overrides});
    if(!sameParagraphFormat(paragraphFormat(layer),expected))throw new Error('Text formatting disagrees with its paragraph style and overrides.');
  }
}

/** Copy root text links into another document without overwriting unrelated definitions. */
export function importParagraphStyles(source:DocumentData,target:DocumentData,layers:LayerData[],newId:()=>string){
  const used=new Set<string>(),byId=new Map((source.paragraphStyles??[]).map(style=>[style.id,style])),active=new Set<string>();
  const include=(id:string)=>{
    if(used.has(id))return;if(active.has(id))throw new Error('Paragraph style inheritance cannot contain a cycle.');
    const style=byId.get(id);if(!style)throw new Error('Missing source paragraph style.');active.add(id);
    if(style.basedOn)include(style.basedOn.id);active.delete(id);used.add(id);
  };
  for(const text of paragraphTextLayers(layers))if(text.paragraphStyle)include(text.paragraphStyle.id);
  const definitions:ParagraphStyleData[]=[],mapping=new Map<string,string>();
  const names=new Set((target.paragraphStyles??[]).map(style=>style.name.trim().toLocaleLowerCase('en')));
  for(const id of used){
    const sourceStyle=source.paragraphStyles?.find(style=>style.id===id);if(!sourceStyle)throw new Error('Missing source paragraph style.');
    const original=paragraphStyleSchema.parse(sourceStyle),targetStyle=target.paragraphStyles?.find(style=>style.id===id);
    if(original.basedOn)original.basedOn.id=mapping.get(original.basedOn.id)!;
    const existing=targetStyle?paragraphStyleSchema.parse(targetStyle):undefined;
    if(existing&&existing.name===original.name&&sameParagraphFormat(existing.format,original.format)&&sameParagraphBase(existing.basedOn,original.basedOn)){mapping.set(id,id);continue;}
    const style=structuredClone(original);if(existing)style.id=newId();
    const base=style.name;let suffix=2;while(names.has(style.name.toLocaleLowerCase('en')))style.name=base.slice(0,70)+` ${suffix++}`;
    names.add(style.name.toLocaleLowerCase('en'));mapping.set(id,style.id);definitions.push(style);
  }
  for(const layer of paragraphTextLayers(layers))if(layer.paragraphStyle)layer.paragraphStyle={...layer.paragraphStyle,id:mapping.get(layer.paragraphStyle.id)!};
  return definitions;
}
