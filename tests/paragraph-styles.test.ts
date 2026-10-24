import {withoutNativeFontFeatures} from './helpers/legacy-typography';
import {expect,it} from 'vitest';
import {Document,TextLayer,ParagraphStyle,LayerGroup} from '../src/dom';
import {validateDocument} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {importParagraphStyles,paragraphStyleLibrarySchema} from '../src/core/paragraph-styles';
import {getExportCapabilityReport} from '../src/engine/export';
import {planSvgSmart} from '../src/core/svg-smart';

function scene(){
  const document=new Document({width:600,height:400});
  const first=document.layers.add(new TextLayer({name:'First',text:'Alpha beta gamma delta',wrapWidth:180,x:12,y:18}));
  const second=document.layers.add(new TextLayer({name:'Second',text:'Different text',wrapWidth:220,x:240,y:32}));
  const style=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontSize:20,color:'#668844',paragraphSpacing:8,firstLineIndent:3}}));
  return{document,first,second,style};
}
it('uses constructor values, detached formats, unique names/IDs and strict finite settings',()=>{
  const style=new ParagraphStyle();expect(style.format).toMatchObject({fontSize:32,fontFamily:'sans-serif',lineHeight:1.2,color:'#ffffff',fontKerning:'auto'});
  const detached=style.format;detached.fontSize=90;expect(style.format.fontSize).toBe(32);
  for(const options of [{name:''},{name:' '},{format:{fontSize:0}},{format:{fontSize:Infinity}},{format:{extra:1}},{extra:1},{format:{wrapWidth:200}}])expect(()=>new ParagraphStyle(options as never)).toThrow();
  const document=new Document();document.paragraphStyles.add(style);const before=document.toJSON();
  expect(()=>document.paragraphStyles.add(style)).toThrow(/already attached/);
  expect(()=>document.paragraphStyles.add(new ParagraphStyle())).toThrow(/unique/);
  expect(document.toJSON()).toEqual(before);
  expect(()=>document.paragraphStyles.add({}as never)).toThrow(/constructor/);
  expect(()=>paragraphStyleLibrarySchema.parse(Array.from({length:129},(_,i)=>({...style.toJSON(),id:String(i),name:String(i)})))).toThrow();
});
it('applies full reusable formatting while retaining independent content, frame width and placement',()=>{
  const {document,first,second,style}=scene(),before=document.toJSON(),history=document.getSnapshot().past.length;
  document.transaction('Apply body',()=>{first.paragraphStyle=style;second.paragraphStyle=style;});
  expect(document.getSnapshot().past).toHaveLength(history+1);expect(first.paragraphStyle!.id).toBe(style.id);expect(first.paragraphOverrides).toEqual({});
  expect(first.paragraphFormat).toEqual(style.format);expect(second.paragraphFormat).toEqual(style.format);
  expect([first.text,first.wrapWidth,first.x,first.y]).toEqual(['Alpha beta gamma delta',180,12,18]);expect(second.wrapWidth).toBe(220);
  const after=document.toJSON();document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);
  expect(Document.fromJSON(after).toJSON()).toEqual(after);
});
it('updates all followers, reflows their bounds and preserves explicit per-field local overrides',()=>{
  const {document,first,second,style}=scene();first.paragraphStyle=style;second.paragraphStyle=style;
  second.fontSize=28;second.color='#cc3311';const width=first.width,height=first.height,oldText=second.text,history=document.getSnapshot().past.length;
  style.update({fontSize:36,lineHeight:1.6,color:'#2266aa',letterSpacing:1});
  expect(document.getSnapshot().past).toHaveLength(history+1);expect(first.fontSize).toBe(36);expect(first.height).toBeGreaterThan(height);expect(first.width).toBe(width);
  expect(second.fontSize).toBe(28);expect(second.color).toBe('#cc3311');expect(second.lineHeight).toBe(1.6);expect(second.letterSpacing).toBe(1);expect(second.text).toBe(oldText);
  expect(second.paragraphOverrides).toEqual({fontSize:28,color:'#cc3311'});second.resetParagraphOverrides(['fontSize']);
  expect(second.fontSize).toBe(36);expect(second.color).toBe('#cc3311');second.resetParagraphOverrides();expect(second.paragraphFormat).toEqual(style.format);
});
it('keeps explicit equal-value overrides and restores inheritance when an optional field is unset',()=>{
  const {first,second,style}=scene();first.paragraphStyle=style;second.paragraphStyle=style;
  first.letterSpacing=0;style.update({letterSpacing:3});expect(first.letterSpacing).toBe(0);expect(second.letterSpacing).toBe(3);
  first.letterSpacing=undefined;expect(first.letterSpacing).toBe(3);expect(first.paragraphOverrides).toEqual({});
  expect(()=>first.resetParagraphOverrides(['unknown']as never)).toThrow();expect(()=>first.resetParagraphOverrides(['fontSize','fontSize'])).toThrow();
  const copy=first.paragraphOverrides;(copy as {color?:string}).color='#000000';expect(first.paragraphOverrides).toEqual({});
});
it('retains or clears overrides explicitly when switching styles and enforces document ownership',()=>{
  const {document,first,style}=scene();first.paragraphStyle=style;first.fontSize=42;
  const heading=document.paragraphStyles.add(new ParagraphStyle({name:'Heading',format:{fontSize:60,color:'#cc9922'}}));
  first.applyParagraphStyle(heading,{keepOverrides:true});expect(first.fontSize).toBe(42);expect(first.color).toBe('#cc9922');
  first.applyParagraphStyle(heading);expect(first.fontSize).toBe(60);expect(first.paragraphOverrides).toEqual({});
  expect(()=>first.applyParagraphStyle(style,{keepOverrides:null}as never)).toThrow();
  const foreign=new Document().paragraphStyles.add(new ParagraphStyle());expect(()=>{first.paragraphStyle=foreign;}).toThrow(/this document/);
  expect(()=>{first.paragraphStyle=new ParagraphStyle();}).toThrow(/attached/);expect(()=>{first.paragraphStyle={}as never;}).toThrow(/this document/);
});
it('rejects locked followers atomically while allowing name-only edits and unchanged effective properties',()=>{
  const {document,first,second,style}=scene();first.paragraphStyle=style;second.paragraphStyle=style;
  const group=document.layers.add(new LayerGroup());second.moveTo(group);group.locked=true;const before=document.toJSON(),history=document.getSnapshot().past.length;
  expect(()=>style.update({fontSize:44})).toThrow(/Unlock/);expect(document.toJSON()).toEqual(before);expect(document.getSnapshot().past).toHaveLength(history);
  expect(()=>style.remove()).toThrow(/Unlock/);expect(document.toJSON()).toEqual(before);
  style.name='Body renamed';expect(first.paragraphStyle!.name).toBe('Body renamed');expect(second.paragraphStyle!.name).toBe('Body renamed');
  group.locked=false;second.fontSize=27;group.locked=true;style.update({fontSize:45});expect(first.fontSize).toBe(45);expect(second.fontSize).toBe(27);
});
it('detaches or deletes links without changing resolved format and restores live handles through undo/redo',()=>{
  const {document,first,second,style}=scene();first.paragraphStyle=style;second.paragraphStyle=style;second.color='#bb3311';
  const firstFormat=first.paragraphFormat,secondFormat=second.paragraphFormat,history=document.getSnapshot().past.length;
  first.paragraphStyle=null;expect(first.paragraphStyle).toBeNull();expect(first.paragraphFormat).toEqual(firstFormat);expect(document.getSnapshot().past).toHaveLength(history+1);
  const before=document.toJSON();style.remove();expect(second.paragraphStyle).toBeNull();expect(second.paragraphFormat).toEqual(secondFormat);expect(document.paragraphStyles.length).toBe(0);
  expect(()=>style.name).toThrow(/no longer attached/);document.undo();expect(document.toJSON()).toEqual(before);expect(style.name).toBe('Body');document.redo();expect(document.paragraphStyles.length).toBe(0);
});
it('captures current text as the base without dropping existing explicit overrides',()=>{
  const {document,first,second,style}=scene();first.paragraphStyle=style;second.paragraphStyle=style;first.fontSize=31;first.fontWeight='700';
  style.captureFrom(first);expect(second.fontSize).toBe(31);expect(second.fontWeight).toBe('700');expect(first.paragraphOverrides).toEqual({fontSize:31,fontWeight:'700'});
  first.resetParagraphOverrides();expect(first.paragraphOverrides).toEqual({});
  expect(()=>style.captureFrom(new TextLayer())).toThrow(/this style/);expect(()=>style.captureFrom({paragraphFormat:first.paragraphFormat}as never)).toThrow(/constructor/);
  expect(document.paragraphStyles.getById(style.id)!.format).toEqual(first.paragraphFormat);
});
it('checks schema age, missing definitions, wrong layer types and inconsistent resolved formats',()=>{
  const {document,first,style}=scene();first.paragraphStyle=style;const saved=document.toJSON();expect(saved.schemaVersion).toBe(42);
  expect(()=>validateDocument({...withoutNativeFontFeatures(saved),schemaVersion:39})).toThrow(/schema version 40/);
  const missing=structuredClone(saved);delete missing.paragraphStyles;expect(()=>Document.fromJSON(missing)).toThrow(/missing paragraph style/);
  const inconsistent=structuredClone(saved);(inconsistent.children[0]as {fontSize:number}).fontSize=200;expect(()=>Document.fromJSON(inconsistent)).toThrow(/disagrees/);
  const wrong=structuredClone(saved);wrong.children.push({...new LayerGroup().toJSON(),paragraphStyle:{id:style.id,overrides:{}}}as never);expect(()=>Document.fromJSON(wrong)).toThrow(/text layer/);
  const malformed=structuredClone(saved);(malformed.children[0]as any).paragraphStyle.overrides.extra=1;expect(()=>Document.fromJSON(malformed)).toThrow();
  expect(()=>parseCommands([{type:'text.paragraphOverrides.clear',id:first.id,keys:['fontSize','fontSize']}])).toThrow();
  expect(()=>parseCommands([{type:'paragraphStyle.set',style:{...style.toJSON(),extra:true}}])).toThrow();
});
it('preserves independent style scopes when converting text into an embedded master',()=>{
  const {document,first,second,style}=scene();first.paragraphStyle=style;second.paragraphStyle=style;
  const object=document.createSmartObject([first]),master=document.getComponent(object.componentId),inside=master.getLayer(first.id)as TextLayer;
  expect(inside.paragraphStyle!.id).toBe(style.id);expect(master.paragraphStyles.getById(style.id)!.format).toEqual(style.format);
  style.update({fontSize:44});expect(second.fontSize).toBe(44);expect(inside.fontSize).toBe(20);
  const view=planSvgSmart(document.toJSON()).document;expect(()=>validateDocument(view)).not.toThrow();
  const invalid=document.toJSON(),definition=invalid.components!.find(d=>d.id===object.componentId)!;if(definition.source.kind!=='document')throw new Error('fixture');definition.source.document.schemaVersion=39;
  expect(()=>Document.fromJSON(withoutNativeFontFeatures(invalid))).toThrow(/schema version 40/);
});
it('copies only needed root definitions, resolves ID/name conflicts and retains local overrides',()=>{
  const {document,first,style}=scene();first.paragraphStyle=style;first.fontSize=27;
  const target=new Document();target._dispatch({type:'paragraphStyle.set',style:{...style.toJSON(),format:{...style.format,fontSize:70}}});
  const copies=[structuredClone(first.toJSON())],definitions=importParagraphStyles(document.toJSON(),target.toJSON(),copies,()=> 'new-style');
  expect(definitions).toHaveLength(1);expect(definitions[0]).toMatchObject({id:'new-style',name:'Body 2'});expect((copies[0]as any).paragraphStyle).toEqual({id:'new-style',overrides:{fontSize:27}});
  target._dispatch({type:'transaction',label:'Copy',commands:[...definitions.map(style=>({type:'paragraphStyle.set'as const,style})),{type:'layer.add',layer:copies[0]}]});
  expect((target.layers.at(0)as TextLayer).fontSize).toBe(27);expect(target.paragraphStyles.length).toBe(2);
  const again=[structuredClone(first.toJSON())],same=new Document();same._dispatch({type:'paragraphStyle.set',style:style.toJSON()});expect(importParagraphStyles(document.toJSON(),same.toJSON(),again,()=> 'unused')).toEqual([]);
});
it('normalizes valid serialized style names before resolving destination collisions',()=>{
  for(const name of [' Body ','\tBody\n','\u00a0Body\u00a0']){
    const {document,first,style}=scene();first.paragraphStyle=style;first.fontSize=27;
    const saved=document.toJSON();saved.paragraphStyles![0].name=name;const source=Document.fromJSON(saved);
    const target=new Document();target.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontSize:60}}));
    const layers=[source.layers.at(0)!.toJSON()],definitions=importParagraphStyles(source.toJSON(),target.toJSON(),layers,()=> 'new-style');
    expect(definitions[0].name).toBe('Body 2');
    target._dispatch({type:'transaction',label:'Copy serialized style',commands:[...definitions.map(style=>({type:'paragraphStyle.set'as const,style})),{type:'layer.add',layer:layers[0]}]});
    expect((target.layers.at(0)as TextLayer).fontSize).toBe(27);expect(target.paragraphStyles.at(0)!.format.fontSize).toBe(60);
    const same=new Document();same._dispatch({type:'paragraphStyle.set',style:style.toJSON()});
    expect(importParagraphStyles(source.toJSON(),same.toJSON(),[source.layers.at(0)!.toJSON()],()=> 'unused')).toEqual([]);
  }
});
it('keeps resolved SVG typography while reporting that style links are native-project metadata',()=>{
  const {document,first,style}=scene();first.paragraphStyle=style;
  const report=getExportCapabilityReport(document.toJSON(),{format:'svg'});expect(report.warnings.some(w=>w.includes('linked paragraph-style'))).toBe(true);
  expect(report.featuresDegradedOrOmitted).toContain('Linked paragraph styles and override relationships');
  const legacy={...new Document().toJSON(),schemaVersion:39 as const};expect(Document.fromJSON(legacy).toJSON()).toEqual({...legacy,schemaVersion:42});
});
