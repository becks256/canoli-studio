import {expect,it} from 'vitest';
import {Document,TextLayer,ParagraphStyle,LayerGroup} from '../src/dom';
import {RecipeRecorder,compileEditPlan,executeRecipe,validateRecipe,type Recipe,type RecipeStep} from '../src/ai/recipes';
import {DEFAULT_PARAGRAPH_FORMAT} from '../src/core/paragraph-styles';
import {serializeRecipePackage,readRecipePackage} from '../src/ai/recipes/package';

const format={...DEFAULT_PARAGRAPH_FORMAT,fontSize:24,color:'#315b2a'};
const ref={by:'stepResult' as const,stepId:'body'};
const target={by:'name' as const,pattern:'Text',literal:true};
const recipe=(steps:RecipeStep[]):Recipe=>({schemaVersion:1,id:'style-workflow',name:'Style workflow',description:'',version:1,parameters:[],steps});
const define:RecipeStep={id:'body',outputVar:'bodyAlias',name:'Define body',action:{type:'paragraphStyle.ensure',name:'Body',format}};
function textDocument(){const document=new Document({width:600,height:300});const text=document.layers.add(new TextLayer({name:'Text',text:'Alpha beta gamma delta',wrapWidth:220}));return{document,text};}
function record(document:Document,action:()=>void){const recorder=new RecipeRecorder();recorder.start();const unhook=document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));action();unhook();return recorder.stop();}

it('replays portable style creation, inheritance, local overrides, rename and selective reset with exact single undo',()=>{
 const {document,text}=textDocument(),before=document.toJSON(),history=document.getSnapshot().past.length;
 const workflow=recipe([define,
  {id:'apply',name:'Apply',target,action:{type:'text.paragraphStyle',style:{by:'stepResult',stepId:'bodyAlias'}}},
  {id:'override',name:'Override',target,action:{type:'layer.update',patch:{color:'#a43e29',fontSize:29}}},
  {id:'update',name:'Update',action:{type:'paragraphStyle.update',style:ref,name:'Body renamed',format:{...format,fontSize:36,lineHeight:1.5}}},
  {id:'reset',name:'Reset',target,action:{type:'text.paragraphOverrides.clear',keys:['fontSize']}},
 ]);
 expect(validateRecipe(workflow).valid).toBe(true);
 const dry=compileEditPlan(workflow,before);expect(dry.errors).toEqual([]);expect(document.toJSON()).toEqual(before);
 expect(dry.steps.find(step=>step.stepId==='update')!.expectedVisualChange).toContain('reflow');
 expect(executeRecipe(JSON.parse(JSON.stringify(workflow)),document).success).toBe(true);
 expect(text.fontSize).toBe(36);expect(text.color).toBe('#a43e29');expect(text.paragraphOverrides).toEqual({color:'#a43e29'});expect(text.paragraphStyle!.name).toBe('Body renamed');
 expect(document.getSnapshot().past).toHaveLength(history+1);const after=document.toJSON();document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);
 const second=textDocument();expect(executeRecipe(workflow,second.document).success).toBe(true);expect(second.text.paragraphStyle!.id).not.toBe(text.paragraphStyle!.id);
});
it('reuses an identical normalized existing style without replacing it and rejects different-format name conflicts atomically',()=>{
 const {document,text}=textDocument(),existing=document.paragraphStyles.add(new ParagraphStyle({name:'body',format}));
 const workflow=recipe([define,{id:'apply',name:'Apply',target,action:{type:'text.paragraphStyle',style:ref}}]);
 expect(executeRecipe(workflow,document).success).toBe(true);expect(text.paragraphStyle!.id).toBe(existing.id);expect(document.paragraphStyles.length).toBe(1);
 existing.update({fontSize:42});const before=document.toJSON(),history=document.getSnapshot().past.length;
 const result=executeRecipe(workflow,document);expect(result.success).toBe(false);expect(result.error).toMatch(/different formatting/);expect(document.toJSON()).toEqual(before);expect(document.getSnapshot().past).toHaveLength(history);
});
it('binds named references by trimmed case-insensitive names while keeping layer and style output namespaces separate',()=>{
 const {document,text}=textDocument();const style=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format}));
 expect(executeRecipe(recipe([{id:'apply',name:'Apply',target,action:{type:'text.paragraphStyle',style:{by:'name',name:' body '}}}]),document).success).toBe(true);expect(text.paragraphStyle!.id).toBe(style.id);
 const invalid=recipe([{id:'layer',name:'Layer',action:{type:'layer.add',layerTemplate:{kind:'text',name:'Fresh'}}},{id:'apply',name:'Apply',target,action:{type:'text.paragraphStyle',style:{by:'stepResult',stepId:'layer'}}}]);
 const before=document.toJSON();expect(executeRecipe(invalid,document).error).toMatch(/does not identify a style/);expect(document.toJSON()).toEqual(before);
 const wrongLayer=recipe([define,{id:'edit',name:'Edit',target:{by:'stepResult',stepId:'body'},action:{type:'layer.update',patch:{opacity:.5}}}]);
 expect(executeRecipe(wrongLayer,document).success).toBe(false);
});
it('rejects skipped, forward and removed style outputs, malformed formats, wrong targets and duplicate override keys without mutation',()=>{
 const {document}=textDocument();
 const apply:RecipeStep={id:'apply',name:'Apply',target,action:{type:'text.paragraphStyle',style:ref}};
 const workflows=[recipe([apply,define]),recipe([{...define,condition:{param:'skip',op:'truthy'}},apply]),
  recipe([define,{id:'delete',name:'Delete',action:{type:'paragraphStyle.remove',style:ref}},apply]),
  recipe([{...define,action:{...define.action,type:'paragraphStyle.ensure',name:'Body',format:{...format,fontSize:NaN}}}]),
  recipe([{...define,action:{type:'paragraphStyle.ensure',name:'Body',format:{...format,bogus:1}as never}}]),
  recipe([{...define,target}]),
  recipe([define,{...apply,target:undefined}]),
 ];
 const before=document.toJSON();for(const workflow of workflows){expect(executeRecipe(workflow,document).success).toBe(false);expect(document.toJSON()).toEqual(before);}
 expect(validateRecipe(recipe([{id:'reset',name:'Reset',target,action:{type:'text.paragraphOverrides.clear',keys:['color','color']}}])).valid).toBe(false);
 expect(compileEditPlan(recipe([{...define,target:{role:'all'}}]),new Document().toJSON()).valid).toBe(false);
});
it('validates locked followers and reports every affected layer in the style dry-run',()=>{
 const {document,text}=textDocument(),second=document.layers.add(new TextLayer({name:'Second',text:'Second'}));
 const style=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format}));text.paragraphStyle=style;second.paragraphStyle=style;
 const workflow=recipe([{id:'update',name:'Update',action:{type:'paragraphStyle.update',style:{by:'name',name:'Body'},name:'Body',format:{...format,fontSize:42}}}]);
 const plan=compileEditPlan(workflow,document.toJSON());expect(plan.valid).toBe(true);expect(plan.summary.layersModified).toBe(2);expect(new Set(plan.summary.affectedLayerNames)).toEqual(new Set(['Text','Second']));
 const parent=document.layers.add(new LayerGroup());second.moveTo(parent);parent.locked=true;const before=document.toJSON();
 expect(executeRecipe(workflow,document).error).toMatch(/Unlock/);expect(document.toJSON()).toEqual(before);
});
it('records complete authoring and replays JSON on a document with fresh identities',()=>{
 const {document,text}=textDocument();
 const workflow=record(document,()=>{
  const style=document.paragraphStyles.add(new ParagraphStyle({name:'${literal}',format}));text.paragraphStyle=style;text.color='#a43e29';style.name='Renamed';style.update({fontSize:38});text.resetParagraphOverrides(['color']);
 });
 expect(validateRecipe(workflow).errors).toEqual([]);expect(JSON.stringify(workflow)).not.toContain(text.paragraphStyle!.id);
 const next=textDocument();expect(executeRecipe(JSON.parse(JSON.stringify(workflow)),next.document,{literal:'Wrong'}).error).toBeUndefined();
 expect(next.text.paragraphFormat).toEqual(text.paragraphFormat);expect(next.text.paragraphOverrides).toEqual({});expect(next.text.paragraphStyle!.name).toBe('Renamed');
});
it('captures preexisting style dependencies and preserves JSON inheritance resets and keepOverrides/detach/delete',()=>{
 const {document,text}=textDocument(),style=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format}));text.paragraphStyle=style;
 const workflow=record(document,()=>{text.letterSpacing=2;text.color='#a43e29';text.letterSpacing=undefined;text.applyParagraphStyle(style,{keepOverrides:true});text.paragraphStyle=null;style.remove();});
 expect(workflow.steps.some(step=>step.action.type==='text.paragraphOverrides.clear')).toBe(true);
 const next=textDocument(),nextStyle=next.document.paragraphStyles.add(new ParagraphStyle({name:'Body',format}));next.text.paragraphStyle=nextStyle;
 expect(executeRecipe(JSON.parse(JSON.stringify(workflow)),next.document).success).toBe(true);expect(next.text.paragraphStyle).toBeNull();expect(next.text.paragraphFormat).toEqual(text.paragraphFormat);expect(next.document.paragraphStyles.length).toBe(0);
});
it('records linked group templates with portable references and preserves override data through packages',async()=>{
 const source=new Document(),style=source.paragraphStyles.add(new ParagraphStyle({name:'Body',format}));
 const text=source.layers.add(new TextLayer({name:'Text',text:'Linked'}));text.paragraphStyle=style;text.color='#a43e29';
 const group=source.layers.add(new LayerGroup({name:'Copy'}));text.moveTo(group);const template=group.toJSON();group.remove();
 const workflow=record(source,()=>{source._dispatch({type:'layer.add',layer:template});});
 expect(workflow.steps.map(step=>step.action.type)).toEqual(['paragraphStyle.ensure','layer.add']);
 const blob=await serializeRecipePackage(workflow,{get(){throw new Error('No image sources expected');}}),decoded=await readRecipePackage(blob);expect(decoded.assets).toEqual([]);
 const targetDocument=new Document();expect(executeRecipe(decoded.recipe,targetDocument).success).toBe(true);
 const copy=(targetDocument.layers.at(0)as LayerGroup).layers.at(0)as TextLayer;
 expect(copy.paragraphStyle!.name).toBe('Body');expect(copy.paragraphStyle!.id).not.toBe(style.id);expect(copy.paragraphOverrides).toEqual({color:'#a43e29'});expect(copy.paragraphFormat).toEqual(text.paragraphFormat);
});
it('requires explicit portable references on linked templates instead of accidentally binding foreign identities',()=>{
 const source=textDocument(),style=source.document.paragraphStyles.add(new ParagraphStyle({name:'Body',format}));source.text.paragraphStyle=style;
 const targetDocument=new Document(),before=targetDocument.toJSON();
 expect(executeRecipe(recipe([{id:'add',name:'Add',action:{type:'layer.add',layerTemplate:{...source.text.toJSON()}}}]),targetDocument).error).toMatch(/portable paragraphStyles/);
 expect(targetDocument.toJSON()).toEqual(before);
});
it('restores recorder style dependency bindings across undo, redo, branch replacement and pause',()=>{
 const {document,text}=textDocument(),recorder=new RecipeRecorder();recorder.start();
 const commands=document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));const history=document.onHistoryNavigation(direction=>recorder.navigateHistory(direction));
 const style=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format}));text.paragraphStyle=style;document.undo();document.redo();document.undo();
 text.paragraphStyle=style;text.fontSize=35;document.undo();recorder.pause();text.color='#ffffff';recorder.resume();text.color='#a43e29';
 const workflow=recorder.stop();commands();history();const next=textDocument();
 expect(executeRecipe(JSON.parse(JSON.stringify(workflow)),next.document).error).toBeUndefined();expect(next.text.fontSize).toBe(24);expect(next.text.color).toBe('#a43e29');expect(next.document.paragraphStyles.length).toBe(1);
});
it('supports typed numeric format parameters and conditions while recorded names remain literal',()=>{
 const {document,text}=textDocument();const workflow=recipe([{...define,action:{type:'paragraphStyle.ensure',name:'${styleName}',format:{...format,fontSize:'${size}'}}},
  {id:'apply',name:'Apply',target,action:{type:'text.paragraphStyle',style:ref}}]);
 workflow.parameters=[{name:'styleName',label:'Name',type:'string',default:'Body'},{name:'size',label:'Size',type:'number',default:30,min:1,max:100}];
 expect(executeRecipe(workflow,document,{size:40}).success).toBe(true);expect(text.fontSize).toBe(40);expect(text.paragraphStyle!.name).toBe('Body');
 const before=document.toJSON();expect(executeRecipe(workflow,document,{size:0}).success).toBe(false);expect(document.toJSON()).toEqual(before);
});
