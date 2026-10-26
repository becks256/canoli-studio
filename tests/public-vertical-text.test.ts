import {expect,it} from 'vitest';
import {Document,TextLayer,ParagraphStyle,LayerGroup} from '../src/dom';
import {SCHEMA_VERSION,validateDocument,type TextLayerData} from '../src/core/model';
import {characterBoundsSchema,characterTextBounds,withPreparedCharacterBounds} from '../src/core/character-layout';
import {localBounds} from '../src/core/spatial';
import {preflightDocumentView} from '../src/core/preflight-view';
import {parseCommands} from '../src/core/validation';
import {RecipeRecorder} from '../src/ai/recipes/recorder';
import {executeRecipe} from '../src/ai/recipes/executor';
import {inspectSvgSource} from '../src/core/svg-import';
import {validateSvgInspection} from '../src/engine/svg-import';

it('public vertical columns retain authored placement, source ranges and logical inline extent through shared undo',async()=>{
 const doc=new Document(),text=doc.layers.add(new TextLayer({text:'AA\nBB',fontSize:20,lineHeight:1,x:90,y:50,characterRanges:[{start:0,end:1,format:{color:'red'}}]})),before=doc.toJSON();
 await text.setWriting({mode:'vertical-rl',orientation:'upright'});const data=text.toJSON()as TextLayerData;
 expect(doc.toJSON().schemaVersion).toBe(SCHEMA_VERSION);expect(data).toMatchObject({writingMode:'vertical-rl',textOrientation:'upright',width:40,height:40,textInlineExtent:40,textFrameOrigin:{x:-40,y:0},x:90,y:50,text:'AA\nBB'});expect(data).not.toHaveProperty('textPathOrigin');expect(localBounds(data)).toEqual({x:-40,y:0,width:40,height:40});
 expect(preflightDocumentView(doc.toJSON()).children[0]).toMatchObject({textFrameOrigin:{x:-40,y:0}});doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(text.toJSON()).toEqual(data);
 const copy=Document.fromJSON(doc.toJSON()).getLayer(text.id)as TextLayer;expect(copy.toJSON()).toEqual(data);copy.writingMode='vertical-lr';expect(copy.toJSON()).toMatchObject({textFrameOrigin:{x:0,y:0}});
});
it('schema 47 gates explicit writing fields and both derived caches while legacy 46 stays readable',()=>{
 const doc=new Document(),text=doc.layers.add(new TextLayer({text:'Legacy'})),legacy=doc.toJSON();legacy.schemaVersion=46;expect(()=>validateDocument(legacy)).not.toThrow();
 for(const patch of [{writingMode:undefined},{textOrientation:'mixed'},{textFrameOrigin:undefined},{textInlineExtent:undefined}]){const value=structuredClone(legacy);Object.assign(value.children[0],patch);expect(()=>validateDocument(value)).toThrow('47');}
 text.writingMode='vertical-rl';for(const key of ['textFrameOrigin','textInlineExtent']as const){const value=doc.toJSON();delete(value.children[0]as TextLayerData)[key];expect(()=>validateDocument(value)).toThrow(/frame|inline/);}
 const invalid=doc.toJSON();(invalid.children[0]as TextLayerData).textPathOrigin={x:0,y:0};expect(()=>validateDocument(invalid)).toThrow();
});
it('writer changes and native cache ownership reject invalid values, locks, scalar errors and cache injection atomically',()=>{
 const doc=new Document(),text=doc.layers.add(new TextLayer({text:'AA'}));for(const patch of [{writingMode:'vertical'},{textOrientation:'rotated'},{textInlineExtent:88},{textFrameOrigin:{x:0,y:0}},{writing:{mode:'vertical-rl'}}]){const before=doc.getSnapshot();expect(()=>text.update(patch as never)).toThrow();expect(doc.getSnapshot()).toBe(before);expect(()=>parseCommands([{type:'layer.update',id:text.id,patch}])).toThrow();}
 const group=doc.layers.add(new LayerGroup());expect(()=>group.update({writingMode:'vertical-rl'})).toThrow('text layer');text.locked=true;const before=doc.getSnapshot();expect(()=>{text.writingMode='vertical-rl';}).toThrow();expect(doc.getSnapshot()).toBe(before);
 expect(()=>new TextLayer({text:'A\0B',writingMode:'vertical-rl'})).toThrow('XML controls');
});
it('detached text can return to horizontal without retaining obsolete vertical caches',()=>{
 const text=new TextLayer({text:'AA',writingMode:'vertical-rl'});text.writingMode='horizontal-tb';expect(text.writingMode).toBe('horizontal-tb');expect(text.toJSON()).not.toHaveProperty('textFrameOrigin');expect(text.toJSON()).not.toHaveProperty('textInlineExtent');const doc=new Document();expect(()=>doc.layers.add(text)).not.toThrow();
});
it('paragraph inheritance resolves writing, explicit overrides and resets without opting legacy styles into native writing',()=>{
 const doc=new Document(),base=doc.paragraphStyles.add(new ParagraphStyle({name:'Base',format:{fontSize:20,lineHeight:1}})),child=doc.paragraphStyles.add(new ParagraphStyle({name:'Child',basedOn:base})),text=doc.layers.add(new TextLayer({text:'AA\nBB'}));text.paragraphStyle=child;expect(text.toJSON()).toMatchObject({writingMode:'horizontal-tb',textOrientation:'mixed'});expect(text.toJSON()).not.toHaveProperty('textFrameOrigin');
 base.update({writingMode:'vertical-rl',textOrientation:'upright'});expect(text.writingMode).toBe('vertical-rl');expect(text.toJSON()).toMatchObject({textFrameOrigin:{x:-40,y:0},textInlineExtent:40});text.writingMode='vertical-lr';base.update({writingMode:'horizontal-tb'});expect(text.writingMode).toBe('vertical-lr');text.resetParagraphOverrides(['writingMode']);expect(text.writingMode).toBe('horizontal-tb');expect(text.toJSON()).not.toHaveProperty('textFrameOrigin');doc.undo();expect(text.writingMode).toBe('vertical-lr');
});
it('writing-only recipes preserve receiving content, ranges and fonts and remeasure the receiving frame',async()=>{
 const source=new Document(),text=source.layers.add(new TextLayer({name:'Title',text:'AA'})),recorder=new RecipeRecorder();recorder.start();const stop=source.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));await text.setWriting({mode:'vertical-rl'});stop();const recipe=recorder.stop({name:'Vertical writing'}),target=new Document(),copy=target.layers.add(new TextLayer({name:'Title',text:'Receiving',fontSize:50,fontFamily:'serif',characterRanges:[{start:0,end:2,format:{color:'red'}}]})),before=target.toJSON();
 expect(executeRecipe(recipe,target).success).toBe(true);expect(copy.toJSON()).toMatchObject({text:'Receiving',fontSize:50,fontFamily:'serif',characterRanges:[{start:0,end:2,format:{color:'red'}}],writingMode:'vertical-rl'});expect((copy.toJSON()as TextLayerData).textInlineExtent).toBe(450);target.undo();expect(target.toJSON()).toEqual(before);
});
it('native metric handoff owns nested geometry and preserves logical inline extent independently of physical height',()=>{
 const input={text:'AA',writing:{mode:'vertical-rl'as const}},bounds={width:40,height:139,origin:{x:-40,y:-1},inlineExtent:138};
 withPreparedCharacterBounds(input,bounds,()=>{bounds.origin.x=999;bounds.inlineExtent=999;const first=characterTextBounds(input);expect(first).toMatchObject({inlineExtent:138,origin:{x:-40,y:-1}});first.origin!.x=900;expect(characterTextBounds(input).origin!.x).toBe(-40);});
 for(const patch of [{inlineExtent:0},{inlineExtent:Infinity},{origin:{x:NaN,y:0}},{extra:1}])expect(()=>characterBoundsSchema.parse({width:40,height:139,...patch})).toThrow();
});
it('native writing preparation rejects stale revisions and synchronous transactions without edits',async()=>{
 const doc=new Document(),text=doc.layers.add(new TextLayer({text:'AA'}));let resume!:(value:{width:number;height:number;origin:{x:number;y:number};inlineExtent:number})=>void;doc._prepareTextLayout=()=>new Promise(resolve=>{resume=resolve;});const pending=text.setWriting({mode:'vertical-rl'});doc.name='Changed';resume({width:20,height:40,origin:{x:-20,y:0},inlineExtent:40});await expect(pending).rejects.toThrow('changed');expect(text.writingMode).toBe('horizontal-tb');let rejected!:Promise<void>;doc.transaction('Invalid',()=>{rejected=text.setWriting({mode:'vertical-rl'});});await expect(rejected).rejects.toThrow('outside synchronous');
});
it('SVG vertical writing stays inert until font/native reconstruction and unsupported baseline/inline writing is explicit',()=>{
 const svg=(body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">${body}</svg>`,result=inspectSvgSource(svg('<text x="80" y="10" style="writing-mode:vertical-rl;text-orientation:upright">A<tspan fill="red">B</tspan></text>'));
 expect(result.report.canImportEditable,result.report.unsupportedFeatures.join('\n')).toBe(true);expect(result.texts[0]).toMatchObject({writing:{mode:'vertical-rl',orientation:'upright'},x:80,y:10,characterRanges:[{start:1,end:2,format:{color:'#ff0000'}}]});expect(()=>validateSvgInspection(result)).not.toThrow();expect(JSON.stringify(result.document)).not.toContain('writingMode');
 for(const body of ['<g dominant-baseline="alphabetic"><text style="writing-mode:vertical-rl">AA</text></g>','<text style="writing-mode:vertical-rl" dominant-baseline="alphabetic">AA</text>','<text style="writing-mode:vertical-rl">A<tspan style="writing-mode:vertical-lr">B</tspan></text>','<text style="writing-mode:sideways-rl">AA</text>'])expect(inspectSvgSource(svg(body)).report.canImportEditable).toBe(false);
});
it('captured default writing overrides survive JSON and keep horizontal frames independent from later vertical base changes',()=>{
 const doc=new Document(),base=doc.paragraphStyles.add(new ParagraphStyle({name:'Vertical',format:{writingMode:'vertical-rl',textOrientation:'upright'}})),child=doc.paragraphStyles.add(new ParagraphStyle({name:'Capture',basedOn:base})),source=doc.layers.add(new TextLayer({text:'Legacy source'}));child.captureFrom(source);const parsed=Document.fromJSON(JSON.parse(JSON.stringify(doc.toJSON()))),copy=parsed.paragraphStyles.getById(child.id)!,target=parsed.layers.add(new TextLayer({text:'Independent'}));target.paragraphStyle=copy;parsed.paragraphStyles.getById(base.id)!.update({writingMode:'vertical-lr',textOrientation:'sideways'});expect(copy.overrides).toMatchObject({writingMode:'horizontal-tb',textOrientation:'mixed'});expect(target.writingMode).toBe('horizontal-tb');expect(target.toJSON()).not.toHaveProperty('characterRanges');expect(target.toJSON()).not.toHaveProperty('textFrameOrigin');
});
it('detached nested text retains parent record identity while vertical caches are removed',()=>{
 const group=new LayerGroup(),text=group.layers.add(new TextLayer({text:'AA',writingMode:'vertical-rl'}));text.writingMode='horizontal-tb';text.name='Horizontal child';const doc=new Document();doc.layers.add(group);const child=doc.getLayer(text.id)as TextLayer;expect(child.name).toBe('Horizontal child');expect(child.toJSON()).not.toHaveProperty('textFrameOrigin');expect(child.toJSON()).not.toHaveProperty('textInlineExtent');
});
for(const writingMode of ['vertical-rl','vertical-lr']as const)it(`paragraph frames validate against authored logical height instead of physical width: ${writingMode}`,()=>{
 const doc=new Document(),text=doc.layers.add(new TextLayer({text:'AA AA\nBB',fontSize:20,lineHeight:1,writingMode,textOrientation:'upright',wrapWidth:80}));expect(text.toJSON()).toMatchObject({textInlineExtent:80,height:80});expect(text.width).not.toBe(80);const valid=doc.toJSON();expect(()=>validateDocument(valid)).not.toThrow();for(const patch of [{textInlineExtent:81},{height:79}]){const invalid=structuredClone(valid);Object.assign(invalid.children[0],patch);expect(()=>validateDocument(invalid)).toThrow('wrap width');}const before=doc.toJSON();text.wrapWidth=90;expect((text.toJSON()as TextLayerData).textInlineExtent).toBe(90);doc.undo();expect(doc.toJSON()).toEqual(before);
});
it('empty vertical point frames still resize typography instead of discarding the gesture',async()=>{
 const {computeResizePatch}=await import('../src/ui/utils');const text=new TextLayer({text:'',fontSize:20,lineHeight:1,writingMode:'vertical-rl'}),data=text.toJSON()as TextLayerData,patch=computeResizePatch({handle:'se',layerX:0,layerY:0,layerWidth:data.width,layerHeight:data.height,layerFontSize:data.fontSize,layerText:'',layerFontFamily:data.fontFamily,layerLineHeight:data.lineHeight,layerTextStyle:data,layerKind:'text'},20,0,false);expect(patch.fontSize).toBe(40);text.update(patch);expect(text.fontSize).toBe(40);expect(text.width).toBe(40);
});
