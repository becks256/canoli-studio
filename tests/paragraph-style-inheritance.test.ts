import {SCHEMA_VERSION as CURRENT_DOCUMENT_SCHEMA} from '../src/core/model';
import {withoutNativeFontFeatures} from './helpers/legacy-typography';
import {expect,it} from 'vitest';
import {Document,ParagraphStyle,TextLayer,LayerGroup} from '../src/dom';
import {validateDocument} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {importParagraphStyles,DEFAULT_PARAGRAPH_FORMAT} from '../src/core/paragraph-styles';
import {RecipeRecorder,executeRecipe,type Recipe} from '../src/ai/recipes';
import {serializeRecipePackage,readRecipePackage} from '../src/ai/recipes/package';

function scene(){
 const document=new Document({width:600,height:300});
 const base=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontSize:24,color:'#315b2a',lineHeight:1.4}}));
 const child=document.paragraphStyles.add(new ParagraphStyle({name:'Heading',basedOn:base,format:{fontSize:36}}));
 const leaf=document.paragraphStyles.add(new ParagraphStyle({name:'Accent',basedOn:child,format:{color:'#a43e29'}}));
 const first=document.layers.add(new TextLayer({name:'First',text:'A linked hierarchy',x:24,y:24,wrapWidth:240}));first.paragraphStyle=child;
 const second=document.layers.add(new TextLayer({name:'Second',text:'Independent local text',x:300,y:24,wrapWidth:240}));second.paragraphStyle=leaf;
 return{document,base,child,leaf,first,second};
}
it('constructs complete resolved child formats with only supplied overrides and strict owned bases',()=>{
 const {document,base,child,leaf}=scene();expect(child.basedOn!.id).toBe(base.id);expect(child.overrides).toEqual({fontSize:36});expect(child.format).toEqual({...base.format,fontSize:36});expect(leaf.format).toEqual({...child.format,color:'#a43e29'});
 expect(()=>new ParagraphStyle({basedOn:new ParagraphStyle()})).toThrow(/attached/);expect(()=>new ParagraphStyle({basedOn:{}as never})).toThrow();
 const foreign=new Document();expect(()=>foreign.paragraphStyles.add(new ParagraphStyle({name:'Foreign',basedOn:base}))).toThrow(/this document/);
 expect(()=>{child.basedOn=foreign.paragraphStyles.add(new ParagraphStyle());}).toThrow(/this document/);expect(document.paragraphStyles.length).toBe(3);
});
it('refreshes a detached child base on attachment and rejects a removed base without partial state',()=>{
 const document=new Document(),base=document.paragraphStyles.add(new ParagraphStyle({name:'Body'}));
 const child=new ParagraphStyle({name:'Heading',basedOn:base,format:{fontSize:44}});base.update({color:'#abcdef'});document.paragraphStyles.add(child);expect(child.format.color).toBe('#abcdef');expect(child.format.fontSize).toBe(44);
 const orphan=new ParagraphStyle({name:'Orphan',basedOn:base});base.remove();const before=document.toJSON();expect(()=>document.paragraphStyles.add(orphan)).toThrow(/no longer attached/);expect(document.toJSON()).toEqual(before);
});
it('propagates transitive fields while keeping style and text overrides independently explicit',()=>{
 const {base,child,leaf,first,second}=scene();second.lineHeight=1.7;child.update({fontSize:36});base.update({fontSize:28,color:'#2266aa',lineHeight:1.6,paragraphSpacing:12});
 expect(first.paragraphFormat).toMatchObject({fontSize:36,color:'#2266aa',lineHeight:1.6,paragraphSpacing:12});expect(second.paragraphFormat).toMatchObject({fontSize:36,color:'#a43e29',lineHeight:1.7,paragraphSpacing:12});
 expect(child.overrides).toEqual({fontSize:36});expect(leaf.overrides).toEqual({color:'#a43e29'});expect(second.paragraphOverrides).toEqual({lineHeight:1.7});
 child.resetOverrides(['fontSize']);expect(first.fontSize).toBe(28);expect(second.fontSize).toBe(28);leaf.resetOverrides();expect(second.color).toBe('#2266aa');second.resetParagraphOverrides();expect(second.lineHeight).toBe(1.6);
});
it('propagates every controlled format field and retains equal-value style overrides until explicitly reset',()=>{
 const {base,child,first}=scene();child.resetOverrides();child.update({letterSpacing:0});base.update({fontSize:30,fontFamily:'serif',color:'#112233',align:'right',lineHeight:1.8,letterSpacing:2,wordSpacing:3,fontKerning:'none',fontWeight:'700',fontStyle:'italic',direction:'rtl',paragraphJustify:'inter-word',paragraphSpacing:14,firstLineIndent:5});
 expect(child.format).toEqual({...base.format,letterSpacing:0});expect(first.paragraphFormat).toEqual(child.format);child.resetOverrides(['letterSpacing']);expect(first.paragraphFormat).toEqual(base.format);
 expect(()=>child.resetOverrides(['fontSize','fontSize'])).toThrow();expect(()=>child.resetOverrides(['unknown']as never)).toThrow();expect(()=>base.resetOverrides()).toThrow(/Choose a base/);
});
it('reflows transitive followers once in atomic history and restores hierarchy handles through undo/redo',()=>{
 const {document,base,child,first}=scene(),before=document.toJSON(),height=first.height,history=document.getSnapshot().past.length;base.update({lineHeight:2,paragraphSpacing:20});
 expect(first.height).toBeGreaterThan(height);expect(document.getSnapshot().past).toHaveLength(history+1);const after=document.toJSON();document.undo();expect(document.toJSON()).toEqual(before);expect(child.basedOn!.format.lineHeight).toBe(1.4);document.redo();expect(document.toJSON()).toEqual(after);expect(Document.fromJSON(after).toJSON()).toEqual(after);
});
it('rejects cycles, missing bases and stale resolved formats before changing any follower',()=>{
 const {document,base,child,leaf}=scene(),before=document.toJSON(),history=document.getSnapshot().past.length;
 expect(()=>{base.basedOn=leaf;}).toThrow(/cycle/);expect(()=>{child.basedOn=child;}).toThrow(/cycle/);
 const missing={...child.toJSON(),basedOn:{id:'missing',overrides:{}}};expect(()=>document._dispatch({type:'paragraphStyle.set',style:missing})).toThrow(/missing base/);
 expect(()=>document._dispatch({type:'paragraphStyle.set',style:{...child.toJSON(),format:{...child.format,color:'#000000'}}})).toThrow(/disagrees/);
 expect(document.toJSON()).toEqual(before);expect(document.getSnapshot().past).toHaveLength(history);
});
it('rejects changed locked descendants atomically, while shielded fields and rename-only updates remain valid',()=>{
 const {document,base,child,first,second}=scene(),group=document.layers.add(new LayerGroup());second.moveTo(group);group.locked=true;const before=document.toJSON();
 expect(()=>base.update({lineHeight:2})).toThrow(/Unlock/);expect(document.toJSON()).toEqual(before);base.update({fontSize:28});expect(first.fontSize).toBe(36);expect(second.fontSize).toBe(36);
 base.name='Body renamed';expect(child.basedOn!.name).toBe('Body renamed');group.locked=false;child.resetOverrides();group.locked=true;const reset=document.toJSON();expect(()=>base.update({fontSize:40})).toThrow(/Unlock/);expect(document.toJSON()).toEqual(reset);
});
it('supports switching bases with explicit retention, detaching without appearance changes and capture/reset',()=>{
 const {document,base,child,leaf,first}=scene(),other=document.paragraphStyles.add(new ParagraphStyle({name:'Other',format:{fontSize:50,color:'#888888'}}));
 child.setBase(other,{keepOverrides:true});expect(child.format).toMatchObject({fontSize:36,color:'#888888'});expect(first.fontSize).toBe(36);child.basedOn=base;expect(child.overrides).toEqual({});expect(first.fontSize).toBe(24);
 first.fontSize=31;child.captureFrom(first);expect(Object.keys(child.overrides)).toHaveLength(Object.keys(DEFAULT_PARAGRAPH_FORMAT).length);base.update({fontSize:40,color:'#000000'});expect(child.format.fontSize).toBe(31);child.resetOverrides();expect(child.format.fontSize).toBe(40);
 const format=child.format;child.basedOn=null;expect(child.basedOn).toBeNull();expect(child.format).toEqual(format);base.update({lineHeight:2});expect(child.format.lineHeight).toBe(format.lineHeight);expect(leaf.basedOn!.id).toBe(child.id);
 const independent=new ParagraphStyle({name:'Detached',format:{fontSize:30}});independent.setBase(other,{keepOverrides:true});expect(independent.format.fontSize).toBe(30);expect(Object.keys(independent.overrides)).toHaveLength(Object.keys(DEFAULT_PARAGRAPH_FORMAT).length);
});
it('removes a base by detaching immediate child styles and direct text, preserving descendants and appearance',()=>{
 const {document,base,child,leaf,first,second}=scene(),direct=document.layers.add(new TextLayer({name:'Direct'}));direct.paragraphStyle=base;
 const formats=[first.paragraphFormat,second.paragraphFormat,direct.paragraphFormat],before=document.toJSON();base.remove();expect(child.basedOn).toBeNull();expect(leaf.basedOn!.id).toBe(child.id);expect(direct.paragraphStyle).toBeNull();
 expect([first.paragraphFormat,second.paragraphFormat,direct.paragraphFormat]).toEqual(formats);child.update({lineHeight:2});expect(second.lineHeight).toBe(2);document.undo();document.undo();expect(document.toJSON()).toEqual(before);
});
it('gates hierarchy schema 41 in roots and embedded masters, and rejects corrupt graphs without repairing snapshots',()=>{
 const {document,base,first}=scene(),saved=document.toJSON();expect(saved.schemaVersion).toBe(CURRENT_DOCUMENT_SCHEMA);expect(()=>validateDocument({...withoutNativeFontFeatures(saved),schemaVersion:40})).toThrow(/schema version 41/);
 const corrupt=structuredClone(saved);corrupt.paragraphStyles![1].format.color='#000000';expect(()=>Document.fromJSON(corrupt)).toThrow(/disagrees/);
 const cyclic=structuredClone(saved);cyclic.paragraphStyles![0].basedOn={id:cyclic.paragraphStyles![2].id,overrides:{}};expect(()=>Document.fromJSON(cyclic)).toThrow(/cycle/);
 const legacy=new Document();legacy.paragraphStyles.add(new ParagraphStyle());expect(Document.fromJSON({...withoutNativeFontFeatures(legacy.toJSON()),schemaVersion:40}).toJSON().schemaVersion).toBe(CURRENT_DOCUMENT_SCHEMA);
 const object=document.createSmartObject([first]),snapshot=document.toJSON(),definition=snapshot.components!.find(value=>value.id===object.componentId)!;if(definition.source.kind!=='document')throw new Error('fixture');definition.source.document.schemaVersion=40;expect(()=>Document.fromJSON(withoutNativeFontFeatures(snapshot))).toThrow(/schema version 41/);expect(base.format.fontSize).toBe(24);
});
it('imports the complete ancestor closure before children and remaps hierarchy conflicts without changing source data',()=>{
 const {document,base,child,leaf,second}=scene(),target=new Document(),before=document.toJSON();target._dispatch({type:'paragraphStyle.set',style:{...base.toJSON(),format:{...base.format,color:'#000000'}}});
 const copies=[second.toJSON()];let next=0;const definitions=importParagraphStyles(before,target.toJSON(),copies,()=>`copied-${++next}`);expect(definitions).toHaveLength(3);expect(definitions.map(style=>style.name)).toEqual(['Body 2','Heading','Accent']);
 target.transaction('Copy hierarchy',()=>{for(const style of definitions)target._dispatch({type:'paragraphStyle.set',style});target._dispatch({type:'layer.add',layer:copies[0]});});
 const copy=target.layers.at(0)as TextLayer;expect(copy.paragraphStyle!.basedOn!.basedOn!.id).not.toBe(base.id);expect(copy.paragraphFormat).toEqual(second.paragraphFormat);
 target.paragraphStyles.getById(definitions[0].id)!.update({lineHeight:2});expect(copy.lineHeight).toBe(2);expect(document.toJSON()).toEqual(before);expect(child.basedOn!.id).toBe(base.id);expect(leaf.basedOn!.id).toBe(child.id);
});
it('preserves hierarchy identity when copying identical definitions and rejects flattening as equivalent inheritance',()=>{
 const {document,child,first}=scene(),target=Document.fromJSON(document.toJSON());expect(importParagraphStyles(document.toJSON(),target.toJSON(),[first.toJSON()],()=>{throw new Error('No new IDs');})).toEqual([]);
 const flat=child.toJSON();delete flat.basedOn;target._dispatch({type:'paragraphStyle.set',style:flat});let next=0;const copies=[first.toJSON()],definitions=importParagraphStyles(document.toJSON(),target.toJSON(),copies,()=>`new-${++next}`);expect(definitions).toHaveLength(1);expect(definitions[0].basedOn).toEqual(child.toJSON().basedOn);expect(definitions[0].name).toBe('Heading 2');
});
it('supports the full bounded 128-style chain and rejects a cycle at its deepest link',()=>{
 const document=new Document();let first=document.paragraphStyles.add(new ParagraphStyle({name:'Style 0'})),last=first;
 document.transaction('Style chain',()=>{for(let i=1;i<128;i++)last=document.paragraphStyles.add(new ParagraphStyle({name:`Style ${i}`,basedOn:last}));});
 const text=document.layers.add(new TextLayer());text.paragraphStyle=last;first.update({fontSize:48});expect(text.fontSize).toBe(48);expect(()=>{first.basedOn=last;}).toThrow(/cycle/);expect(document.paragraphStyles.length).toBe(128);
});
it('records parent dependencies, resets and transitive updates into portable JSON/packages with live future inheritance',async()=>{
 const {document,base,child,first}=scene(),recorder=new RecipeRecorder();recorder.start();const hook=document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));
 const added=document.layers.add(new TextLayer({name:'Added',text:'Portable inherited text'}));added.paragraphStyle=child;child.resetOverrides();base.update({fontSize:28,color:'#2266aa'});hook();const recipe=recorder.stop();
 const file=await serializeRecipePackage(recipe,{get(){throw new Error('No assets');}}),restored=(await readRecipePackage(file)).recipe,target=new Document();expect(executeRecipe(restored,target).error).toBeUndefined();
 const copy=target.layers.at(0)as TextLayer;expect(copy.fontSize).toBe(28);expect(copy.paragraphStyle!.basedOn!.name).toBe('Body');expect(copy.paragraphStyle!.overrides).toEqual({});copy.paragraphStyle!.basedOn!.update({fontSize:42});expect(copy.fontSize).toBe(42);expect(first.fontSize).toBe(28);
});
it('rejects recipe inheritance conflicts, missing references and stale formats atomically through strict shared commands',()=>{
 const recipe:Recipe={schemaVersion:1,id:'hierarchy',name:'Hierarchy',description:'',version:1,parameters:[],steps:[
  {id:'base',name:'Base',action:{type:'paragraphStyle.ensure',name:'Body',format:{...DEFAULT_PARAGRAPH_FORMAT}}},
  {id:'child',name:'Child',action:{type:'paragraphStyle.ensure',name:'Heading',format:{...DEFAULT_PARAGRAPH_FORMAT,fontSize:36},basedOn:{style:{by:'stepResult',stepId:'base'},overrides:{fontSize:36}}}},
 ]};
 const document=new Document();expect(executeRecipe(recipe,document).success).toBe(true);expect(document.paragraphStyles.at(1)!.basedOn!.name).toBe('Body');
 const before=document.toJSON(),bad=structuredClone(recipe);if(bad.steps[1].action.type!=='paragraphStyle.ensure')throw new Error('fixture');bad.steps[1].action.basedOn!.style={by:'stepResult',stepId:'unknown'};expect(executeRecipe(bad,document).success).toBe(false);expect(document.toJSON()).toEqual(before);
 bad.steps[1].action.basedOn!.style={by:'stepResult',stepId:'base'};bad.steps[1].action.basedOn!.overrides={fontSize:40};expect(executeRecipe(bad,new Document()).error).toMatch(/disagrees/);
 const data=document.paragraphStyles.at(1)!.toJSON();expect(()=>parseCommands([{type:'paragraphStyle.set',style:{...data,basedOn:{id:'base',overrides:{wrapWidth:10}}}}])).toThrow();
});

it('preserves unrelated valid serialized names when resolving a parent edit instead of normalizing the whole library',()=>{
 const {document,base,child}=scene(),unrelated=document.paragraphStyles.add(new ParagraphStyle({name:'Unrelated',format:{fontSize:17}})),snapshot=document.toJSON();
 snapshot.paragraphStyles!.find(style=>style.id===unrelated.id)!.name='\u00a0Unrelated\u00a0';snapshot.paragraphStyles!.find(style=>style.id===child.id)!.name=' Heading ';
 const restored=Document.fromJSON(snapshot),unchanged=restored.paragraphStyles.getById(unrelated.id)!.toJSON();restored.paragraphStyles.getById(base.id)!.update({lineHeight:1.8});
 expect(restored.paragraphStyles.getById(unrelated.id)!.toJSON()).toEqual(unchanged);expect(restored.paragraphStyles.getById(child.id)!.name).toBe(' Heading ');
 expect(restored.paragraphStyles.getById(child.id)!.format.lineHeight).toBe(1.8);
});
