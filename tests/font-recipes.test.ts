import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {Document,TextLayer} from '../src/dom';
import {AssetStore} from '../src/core/assets';
import {prepareFontBytes} from '../src/fonts/parser';
import {RecipeRecorder} from '../src/ai/recipes/recorder';
import {executeRecipe,compileEditPlan} from '../src/ai/recipes/executor';
import {executeRecipeAsync} from '../src/ai/recipes/async-executor';
import {validateRecipe} from '../src/ai/recipes/schema';
import {serializeRecipePackage,readRecipePackage} from '../src/ai/recipes/package';
import type {Recipe} from '../src/ai/recipes/types';

const blob=(name='Regular.ttf')=>new Blob([readFileSync('tests/fixtures/fonts/'+name)]);
const scene=()=>{const assets=new AssetStore({fontSources:{nativeSet:null,prepare:async(source,options)=>prepareFontBytes(new Uint8Array(await source.arrayBuffer()),options)}});return{assets,document:new Document({assets,width:180,height:80})};};
const recipe=(fontFiles:NonNullable<Recipe['fontFiles']>):Recipe=>({schemaVersion:2,id:'font-recipe',name:'Portable typography',description:'',version:1,parameters:[],fontFiles,steps:[{id:'text',name:'Add text',action:{type:'layer.add',layerTemplate:{kind:'text',name:'Portable caption',text:'AAAA',fontFamily:fontFiles[0].resource.report.faces[0].cssFamily,fontSize:30}}}]});

it('requires a font-bearing recipe version and rejects legacy metadata stripping',async()=>{
  const{document,assets}=scene(),file=await document.fonts.embed(blob()),value=recipe([file.toJSON()]);
  expect(validateRecipe(value).valid).toBe(true);expect(validateRecipe({...value,schemaVersion:1}).valid).toBe(false);expect(validateRecipe({...value,fontFiles:undefined}).valid).toBe(false);expect(validateRecipe({...value,fontFiles:[file.toJSON(),file.toJSON()]}).valid).toBe(false);
  const old={...value,schemaVersion:1,fontFiles:undefined,steps:[{id:'font',name:'Font',action:{type:'font.file.add',id:file.id}}]};expect(validateRecipe(old).valid).toBe(false);assets.dispose();
});

it('packages whole collection originals once and preserves each exact selected face',async()=>{
  const{document,assets}=scene(),a=await document.fonts.embed(blob('Collection.ttc'),{faceIndex:0}),b=await document.fonts.embed(blob('Collection.ttc'),{faceIndex:1}),value=recipe([a.toJSON(),b.toJSON()]),file=await serializeRecipePackage(value,assets),bytes=new Uint8Array(await file.arrayBuffer());
  expect(bytes[5]).toBe(51);const length=Number(new DataView(bytes.buffer).getBigUint64(8,true)),manifest=JSON.parse(new TextDecoder().decode(bytes.slice(48,48+length)));expect(manifest.version).toBe(3);expect(manifest.fonts.payloads).toHaveLength(3);
  const loaded=await readRecipePackage(file);expect(loaded.recipe).toEqual(value);expect(loaded.assets).toEqual([]);expect(loaded.fonts).toHaveLength(2);
  for(const font of loaded.fonts){expect(Buffer.from(await font.original.arrayBuffer())).toEqual(readFileSync('tests/fixtures/fonts/Collection.ttc'));expect(Buffer.from(await font.renderBlob.arrayBuffer())).toEqual(Buffer.from(await assets.fonts.get(font.descriptor.report.faces[0].id).renderBlob.arrayBuffer()));}assets.dispose();
});

it('captures package font blobs before yielding and rejects corrupt/truncated/trailing native data',async()=>{
  const{document,assets}=scene(),font=await document.fonts.embed(blob()),pending=serializeRecipePackage(recipe([font.toJSON()]),assets);assets.dispose();const file=await pending,loaded=await readRecipePackage(file);expect(Buffer.from(await loaded.fonts[0].original.arrayBuffer())).toEqual(readFileSync('tests/fixtures/fonts/Regular.ttf'));
  const bytes=new Uint8Array(await file.arrayBuffer());bytes[bytes.length-1]^=1;await expect(readRecipePackage(new Blob([bytes]))).rejects.toThrow(/hash|checksum|font/i);await expect(readRecipePackage(file.slice(0,file.size-1))).rejects.toThrow();await expect(readRecipePackage(new Blob([file,'x']))).rejects.toThrow('trailing');
});

it('records embedding, relinking and renaming with content identities and replays one atomic undo',async()=>{
  const a=scene(),recorder=new RecipeRecorder(),stop=a.document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));recorder.start();
  const regular=await a.document.fonts.embed(blob(),{name:'Campaign font'});a.document.layers.add(new TextLayer({name:'Caption',text:'AAAA',fontFamily:regular.family,fontSize:30}));const bold=await regular.relink(blob('Bold.ttf'));bold.name='Reviewed campaign';
  const value=recorder.stop();stop();expect(value.schemaVersion).toBe(2);expect(value.fontFiles).toHaveLength(2);expect(value.steps.map(step=>step.action.type)).toContain('font.file.remove');expect(recorder.getUnsupportedCommands()).toEqual([]);
  const b=scene(),before=b.document.toJSON();for(const font of a.assets.fonts.values())a.assets.fonts.shareTo(b.assets.fonts,font.id);
  const result=executeRecipe(value,b.document);expect(result.success,result.error).toBe(true);expect(b.document.fonts.files.items.map(file=>file.name)).toEqual(['Reviewed campaign']);expect((b.document.layers.at(0)as TextLayer).fontFamily).toBe(bold.family);b.document.undo();expect(b.document.toJSON()).toEqual(before);b.document.redo();expect(b.document.fonts.files.items[0].id).toBe(bold.id);a.assets.dispose();b.assets.dispose();
});

it('restores font dependency recording through actual undo and redo',async()=>{
  const{document,assets}=scene(),recorder=new RecipeRecorder();document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));document.onHistoryNavigation(direction=>recorder.navigateHistory(direction));recorder.start();
  const a=await document.fonts.embed(blob()),b=await a.relink(blob('Bold.ttf'));document.undo();document.redo();const value=recorder.stop();expect(value.fontFiles).toHaveLength(2);expect(value.steps.some(step=>step.action.type==='font.file.remove'&&step.action.id===a.id)).toBe(true);expect(value.steps.some(step=>step.action.type==='font.file.add'&&step.action.id===b.id)).toBe(true);assets.dispose();
});

it('captures a dependency label when first used after paused edits, without recording the paused rename',async()=>{
  const{document,assets}=scene(),font=await document.fonts.embed(blob(),{name:'Original label'}),recorder=new RecipeRecorder();document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));recorder.start();document.name='Unrelated recorded edit';recorder.pause();font.name='Paused source label';recorder.resume();document.layers.add(new TextLayer({text:'AAAA',fontFamily:font.family}));
  const value=recorder.stop();expect(value.fontFiles?.map(file=>file.name)).toEqual(['Paused source label']);expect(value.steps.some(step=>step.action.type==='font.file.rename')).toBe(false);assets.dispose();
});

it('fails missing source execution rather than publishing fallback typography',async()=>{
  const a=scene(),font=await a.document.fonts.embed(blob()),b=scene(),value=recipe([font.toJSON()]),before=b.document.toJSON(),result=await executeRecipeAsync(value,b.document);
  expect(result.success).toBe(false);expect(result.error).toContain('font source is unavailable');expect(b.document.toJSON()).toEqual(before);expect(b.assets.fonts.size).toBe(0);a.assets.dispose();b.assets.dispose();
});

it('does not attach conditional or unselected parameter font dependencies',async()=>{
  const a=scene(),one=await a.document.fonts.embed(blob()),two=await a.document.fonts.embed(blob('Bold.ttf')),value=recipe([one.toJSON(),two.toJSON()]),b=scene();
  value.parameters=[{name:'family',label:'Font',type:'string',default:two.family},{name:'enabled',label:'Enabled',type:'boolean',default:false}];const action=value.steps[0].action;if(action.type!=='layer.add')throw new Error('Wrong fixture');action.layerTemplate.fontFamily='${family}';value.steps[0].condition={param:'enabled',op:'truthy'};
  expect(executeRecipe(value,b.document).success).toBe(true);expect(b.document.fonts.files.length).toBe(0);
  a.assets.fonts.shareTo(b.assets.fonts,two.id);const selected=executeRecipe(value,b.document,{enabled:true});expect(selected.success,selected.error).toBe(true);expect(b.document.fonts.files.items.map(file=>file.id)).toEqual([two.id]);a.assets.dispose();b.assets.dispose();
});

it('keeps locked receiving text atomic when a font dependency binds a requested alias',async()=>{
  const a=scene(),font=await a.document.fonts.embed(blob()),b=scene();a.assets.fonts.shareTo(b.assets.fonts,font.id);b.document.layers.add(new TextLayer({text:'Locked',fontFamily:font.family,locked:true}));
  const value=recipe([font.toJSON()]),before=b.document.toJSON(),plan=compileEditPlan(value,b.document.toJSON(),null,{},new Set(),b.assets);expect(plan.valid).toBe(false);expect(executeRecipe(value,b.document).success).toBe(false);expect(b.document.toJSON()).toEqual(before);a.assets.dispose();b.assets.dispose();
});
