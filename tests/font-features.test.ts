import {expect,it} from 'vitest';
import {Document,TextLayer,LayerGroup,VectorLayer,ParagraphStyle} from '../src/dom';
import {validateDocument,SCHEMA_VERSION} from '../src/core/model';
import {FONT_CAPITAL_VARIANTS,FONT_STRETCHES} from '../src/core/font-features';
import {applyTextStyle} from '../src/core/text-style';
import {parseCommands} from '../src/core/validation';
import {paragraphFormatPatchSchema} from '../src/core/paragraph-styles';
import {RecipeRecorder,executeRecipe} from '../src/ai/recipes';
import {serializeRecipePackage,readRecipePackage} from '../src/ai/recipes/package';
import legacyFixture from './fixtures/typography/schema-41-linked.json';

it('opens a genuine prior-runtime linked-style fixture without rewriting its text, formats or sparse overrides',()=>{
 const source=structuredClone(legacyFixture),document=Document.fromJSON(source),saved=document.toJSON(),text=document.layers.at(0)as TextLayer;
 expect(source.schemaVersion).toBe(41);expect(saved).toEqual({...source,schemaVersion:42});expect(text.text).toBe('Original ß é العربية');expect(text.paragraphOverrides).toEqual({color:'#205080'});
 expect(text.paragraphStyle!.format).toMatchObject({fontVariantCaps:'normal',fontStretch:'normal',fontWeight:'553.25'});
 text.paragraphStyle!.basedOn!.update({fontVariantCaps:'small-caps',fontStretch:'condensed'});expect(text.fontVariantCaps).toBe('small-caps');expect(text.fontStretch).toBe('condensed');expect(text.paragraphOverrides).toEqual({color:'#205080'});
 document.undo();expect(document.toJSON()).toEqual(saved);expect(legacyFixture).toEqual(source);
});
it('pins resolved normal defaults when a genuine legacy independent style adopts a new base while retaining its format',()=>{
 const document=Document.fromJSON(legacyFixture),body=document.paragraphStyles.getById(legacyFixture.paragraphStyles[0].id)!,replacement=document.paragraphStyles.add(new ParagraphStyle({name:'Feature base',format:{fontVariantCaps:'small-caps',fontStretch:'condensed'}})),before=body.format;
 body.setBase(replacement,{keepOverrides:true});expect(body.format).toEqual(before);expect(body.overrides).toMatchObject({fontVariantCaps:'normal',fontStretch:'normal'});
});

it('authors every native capital variant and stretch without replacing source text, with one-command reset and exact undo',()=>{
 const document=new Document(),group=document.layers.add(new LayerGroup()),text=group.layers.add(new TextLayer({text:'Original ß ﬁ e\u0301 العربية',fontWeight:'553.25'}));
 const source=text.text;
 for(const value of FONT_CAPITAL_VARIANTS){text.fontVariantCaps=value;expect(text.fontVariantCaps).toBe(value);expect(text.text).toBe(source);}
 for(const value of FONT_STRETCHES){text.fontStretch=value;expect(text.fontStretch).toBe(value);expect(text.text).toBe(source);}
 const before=document.toJSON(),length=document.getSnapshot().past.length;text.resetFontFeatures();
 expect(text.toJSON()).toMatchObject({text:source,fontVariantCaps:'normal',fontStretch:'normal',fontWeight:'553.25'});expect(document.getSnapshot().past).toHaveLength(length+1);
 document.undo();expect(document.toJSON()).toEqual(before);document.redo();group.locked=true;const locked=document.toJSON();expect(()=>text.resetFontFeatures()).toThrow(/Unlock/);expect(()=>{text.fontStretch='condensed';}).toThrow(/Unlock/);expect(document.toJSON()).toEqual(locked);
});
it('rejects unknown values, CSS injection, nulls and non-text targets without publishing the preceding transaction',()=>{
 const document=new Document(),text=document.layers.add(new TextLayer()),vector=document.layers.add(new VectorLayer());
 for(const patch of [{fontVariantCaps:'uppercase'},{fontVariantCaps:'small-caps;color:red'},{fontVariantCaps:null},{fontVariantCaps:true},{fontStretch:'75%'},{fontStretch:75},{fontStretch:null},{fontStretch:'condensed;display:none'}]){
  expect(()=>parseCommands([{type:'layer.update',id:text.id,patch}])).toThrow();
 }
 const before=document.toJSON();expect(()=>document.transaction('Rejected',()=>{document.name='Must roll back';vector.update({fontVariantCaps:'small-caps'});})).toThrow(/text layer/);expect(document.toJSON()).toEqual(before);
 expect(()=>new TextLayer({fontVariantCaps:'small' as never})).toThrow();expect(()=>new TextLayer({fontStretch:'wide' as never})).toThrow();
});
it('gates serialized new fields under every old schema label and inside embedded master documents',()=>{
 for(const field of ['fontVariantCaps','fontStretch']as const){
  const document=new Document(),text=document.layers.add(new TextLayer({[field]:'normal'}));const saved=document.toJSON();validateDocument(saved);
  for(let schemaVersion=1;schemaVersion<42;schemaVersion++)expect(()=>Document.fromJSON({...saved,schemaVersion})).toThrow(/version 42/);
  const object=document.createSmartObject([text]),withMaster=document.toJSON(),definition=withMaster.components!.find(value=>value.id===object.componentId)!;
  if(definition.source.kind!=='document')throw new Error('Expected master');definition.source.document.schemaVersion=41;
  expect(()=>Document.fromJSON(withMaster)).toThrow(/version 42/);
 }
});
it('keeps legacy missing defaults and rejects new fields in old style formats or overrides before normalization',()=>{
 const document=new Document(),text=document.layers.add(new TextLayer({text:'Legacy'}));
 for(let schemaVersion=1;schemaVersion<SCHEMA_VERSION;schemaVersion++){
  const saved=Document.fromJSON({...document.toJSON(),schemaVersion}).toJSON();expect(saved.schemaVersion).toBe(SCHEMA_VERSION);expect(saved.children[0]).not.toHaveProperty('fontVariantCaps');expect(saved.children[0]).not.toHaveProperty('fontStretch');
 }
 expect(paragraphFormatPatchSchema.parse({})).toEqual({});
 const style=document.paragraphStyles.add(new ParagraphStyle({name:'Normal'}));text.paragraphStyle=style;
 const old=JSON.parse(JSON.stringify(document.toJSON(),(key,value)=>key==='fontVariantCaps'||key==='fontStretch'?undefined:value));old.schemaVersion=41;
 validateDocument(old);const restored=Document.fromJSON(old),linked=restored.layers.at(0)as TextLayer;
 expect(linked.paragraphStyle!.format).toMatchObject({fontVariantCaps:'normal',fontStretch:'normal'});expect(linked.paragraphOverrides).toEqual({});
 const legacyText=old.children[0];if(legacyText.kind!=='text'||!legacyText.paragraphStyle)throw new Error('Expected linked legacy text');
 const targets:Record<string,unknown>[]=[old.paragraphStyles![0].format,legacyText.paragraphStyle.overrides];
 for(const target of targets){
  target.fontVariantCaps='normal';expect(()=>Document.fromJSON(old)).toThrow(/version 42/);delete target.fontVariantCaps;
 }
});
it('propagates native requests through style inheritance, preserves local overrides and clears obsolete requests on style changes',()=>{
 const document=new Document(),base=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontVariantCaps:'small-caps',fontStretch:'condensed',fontWeight:'553.25'}})),child=document.paragraphStyles.add(new ParagraphStyle({name:'Title',basedOn:base})),text=document.layers.add(new TextLayer());
 text.paragraphStyle=child;expect(child.overrides).toEqual({});expect(text.paragraphOverrides).toEqual({});expect(text.fontVariantCaps).toBe('small-caps');
 text.fontStretch='expanded';base.update({fontVariantCaps:'all-small-caps',fontStretch:'ultra-condensed'});expect(text.fontVariantCaps).toBe('all-small-caps');expect(text.fontStretch).toBe('expanded');expect(text.paragraphOverrides).toEqual({fontStretch:'expanded'});
 const before=document.toJSON();text.resetParagraphOverrides(['fontStretch']);expect(text.fontStretch).toBe('ultra-condensed');document.undo();expect(document.toJSON()).toEqual(before);
 const normal=document.paragraphStyles.add(new ParagraphStyle({name:'Normal'}));text.paragraphStyle=normal;expect(text.fontVariantCaps).toBe('normal');expect(text.fontStretch).toBe('normal');expect(text.paragraphOverrides).toEqual({});
 child.update({fontVariantCaps:'normal'});expect(child.overrides).toEqual({fontVariantCaps:'normal'});child.resetOverrides(['fontVariantCaps']);expect(child.overrides).toEqual({});expect(child.format.fontVariantCaps).toBe('all-small-caps');
});
it('rejects a base update affecting a locked follower while retaining independent shielded settings',()=>{
 const document=new Document(),style=document.paragraphStyles.add(new ParagraphStyle()),text=document.layers.add(new TextLayer());text.paragraphStyle=style;text.fontVariantCaps='normal';text.locked=true;
 style.update({fontVariantCaps:'small-caps'});expect(text.fontVariantCaps).toBe('normal');const before=document.toJSON();expect(()=>style.update({fontStretch:'condensed'})).toThrow(/Unlock/);expect(document.toJSON()).toEqual(before);
});
it('resets reusable native contexts and fails unsupported nondefault requests before assigning fonts',()=>{
 const context={font:'',fontVariantCaps:'small-caps',fontStretch:'expanded'};
 applyTextStyle(context as never,{fontSize:24,fontFamily:'serif'});expect(context).toMatchObject({fontVariantCaps:'normal',fontStretch:'normal'});
 applyTextStyle(context as never,{fontSize:24,fontFamily:'serif',fontVariantCaps:'all-small-caps',fontStretch:'condensed'});expect(context).toMatchObject({fontVariantCaps:'all-small-caps',fontStretch:'condensed'});
 for(const feature of [{fontVariantCaps:'small-caps'},{fontStretch:'condensed'}]){const unsupported={font:'unchanged'};expect(()=>applyTextStyle(unsupported as never,{fontSize:24,fontFamily:'serif',...feature}as never)).toThrow(/browser cannot/);expect(unsupported.font).toBe('unchanged');}
});
it('records and packages native font edits with portable inherited formats, exact reset semantics and one-step replay undo',async()=>{
 const document=new Document(),recorder=new RecipeRecorder();recorder.start();const stop=document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));
 const style=document.paragraphStyles.add(new ParagraphStyle({name:'Caption',format:{fontVariantCaps:'small-caps',fontStretch:'condensed',fontWeight:'553.25'}})),text=document.layers.add(new TextLayer({text:'Portable native text'}));text.paragraphStyle=style;text.fontVariantCaps='all-small-caps';text.resetParagraphOverrides(['fontVariantCaps']);stop();
 const recipe=recorder.stop(),file=await serializeRecipePackage(recipe,{get(){throw new Error('No raster sources');}}),loaded=(await readRecipePackage(file)).recipe,target=new Document();
 expect(executeRecipe(loaded,target).success).toBe(true);const copy=target.layers.at(0)as TextLayer;expect(copy.toJSON()).toMatchObject({text:text.text,fontVariantCaps:'small-caps',fontStretch:'condensed',fontWeight:'553.25'});expect(copy.paragraphOverrides).toEqual({});target.undo();expect(target.layers.length).toBe(0);
});
