import {expect,it} from 'vitest';
import {Document,TextLayer,LayerGroup,VectorLayer,ParagraphStyle} from '../src/dom';
import {validateDocument,SCHEMA_VERSION} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {measureCharacterText,measureCharacterTextAsync} from '../src/core/character-layout';
import {textEditRange} from '../src/ui/text-edit-range';
import {RecipeRecorder,executeRecipe} from '../src/ai/recipes';
import {inspectDesign} from '../src/core/preflight';
import {preflightDocumentView} from '../src/core/preflight-view';
import {computeResizePatch} from '../src/ui/utils';

it('formats and clears source intervals through shared commands with owned snapshots and exact undo',async()=>{
 const doc=new Document(),layer=doc.layers.add(new TextLayer({text:'abcdef'})),before=doc.toJSON(),count=doc.getSnapshot().past.length,commands:string[]=[];doc.onCommand(c=>commands.push(c.type));
 await layer.formatRange(1,5,{color:'#123456',fontSize:60});await layer.formatRange(3,6,{fontStyle:'italic'});
 expect(layer.characterRanges).toEqual([{start:1,end:3,format:{color:'#123456',fontSize:60}},{start:3,end:5,format:{color:'#123456',fontSize:60,fontStyle:'italic'}},{start:5,end:6,format:{fontStyle:'italic'}}]);
 const owned=layer.characterRanges as unknown as {format:{color:string}}[];owned[0].format.color='changed';expect(layer.characterRanges[0].format.color).toBe('#123456');
 expect(commands).toEqual(['layer.update','layer.update']);expect(doc.getSnapshot().past.length).toBe(count+2);doc.undo();doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();
 await layer.clearCharacterFormatting(2,4);expect(layer.characterRanges).toEqual([{start:1,end:2,format:{color:'#123456',fontSize:60}},{start:4,end:5,format:{color:'#123456',fontSize:60}}]);
 await layer.clearCharacterFormatting();expect(layer.characterRanges).toEqual([]);
});
it('retains exact replacement positions and explicit affinity in repeated text',()=>{
 const layer=new TextLayer({text:'AAAA',characterRanges:[{start:0,end:1,format:{color:'red'}},{start:1,end:4,format:{color:'blue'}}]});
 layer.replaceText(1,1,'A');expect(layer.text).toBe('AAAAA');expect(layer.characterRanges).toEqual([{start:0,end:2,format:{color:'red'}},{start:2,end:5,format:{color:'blue'}}]);
 layer.replaceText(2,2,'A',{affinity:'after'});expect(layer.characterRanges).toEqual([{start:0,end:2,format:{color:'red'}},{start:2,end:6,format:{color:'blue'}}]);
 layer.replaceText(1,5,'Z');expect(layer.text).toBe('AZA');expect(layer.characterRanges).toEqual([{start:0,end:2,format:{color:'red'}},{start:2,end:3,format:{color:'blue'}}]);
});
it('whole-string setters preserve unchanged suffixes and Unicode scalar boundaries',async()=>{
 const layer=new TextLayer({text:'a😀bc'});await layer.formatRange(1,3,{color:'red'});layer.text='z😀bc';expect(layer.characterRanges).toEqual([{start:1,end:3,format:{color:'red'}}]);
 await expect(layer.formatRange(2,3,{color:'red'})).rejects.toThrow(/surrogate/);expect(()=>layer.replaceText(1,2,'')).toThrow(/surrogate/);
 layer.text='z😁bc';expect(layer.text).toBe('z😁bc');expect(layer.characterRanges).toEqual([{start:1,end:3,format:{color:'red'}}]);
});
it('gates explicit ranges at schema 45 while loading earlier documents without injecting overrides',()=>{
 const layer=new TextLayer({text:'Old'}),data=new Document().toJSON();data.schemaVersion=44;data.children=[layer.toJSON()];expect(()=>validateDocument(data)).not.toThrow();const restored=Document.fromJSON(data);expect(restored.toJSON().schemaVersion).toBe(SCHEMA_VERSION);expect(restored.toJSON().children[0]).not.toHaveProperty('characterRanges');
 const formatted={...layer.toJSON(),characterRanges:[]};expect(()=>validateDocument({...data,children:[formatted]})).toThrow(/schema version 45/);
 for(const ranges of [[{start:0,end:9,format:{color:'red'}}],[{start:0,end:2,format:{lineHeight:2}}],[{start:0,end:2,format:{fontSize:0}}]])expect(()=>new TextLayer({text:'Old',characterRanges:ranges as never})).toThrow();
});
it('keeps paragraph inheritance independent of explicit character overrides and frame-only edits',async()=>{
 const doc=new Document(),style=doc.paragraphStyles.add(new ParagraphStyle({format:{fontSize:20}})),layer=doc.layers.add(new TextLayer({text:'A B'}));layer.paragraphStyle=style;await layer.formatRange(2,3,{fontSize:60});const before=[layer.width,layer.height];layer.x=20;layer.color='#123456';expect([layer.width,layer.height]).toEqual(before);style.update({fontSize:30});expect(layer.fontSize).toBe(30);expect(layer.characterRanges).toEqual([{start:2,end:3,format:{fontSize:60}}]);expect(layer.height).toBe(72);
});
it('rejects locks, wrong layer kinds and stale or cancelled preparation without publishing edits',async()=>{
 const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new TextLayer({text:'abc'})),vector=doc.layers.add(new VectorLayer());
 group.locked=true;let before=doc.toJSON();await expect(layer.formatRange(0,1,{color:'red'})).rejects.toThrow(/Unlock/);expect(doc.toJSON()).toEqual(before);group.locked=false;
 expect(()=>vector.update({characterRanges:[]})).toThrow(/text/);
 doc._prepareTextLayout=async()=>{doc.name='Concurrent edit';return{width:99,height:99};};const beforeLayer=layer.toJSON();await expect(layer.formatRange(0,1,{color:'red'})).rejects.toThrow(/changed/);expect(layer.toJSON()).toEqual(beforeLayer);
 const abort=new AbortController();abort.abort();await expect(layer.formatRange(0,1,{color:'red'},{signal:abort.signal})).rejects.toThrow();expect(layer.toJSON()).toEqual(beforeLayer);
});
it('prepares asynchronous typography outside transactions and rejects malformed broker results',async()=>{
 const doc=new Document(),layer=doc.layers.add(new TextLayer({text:'abc'}));let operation:Promise<void>|undefined;
 doc.transaction('No async work',()=>{operation=layer.formatRange(0,1,{color:'red'});});await expect(operation).rejects.toThrow(/outside synchronous/);
 const before=doc.toJSON();doc._prepareTextLayout=async()=>({width:NaN,height:20});await expect(layer.formatRange(0,1,{color:'red'})).rejects.toThrow();expect(doc.toJSON()).toEqual(before);
 doc._prepareTextLayout=async()=>({width:99,height:44});await layer.formatRange(0,1,{color:'red'});expect([layer.width,layer.height]).toEqual([99,44]);
});
it('validates external range commands and rejects undeclared/private embedded aliases',()=>{
 const doc=new Document(),layer=doc.layers.add(new TextLayer({text:'abc'})),before=doc.toJSON();
 for(const family of ['CanoliFont_'+'a'.repeat(64),'CanoliVariation_private'])expect(()=>layer.update({characterRanges:[{start:0,end:1,format:{fontFamily:family}}]})).toThrow(/source|aliases/);
 expect(()=>layer.update({fontFamily:'CanoliVariation_private',characterRanges:[{start:0,end:3,format:{fontFamily:'serif'}}]})).toThrow(/aliases/);
 expect(doc.toJSON()).toEqual(before);expect(parseCommands([{type:'layer.update',id:layer.id,patch:{characterRanges:[{start:0,end:1,format:{color:'red'}}]}}])).toHaveLength(1);
 for(const patch of [{characterRanges:null},{characterRanges:[{start:0,end:1,format:{wrapWidth:10}}]}])expect(()=>parseCommands([{type:'layer.update',id:layer.id,patch}])).toThrow();
});
it('shares source-aware synchronous/asynchronous headless layout and exposes estimated accuracy',async()=>{
 const input={text:'AA AA\nB',ranges:[{start:3,end:5,format:{fontSize:60}}],style:{fontSize:20},paragraph:{wrapWidth:70,paragraphSpacing:5}};const synchronous=measureCharacterText(input);expect(await measureCharacterTextAsync(input)).toEqual(synchronous);expect(synchronous.accuracy).toBe('estimated');expect(synchronous.lines.map(line=>line.spans.map(span=>span.text).join(''))).toEqual(['AA','AA','B']);
});
it('records and replays formatting on a semantic receiving layer with one undo',async()=>{
 const source=new Document(),layer=source.layers.add(new TextLayer({name:'Title',text:'abc'})),recorder=new RecipeRecorder();recorder.start();const stop=source.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));await layer.formatRange(1,3,{fontSize:60,color:'red'});stop();const recipe=recorder.stop({name:'Character recipe'});
 const target=new Document(),copy=target.layers.add(new TextLayer({name:'Title',text:'abc'})),before=target.toJSON();expect(executeRecipe(recipe,target).success).toBe(true);expect(copy.characterRanges).toEqual(layer.characterRanges);target.undo();expect(target.toJSON()).toEqual(before);
});
it('uses beforeinput source positions for insertion, selections and deletion, with a scalar-safe fallback',()=>{
 expect(textEditRange('AAAA','AAAAA',{value:'AAAA',start:1,end:1,inputType:'insertText'})).toEqual({start:1,end:1,replacement:'A'});
 expect(textEditRange('AAAA','AAA',{value:'AAAA',start:2,end:2,inputType:'deleteContentBackward'})).toEqual({start:1,end:2,replacement:''});
 expect(textEditRange('AAAA','AAA',{value:'AAAA',start:2,end:2,inputType:'deleteContentForward'})).toEqual({start:2,end:3,replacement:''});
 expect(textEditRange('A😀B','A😁B')).toEqual({start:1,end:3,replacement:'😁'});
 expect(textEditRange('abc','aXYZc',{value:'abc',start:1,end:2,inputType:'insertFromPaste'})).toEqual({start:1,end:2,replacement:'XYZ'});
});
it('reports character-family evidence consistently through direct and compact preflight',async()=>{
 const doc=new Document(),layer=doc.layers.add(new TextLayer({text:'ab',fontFamily:'serif',characterRanges:[{start:1,end:2,format:{fontFamily:'monospace'}}]}));
 const data=doc.toJSON(),direct=await inspectDesign(data,0),compact=await inspectDesign(preflightDocumentView(data),0);expect(compact).toEqual(direct);expect(direct.findings.filter(finding=>finding.code==='font-unchecked').map(finding=>finding.family).sort()).toEqual(['monospace','serif']);expect(layer.text).toBe('ab');
});
for(const wrapped of [false,true])it(`resizes ${wrapped?'paragraph':'point'} text with complete character geometry and a stationary opposite corner`,()=>{
 const layer=new TextLayer({text:'AA AA',fontSize:20,x:10,y:20,...(wrapped?{wrapWidth:90}:{}),characterRanges:[{start:3,end:5,format:{fontSize:60}}]}),data=layer.toJSON();if(data.kind!=='text')throw new Error('Missing text');
 const right=layer.x+layer.width,bottom=layer.y+layer.height,patch=computeResizePatch({handle:'nw',layerX:layer.x,layerY:layer.y,layerWidth:layer.width,layerHeight:layer.height,layerFontSize:layer.fontSize,layerText:layer.text,layerFontFamily:layer.fontFamily,layerLineHeight:layer.lineHeight,layerTextStyle:data,layerKind:'text'},wrapped?30:-layer.width,wrapped?0:-layer.height,false);
 layer.update(patch);expect(layer.x+layer.width).toBeCloseTo(right,0);expect(layer.y+layer.height).toBeCloseTo(bottom,0);expect(layer.fontSize).toBe(wrapped?20:40);expect(layer.characterRanges[0].format.fontSize).toBe(wrapped?60:120);
});
