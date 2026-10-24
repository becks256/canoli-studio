import {expect,it} from 'vitest';
import {Document,TextLayer,ParagraphStyle,LayerGroup} from '../src/dom';
import {parseCommands} from '../src/core/validation';
import {RecipeRecorder,compileEditPlan,executeRecipe,type Recipe} from '../src/ai/recipes';

function scene(){
 const document=new Document({width:600,height:300});
 const base=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontFamily:'serif',fontSize:24}}));
 const inherited=document.paragraphStyles.add(new ParagraphStyle({name:'Inherited',basedOn:base,format:{color:'#315b2a'}}));
 const override=document.paragraphStyles.add(new ParagraphStyle({name:'Override',basedOn:inherited,format:{fontFamily:'serif'}}));
 const a=document.layers.add(new TextLayer({name:'Inherited text',text:'Arabic العربية é 🥐'}));a.paragraphStyle=inherited;
 const b=document.layers.add(new TextLayer({name:'Override text',text:'Other text',visible:false}));b.paragraphStyle=override;b.fontFamily='serif';
 const c=document.layers.add(new TextLayer({name:'Other font',text:'Keep'}));c.paragraphStyle=inherited;c.fontFamily='monospace';
 document.selectedLayer=a;return{document,base,inherited,override,a,b,c};
}
it('reports exact requests and owned counts across hidden text, styles and explicit overrides',()=>{
 const {document}=scene();const items=document.fonts.items;
 expect(items.find(item=>item.family==='serif')).toMatchObject({textLayers:2,paragraphStyles:3,overrides:2,embeddedScopes:0,lockedTextLayers:0});
 items[0].family='Changed DTO';expect(document.fonts.items.some(item=>item.family==='Changed DTO')).toBe(false);
 document.layers.add(new TextLayer({fontFamily:'serif, monospace'}));document.layers.add(new TextLayer({fontFamily:'Serif'}));
 expect(document.fonts.items.map(item=>item.family)).toEqual(expect.arrayContaining(['serif','Serif','serif, monospace']));
});
it('replaces an exact family in one undo step while preserving inheritance, overrides, source text and selection',()=>{
 const {document,base,inherited,override,a,b,c}=scene(),before=document.toJSON(),selected=document.getSnapshot().selectedIds,history=document.getSnapshot().past.length;
 document.fonts.replace('serif','sans-serif');
 expect([base.format.fontFamily,inherited.format.fontFamily,override.format.fontFamily,a.fontFamily,b.fontFamily]).toEqual(Array(5).fill('sans-serif'));
 expect(inherited.overrides).toEqual({color:'#315b2a'});expect(override.overrides).toEqual({fontFamily:'sans-serif'});expect(a.paragraphOverrides).toEqual({});expect(b.paragraphOverrides).toEqual({fontFamily:'sans-serif'});expect(c.fontFamily).toBe('monospace');
 expect(a.text).toBe('Arabic العربية é 🥐');expect(document.getSnapshot().selectedIds).toEqual(selected);expect(document.getSnapshot().past).toHaveLength(history+1);
 const after=document.toJSON();expect(Document.fromJSON(after).toJSON()).toEqual(after);document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);
});
it('rolls back styles and all earlier text changes if a later follower or ancestor is locked',()=>{
 const {document,b,base}=scene();const group=document.layers.add(new LayerGroup());b.moveTo(group);group.locked=true;
 const before=document.toJSON(),revision=document.getSnapshot().revision;
 expect(()=>document.fonts.replace('serif','sans-serif')).toThrow(/Unlock/);expect(document.toJSON()).toEqual(before);expect(document.getSnapshot().revision).toBe(revision);expect(base.format.fontFamily).toBe('serif');
});
it('allows font replacement when a locked follower is shielded by a different explicit family',()=>{
 const {document,c}=scene();c.locked=true;document.fonts.replace('serif','sans-serif');expect(c.fontFamily).toBe('monospace');
});
it('includes unused embedded definitions, preserves instance locks, and keeps embedded style scopes independent',()=>{
 const {document}=scene(),master=new Document({width:100,height:80});master.layers.add(new TextLayer({fontFamily:'serif',text:'Master'}));
 const definition=document.defineComponent(master,{name:'Embedded'});
 expect(document.fonts.items.find(item=>item.family==='serif')).toMatchObject({textLayers:3,embeddedScopes:1});
 const instance=document.placeSmartObject(definition);instance.locked=true;const before=document.toJSON();
 expect(()=>document.fonts.replace('serif','sans-serif')).toThrow(/locked instance/);expect(document.toJSON()).toEqual(before);
 instance.locked=false;document.fonts.replace('serif','sans-serif');expect(document.fonts.items.some(item=>item.family==='serif')).toBe(false);expect(master.layers.at(0)).toBeDefined();
});
it('keeps empty and identical replacements as no-ops and rejects invalid strict requests atomically',()=>{
 const {document}=scene(),before=document.toJSON(),revision=document.getSnapshot().revision;
 document.fonts.replace('missing','sans-serif');document.fonts.replace('serif','serif');expect(document.getSnapshot().revision).toBe(revision);
 for(const command of [{type:'document.font.replace',from:'',to:'serif'},{type:'document.font.replace',from:'serif',to:null},{type:'document.font.replace',from:'serif',to:'monospace',extra:true}])expect(()=>parseCommands([command])).toThrow();
 expect(()=>document.fonts.replace('serif','')).toThrow();expect(document.toJSON()).toEqual(before);
 expect(()=>document.transaction('Rollback font',()=>{document.fonts.replace('serif','monospace');throw new Error('stop');})).toThrow('stop');expect(document.toJSON()).toEqual(before);
});
it('records and preflights font replacement without a layer target and replays with one undo',()=>{
 const {document}=scene(),recorder=new RecipeRecorder();recorder.start();const unhook=document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));document.fonts.replace('serif','sans-serif');unhook();const recipe=recorder.stop() as Recipe;
 expect(recipe.steps.map(step=>step.action)).toContainEqual({type:'document.font.replace',from:'serif',to:'sans-serif'});
 expect(recipe.steps[0].literalValues).toBe(true);
 const target=scene().document,plan=compileEditPlan(recipe,target.toJSON());expect(plan.valid).toBe(true);expect(plan.summary.layersModified).toBe(2);const before=target.toJSON(),count=target.getSnapshot().past.length;
 expect(executeRecipe(recipe,target).success).toBe(true);expect(target.fonts.items.some(item=>item.family==='serif')).toBe(false);expect(target.getSnapshot().past).toHaveLength(count+1);target.undo();expect(target.toJSON()).toEqual(before);
});
it('retains literal parameter-looking requests in semantic recording and binds authored replacement parameters explicitly',()=>{
 const document=new Document(),text=document.layers.add(new TextLayer({fontFamily:'Font ${literal}',text:'Keep'})),recorder=new RecipeRecorder();recorder.start();const stop=document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));document.fonts.replace('Font ${literal}','serif');stop();const recorded=recorder.stop();
 const target=new Document(),copy=target.layers.add(new TextLayer({fontFamily:'Font ${literal}',text:'Keep'}));expect(executeRecipe(recorded,target).success).toBe(true);expect(copy.fontFamily).toBe('serif');expect(text.fontFamily).toBe('serif');
 const parameterized:Recipe={...recorded,parameters:[{name:'family',label:'Family',type:'string',default:'monospace'}],steps:[{id:'replace',name:'Replace',action:{type:'document.font.replace',from:'serif',to:'${family}'}}]};expect(executeRecipe(parameterized,target,{family:'sans-serif'}).success).toBe(true);expect(copy.fontFamily).toBe('sans-serif');
});
it('keeps colliding paragraph-style IDs independent across stored document scopes and leaves source handles unchanged',()=>{
 const root=scene(),master=Document.fromJSON(root.document.toJSON());const definition=root.document.defineComponent(master);
 const before=master.toJSON();root.document.fonts.replace('serif','monospace');
 expect(root.document.getComponent(definition).paragraphStyles.getById(root.base.id)!.format.fontFamily).toBe('monospace');expect(root.base.format.fontFamily).toBe('monospace');expect(master.toJSON()).toEqual(before);
});
it('checks nested master text and dependent component-instance locks before any publication',()=>{
 const document=new Document(),leaf=new Document({width:100,height:50});leaf.layers.add(new TextLayer({text:'Nested',fontFamily:'serif'}));const leafId=document.defineComponent(leaf);
 const parent=Document.fromJSON({...new Document().toJSON(),components:document.toJSON().components});parent.placeSmartObject(leafId);const parentId=document.defineComponent(parent),instance=document.placeSmartObject(parentId);instance.locked=true;const before=document.toJSON();
 expect(()=>document.fonts.replace('serif','monospace')).toThrow(/locked instance/);expect(document.toJSON()).toEqual(before);instance.locked=false;document.fonts.replace('serif','monospace');expect((document.getComponent(leafId).layers.at(0)as TextLayer).fontFamily).toBe('monospace');
 const locked=new Document({width:100,height:50}),text=locked.layers.add(new TextLayer({fontFamily:'serif'}));text.locked=true;document.defineComponent(locked);const stable=document.toJSON();expect(()=>document.fonts.replace('serif','monospace')).toThrow(/Unlock/);expect(document.toJSON()).toEqual(stable);
});
it('retains an accepted replacement when a command observer throws and still supports exact undo',()=>{
 const {document,a}=scene(),before=document.toJSON(),history=document.getSnapshot().past.length;const stop=document.onCommand(()=>{throw new Error('observer failed');});
 expect(()=>document.fonts.replace('serif','monospace')).toThrow();expect(a.fontFamily).toBe('monospace');expect(document.getSnapshot().past).toHaveLength(history+1);stop();document.undo();expect(document.toJSON()).toEqual(before);
});
it('rejects font changes through locked instances and ancestor groups inside otherwise unlocked masters',()=>{
 for(const lock of ['instance','ancestor']){
  const root=new Document(),leaf=new Document({width:100,height:50});leaf.layers.add(new TextLayer({text:'Leaf',fontFamily:'serif'}));const leafId=root.defineComponent(leaf);
  const parent=Document.fromJSON({...new Document({name:'Parent'}).toJSON(),components:root.toJSON().components}),inner=parent.placeSmartObject(leafId),group=parent.layers.add(new LayerGroup({name:'Inner group'}));inner.moveTo(group);if(lock==='instance')inner.locked=true;else group.locked=true;
  const parentId=root.defineComponent(parent);root.placeSmartObject(parentId);const before=root.toJSON(),revision=root.getSnapshot().revision;
  expect(()=>root.fonts.replace('serif','monospace')).toThrow(/locked instance/);expect(root.toJSON()).toEqual(before);expect(root.getSnapshot().revision).toBe(revision);
  const unlocked=root.getComponent(parentId);(unlocked.layers.at(0)as LayerGroup).locked=false;((unlocked.layers.at(0)as LayerGroup).layers.at(0)as import('../src/dom').SmartObjectLayer).locked=false;root.defineComponent(unlocked,{id:parentId});root.fonts.replace('serif','monospace');expect((root.getComponent(leafId).layers.at(0)as TextLayer).fontFamily).toBe('monospace');
 }
});
