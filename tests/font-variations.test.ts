import {expect,it} from 'vitest';
import {Document,TextLayer,LayerGroup,ParagraphStyle,VectorLayer} from '../src/dom';
import {validateDocument,SCHEMA_VERSION} from '../src/core/model';
import {parseFontVariations,formatFontVariations,fontVariationSettingsSchema} from '../src/core/font-variations';
import {parseCommands} from '../src/core/validation';

it('parses actual CSS axis values without accepting declarations, functions, duplicates or nonfinite numbers',()=>{
 const value=' "wght" 553.25, /* source axis */ "TEST" -1e1';
 expect(parseFontVariations(value)).toEqual([{tag:'TEST',value:-10},{tag:'wght',value:553.25}]);
 expect(formatFontVariations(parseFontVariations(value))).toBe('"TEST" -10, "wght" 553.25');
 expect(parseFontVariations('normal')).toEqual([]);
 for(const invalid of ['', 'inherit','"abc" 1','"abcde" 1','"wght" NaN','"wght" 1e999','"wght" calc(1 + 2)','"wght" 1,','"wght" 1, "wght" 2','"wght" 1; color:red','url(https://example.invalid)','"wght" 1 / 2'])expect(()=>fontVariationSettingsSchema.parse(invalid),invalid).toThrow();
});
it('authors native-axis requests through one shared command, preserves Unicode and restores exact history',()=>{
 const document=new Document(),text=document.layers.add(new TextLayer({text:'Literal ß é العربية',fontVariationSettings:'"TEST" 10'})),before=document.toJSON(),history=document.getSnapshot().past.length,commands:string[]=[];
 document.onCommand(command=>commands.push(command.type));text.fontVariationSettings='"TEST" 20.5';
 expect(text.text).toBe('Literal ß é العربية');expect(text.fontVariationSettings).toBe('"TEST" 20.5');expect(commands).toEqual(['layer.update']);expect(document.getSnapshot().past.length).toBe(history+1);
 document.undo();expect(document.toJSON()).toEqual(before);document.redo();text.resetVariableAxes();expect(text.fontVariationSettings).toBe('normal');document.undo();expect(text.fontVariationSettings).toBe('"TEST" 20.5');
});
it('preserves omitted legacy settings while schema 44 gates explicit requests in layers and style libraries',()=>{
 const before=new Document().toJSON();before.schemaVersion=43;const text=new TextLayer().toJSON();before.children=[text];delete(text as typeof text&{fontVariationSettings?:string}).fontVariationSettings;
 const document=Document.fromJSON(before);expect(document.toJSON()).toEqual({...before,schemaVersion:SCHEMA_VERSION});expect((document.layers.at(0)as TextLayer).fontVariationSettings).toBeUndefined();
 for(const setting of ['normal','"TEST" 1']){const old=structuredClone(before);(old.children[0]as typeof text&{fontVariationSettings?:string}).fontVariationSettings=setting;expect(()=>validateDocument(old)).toThrow(/schema version 44/);}
 const styleDoc=new Document(),style=styleDoc.paragraphStyles.add(new ParagraphStyle({name:'Variable',format:{fontVariationSettings:'"TEST" 1'}}));
 const old=styleDoc.toJSON();old.schemaVersion=43;expect(()=>validateDocument(old)).toThrow(/schema version 44/);expect(style.format.fontVariationSettings).toBe('"TEST" 1');
});
it('propagates inherited axis settings and keeps explicit overrides/reset/detach in the shared style model',()=>{
 const document=new Document(),base=document.paragraphStyles.add(new ParagraphStyle({name:'Base',format:{fontVariationSettings:'"TEST" 1'}})),child=document.paragraphStyles.add(new ParagraphStyle({name:'Child'}));child.setBase(base);
 const text=document.layers.add(new TextLayer());text.paragraphStyle=child;expect(text.fontVariationSettings).toBe('"TEST" 1');base.update({fontVariationSettings:'"TEST" 2'});expect(text.fontVariationSettings).toBe('"TEST" 2');
 text.fontVariationSettings='"TEST" 3';base.update({fontVariationSettings:'"TEST" 4'});expect(text.fontVariationSettings).toBe('"TEST" 3');text.resetParagraphOverrides(['fontVariationSettings']);expect(text.fontVariationSettings).toBe('"TEST" 4');text.paragraphStyle=null;expect(text.fontVariationSettings).toBe('"TEST" 4');
});
it('rejects invalid fields and locked followers atomically through the command/REST-compatible validator',()=>{
 const document=new Document(),group=document.layers.add(new LayerGroup()),text=group.layers.add(new TextLayer()),vector=document.layers.add(new VectorLayer());
 expect(parseCommands([{type:'layer.update',id:text.id,patch:{fontVariationSettings:'"TEST" 1'}}])).toHaveLength(1);
 for(const value of [null,1,{},'"TEST" 1,'])expect(()=>parseCommands([{type:'layer.update',id:text.id,patch:{fontVariationSettings:value}}])).toThrow();
 let before=document.toJSON();expect(()=>document.transaction('Invalid axes',()=>{text.opacity=.5;vector.update({fontVariationSettings:'"TEST" 1'}as never);})).toThrow(/text/);expect(document.toJSON()).toEqual(before);
 group.locked=true;before=document.toJSON();expect(()=>{text.fontVariationSettings='"TEST" 1';}).toThrow(/Unlock/);expect(document.toJSON()).toEqual(before);
});
